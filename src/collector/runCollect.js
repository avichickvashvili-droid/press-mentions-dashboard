// runCollect.js — the `npm run collect` command: the collector's main process, the GROUP RUNNER.
//
// Where it sits: the entry point of the data collection (DC). It holds the run lock and the
// heartbeat, but fetches nothing itself: it runs the run's groups one after another, each in its
// own process (groupRunner.js -> runGroup.js, D83). When no group is left it prints the end log
// (D86) and the run becomes 'collected' (D89). The classifier and the data/ export are separate.
// Reads/writes: the SQLite database (Company through the seed, JobRun, JobRunCompany, JobRunGroup);
// the group processes write BufferQueue and talk to Google News.
//
// Order at start-up (a normal start):
//   (a) read-only lock check: refuse if a live collection is running, or if no run is
//       'running' but an earlier run is still 'collected' (being classified);
//   (b) seed the Company table from the data files;
//   (c) take the lock in one transaction (re-checked): resume the crashed/stopped run, or start
//       a new one: its companies are split into groups of about 25 (D83) and fixed (D88).
// With `--groups 2,5` (D87, D91; `npm start -- --groups 2,5` passes it on):
//   (a) the option must be valid, and the latest run must be 'done', or 'running' with a free
//       lock (its collector died, e.g. this is the orchestrator's restart of a --groups re-run);
//       if a live collector holds it, or it is 'collected', refuse (exit 3): "A run is still in
//       progress ...";
//   (b) seed;
//   (c) a 'done' run is reopened (same 90 days) with only the chosen groups set back to
//       'pending'; a 'running' run with a free lock is taken over and simply resumed, with nothing
//       reset (D95, revises D91): every unfinished group continues, and the start line says so.
//       Then the groups run as usual.
// Then: heartbeat every 5 min, run the groups, print the end log, mark the run 'collected'.
// If the program crashes or is stopped, the emergency heartbeat releases the lock so the next
// start resumes at once (D48a); on a stop, the running group process is stopped first (D70).
// If the heartbeat, or any write on the run, finds that another process took the run over, this
// collector (and its group process) stops itself (D71).
//
// Log file (D92, D93): logs/run-<id>/collector.log gets the runner's messages, warnings, errors
// and the end log, with the date and time (not the progress line; each group process writes its
// own group-N.log). Lines written before the run is known (seed, refusals) are held and written
// once it is known; if the collector ends without a run of its own, they go to the latest run's
// folder (or logs/no-run/). Once it has its run, it tells the orchestrator which run it is
// ({ type: 'run', runId }) and sends the system-log lines of the run (orchestrator.log), e.g.
// "Run 1 started: 258 companies in 10 groups, 2026-06-30 to 2026-09-27".
// A NEW run (not a resume, take-over or --groups) cleans up first (D94): acquireRun has already
// deleted the old runs' rows; before its first log line the collector deletes every old logs/
// folder (and empties a stale folder with the new run's name), says so in collector.log and sends
// "New run 2: removed 1 old run and its logs" to orchestrator.log. A folder that can't be removed
// gives one warning; it is removed at the next new run.
//
// Exit codes (D68, src/shared/exitCodes.js), read by the orchestrator:
//
//   code | meaning
//   -----+----------------------------------------------------------------------------------
//     0  | finished: every group is 'complete' or 'failed', the run is 'collected'
//     3  | refused / stood down, nothing is wrong: another live collection holds the lock, the
//        | previous run is still 'collected' (being classified), another process took this run
//        | over, a group process refused to work, or `--groups` can't be used now (bad value,
//        | no such group, or the latest run is not 'done')
//     1  | real failure: crashed (including a database error that is not "busy", D76),
//        | cannot open the database, seed failed, cannot start the run
//   130  | stopped by Ctrl+C (SIGINT)
//   143  | stopped by SIGTERM or the orchestrator's stop message

import { config } from '../config.js';
import { openDatabase } from '../db/database.js';
import { seedCompanies } from '../seed/seedLoader.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { readGroupsOption } from '../shared/groupsOption.js';
import { findCollectedRun, findLiveRun, isRunLive } from '../shared/runLock.js';
import { describeError } from '../shared/text.js';
import {
  acquireRun, CollectedRunPendingError, GroupsRequestError, installEmergencyHandlers, LockHeldError, LostOwnershipError,
  reopenRunForGroups, RUN_IN_PROGRESS_MESSAGE, startHeartbeat,
} from './jobLock.js';
import { finishCollection } from './companyLoop.js';
import {
  buildCollectionDoneEvent, buildEndLog, createGroupRunner, findNextGroup, formatGroupNumbers, GroupRefusedError,
} from './groupRunner.js';
import { createProgress } from './progress.js';
import { connectToSupervisor, sendEvent, sendToSupervisor } from '../supervisor/serviceLink.js';
import { createLogFile, runFolderName } from '../shared/logFile.js';
import { settleLogFolder } from '../shared/runLogs.js';
import { describeCleanup, removeOldLogFolders } from '../shared/runCleanup.js';
import { formatDay, runRange } from './dateWindows.js';

// Puts the companies in run order: by section, and inside a section in file order.
function companiesInRunOrder(companies) {
  return companies
    .map((company, fileIndex) => ({ company, fileIndex }))
    .sort((a, b) => a.company.section - b.company.section || a.fileIndex - b.fileIndex)
    .map(({ company }) => company.id);
}

// Read-only check for `--groups`: the latest run must exist and be 'done', or 'running' with a
// free lock (the usual lock rules, isRunLive; D91). Returns an error text for a person, or null
// when the re-run may go ahead. (reopenRunForGroups checks again, in its transaction.)
function checkGroupsAllowed(db) {
  const latest = db.prepare('SELECT * FROM JobRun ORDER BY id DESC LIMIT 1').get();
  if (!latest) return 'There is no run yet: --groups re-runs groups of a finished run. Start a normal run first.';
  if (latest.status === 'done') return null;
  if (latest.status === 'running' && !isRunLive(latest)) return null;
  return RUN_IN_PROGRESS_MESSAGE;
}

// The runner's log file (collector.log). Its folder is set once the run is known (see the top).
const logFile = createLogFile('collector.log');

// The groups of a run that are not finished yet ('pending' or 'in_progress'), by number. Read-only.
function unfinishedGroups(db, runId) {
  return db.prepare("SELECT group_number FROM JobRunGroup WHERE run_id = ? AND status IN ('pending', 'in_progress') ORDER BY group_number")
    .all(runId).map((row) => row.group_number);
}

// What a take-over with --groups does, in words (D95): nothing is reset; every unfinished group
// continues, also the ones not chosen; a chosen group that already ended is not run again.
// E.g. "--groups 3 given: nothing is reset; unfinished groups 3, 5–10 continue (also the ones
// not chosen); group(s) 4 already ended in this run and are not run again".
function describeGroupsResume(db, runId, chosenGroups) {
  const unfinished = unfinishedGroups(db, runId);
  const others = unfinished.filter((number) => !chosenGroups.includes(number));
  const ended = chosenGroups.filter((number) => !unfinished.includes(number));
  return `--groups ${formatGroupNumbers(chosenGroups)} given: nothing is reset; unfinished group(s) ${formatGroupNumbers(unfinished)} continue` +
    `${others.length ? ' (also the ones not chosen)' : ''}` +
    `${ended.length ? `; group(s) ${formatGroupNumbers(ended)} already ended in this run and are not run again` : ''}`;
}

// The system-log line for the run this collector has just taken (D93).
function describeRunStart(db, run, chosenGroups) {
  if (run.reopened) return `Run ${run.runId}: re-running group(s) ${formatGroupNumbers(chosenGroups)}`;
  if (run.tookOver) {
    const next = findNextGroup(db, run.runId);
    return `Run ${run.runId} resumed${next ? ` at group ${next.groupNumber} of ${run.groupCount}` : ''}` +
      `${chosenGroups ? ` (${describeGroupsResume(db, run.runId, chosenGroups)})` : ''}`;
  }
  const companies = db.prepare('SELECT COUNT(*) AS n FROM JobRunCompany WHERE run_id = ?').get(run.runId).n;
  const range = runRange(run.startedAt);
  return `Run ${run.runId} started: ${companies} companies in ${run.groupCount} groups, ${formatDay(range.start)} to ${formatDay(range.end)}`;
}

// The whole collect command. Returns the exit code for the normal cases; crashes and stops go
// through the emergency handlers, which exit by themselves (main then returns null).
async function main() {
  // Lets the orchestrator's "stop" message run our SIGTERM handler, so the emergency heartbeat
  // is written on every stop (D70). Does nothing when collect runs alone.
  connectToSupervisor();
  const progress = createProgress({ logFile });

  const option = readGroupsOption(process.argv.slice(2));
  if (option.error) {
    progress.error(option.error);
    return EXIT_CODES.REFUSED;
  }
  const chosenGroups = option.groups;

  let db;
  try {
    db = openDatabase();
  } catch (error) {
    progress.error(`Cannot open the database: ${error.message}`);
    return EXIT_CODES.CRASHED;
  }

  // (a) Read-only checks.
  if (chosenGroups) {
    const refusal = checkGroupsAllowed(db);
    if (refusal) {
      progress.error(refusal);
      return EXIT_CODES.REFUSED;
    }
  } else {
    // A 'running' run that is not live will be resumed, so the 'collected' rule only applies
    // when there is nothing to resume.
    const liveRun = findLiveRun(db);
    if (liveRun) {
      progress.error(new LockHeldError(liveRun).message);
      return EXIT_CODES.REFUSED;
    }
    const hasRunningRun = db.prepare("SELECT 1 FROM JobRun WHERE status = 'running' LIMIT 1").get();
    const collectedRun = hasRunningRun ? null : findCollectedRun(db);
    if (collectedRun) {
      progress.error(new CollectedRunPendingError(collectedRun).message);
      return EXIT_CODES.REFUSED;
    }
  }

  // (b) Seed.
  let seed;
  try {
    seed = seedCompanies(db);
  } catch (error) {
    progress.error(`Seed failed, nothing was collected: ${error.message}`);
    return EXIT_CODES.CRASHED;
  }
  for (const warning of seed.warnings) progress.warn(warning);
  progress.info(`Seed done: ${seed.companies.length} companies (${seed.inserted} added, ${seed.updated} updated).`);

  // (c) Take the lock: new run, take-over, or reopen for --groups.
  let run;
  try {
    run = chosenGroups
      ? reopenRunForGroups(db, chosenGroups) // reopened (done run) or tookOver (crashed collector)
      : acquireRun(db, companiesInRunOrder(seed.companies));
  } catch (error) {
    if (error instanceof LockHeldError || error instanceof CollectedRunPendingError || error instanceof GroupsRequestError) {
      progress.error(error.message);
      return EXIT_CODES.REFUSED;
    }
    progress.error(`Could not start the run: ${error.message}`);
    return EXIT_CODES.CRASHED;
  }
  // A new run: remove the old runs' log folders before the first line goes to the new folder.
  let cleanupText = null;
  if (!run.reopened && !run.tookOver) {
    const folders = removeOldLogFolders({ keepFolder: runFolderName(run.runId) });
    if (folders.failed.length > 0) {
      progress.warn(`Old log folder(s) could not be removed (${folders.failed.map(({ name, error }) => `${name}: ${error?.message ?? error}`).join('; ')}). ` +
        'The run goes on; they are removed when the next new run starts.');
    }
    if (folders.unknown.length > 0) {
      progress.warn(`The logs folder (${config.LOGS_DIR}) also holds folder(s) that are not run logs (${folders.unknown.join(', ')}). ` +
        'They were left alone; only run-<number> and no-run folders are ever removed. Check LOGS_DIR in .env if this is not a logs-only folder.');
    }
    cleanupText = describeCleanup(run.runId, run.removedRuns ?? 0, folders);
  }
  // From now on the log lines go to this run's folder; the orchestrator is told which run it is.
  logFile.setFolder(runFolderName(run.runId));
  sendToSupervisor({ type: 'run', runId: run.runId });
  try {
    if (cleanupText) {
      progress.info(`${cleanupText}.`);
      sendEvent(cleanupText);
    }
    sendEvent(describeRunStart(db, run, chosenGroups));
  } catch {
    // only a log line is lost
  }
  if (run.reopened) {
    progress.info(`Re-running group(s) ${formatGroupNumbers(chosenGroups)} of run ${run.runId} (same 90 days, started ${run.startedAt}).`);
  } else if (run.tookOver && chosenGroups) {
    progress.info(`Resuming run ${run.runId} (started ${run.startedAt}, ${run.groupCount} groups); its collector had stopped. ` +
      `${describeGroupsResume(db, run.runId, chosenGroups)}.`);
  } else {
    progress.info(run.tookOver
      ? `Resuming run ${run.runId} (started ${run.startedAt}, ${run.groupCount} groups).`
      : `Started run ${run.runId} (${run.groupCount} groups).`);
  }

  const runner = createGroupRunner({
    db,
    runId: run.runId,
    log: (text) => progress.info(text),
    warn: (text) => progress.warn(text),
    event: sendEvent,
  });
  const emergency = installEmergencyHandlers(db, run.runId, {
    log: (text) => progress.error(text),
    beforeStop: () => runner.stop(), // stop the group process first (D70)
  });
  const stopHeartbeat = startHeartbeat(db, run.runId, {
    warn: (text) => progress.warn(text),
    // Another process owns the run now: stop the group process, then stop at once, without the
    // emergency write (the run is not ours any more), and exit as "refused" (D71).
    onLostOwnership: async (message) => {
      emergency.uninstall();
      progress.error(message);
      await runner.stop().catch(() => {});
      process.exit(EXIT_CODES.REFUSED);
    },
  });

  let outcome;
  try {
    outcome = await runner.run();
  } catch (error) {
    stopHeartbeat();
    if (error instanceof LostOwnershipError) {
      // Another process owns the run now (D71): stop without the emergency write.
      emergency.uninstall();
      progress.error(error.message);
      db.close();
      return EXIT_CODES.REFUSED;
    }
    if (error instanceof GroupRefusedError) {
      progress.error(error.message);
      emergency.stopWith(`stopped: ${error.message}`, EXIT_CODES.REFUSED); // releases the lock and exits
      return null;
    }
    emergency.handleFatal(error); // writes the emergency heartbeat and exits
    return null;
  }
  // 'stopped': the stop handler is writing the emergency heartbeat and ends the program.
  if (outcome === 'stopped') return null;

  try {
    await finishCollection(db, run.runId, { stopHeartbeat, warn: (text) => progress.warn(text) });
  } catch (error) {
    if (error instanceof LostOwnershipError) {
      emergency.uninstall();
      progress.error(error.message);
      db.close();
      return EXIT_CODES.REFUSED;
    }
    emergency.handleFatal(error);
    return null;
  }
  emergency.uninstall();
  progress.finish();
  const endLog = buildEndLog(db, run.runId);
  console.log(endLog);
  progress.record(endLog);
  try {
    sendEvent(buildCollectionDoneEvent(db, run.runId));
  } catch {
    // only a system-log line is lost
  }
  db.close();
  return EXIT_CODES.FINISHED;
}

main().then(
  (exitCode) => {
    settleLogFolder(logFile); // ended without a run of its own: held lines go to the latest run's folder
    if (exitCode !== null) process.exitCode = exitCode;
  },
  (error) => {
    // Only reached by a bug before the run was taken; nothing to release.
    const text = `ERROR: ${describeError(error)}`;
    logFile.write(text);
    settleLogFolder(logFile);
    console.error(text);
    process.exitCode = EXIT_CODES.CRASHED;
  },
);

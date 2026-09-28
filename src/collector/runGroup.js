// runGroup.js — a GROUP PROCESS: collects the companies of ONE group of a run, then exits (D83).
//
// Where it sits: started by the group runner (groupRunner.js, inside the collector's main
// process) as a child process, one group at a time, with a private message channel (IPC):
//     node src/collector/runGroup.js <runId> <groupNumber> <runnerPid>
// It fetches the group's companies from Google News into BufferQueue and exits, so the memory it
// used is freed. The runner holds the run lock and writes the heartbeat; this process takes NO
// lock of its own. Every write it makes on the run first checks that the RUNNER (runnerPid) still
// owns the run (D71), in the same transaction as the write.
// Reads/writes: the SQLite database (JobRun, JobRunCompany, JobRunGroup (read only), Company,
// BufferQueue) and Google News. It does not seed the Company table and does not change JobRun or
// JobRunGroup: the runner does.
//
// What it does:
//   1. refuses to work unless the runner has marked its group 'in_progress' (so a 'complete'
//      group never runs again by mistake; D90);
//   2. puts the group's 'fetching' company (cut off by an earlier crash) back to 'not_started';
//   3. takes the group's next 'not_started' company: 'fetching' -> 'finished' (or 'failed' after
//      Google rejected its search 3 times, D85), until none is left;
//   4. prints the group summary and exits with 0.
// While it works it tells the runner "still alive" over the channel (D90):
//   { type: 'alive', state: 'fetching' } before each Google request and every 30 s while it
//   waits to retry Google; { type: 'alive', state: 'waiting' } on every 5 s check while the
//   queue is full. The runner kills a group process it hasn't heard from for 5 minutes (stuck).
// Every Google problem is logged with its HTTP code (when there is one) and the company name (D90).
// Log file (D92, D93): logs/run-<runId>/group-<groupNumber>.log gets the messages, warnings and
// errors (every Google retry), one line per finished company and the group summary, with the date
// and time; not the progress line. For the orchestrator's system log it sends a few event lines
// to the runner (groupEvents.js): Google problems started / OK again, queue full / has room
// again, a company failed.
// If the runner goes away (the channel disconnects) or sends { type: 'stop' }, the process stops
// at once, as the services do (src/supervisor/serviceLink.js). A company it was fetching stays
// 'fetching' and is redone by the next start of this group (duplicates are skipped by guid).
// It never writes the emergency heartbeat: that would release the RUNNER's lock while the
// runner is still alive. The runner records why the group process ended.
//
// Exit codes (src/shared/exitCodes.js):
//
//   code | meaning
//   -----+----------------------------------------------------------------------------------
//     0  | group done: no 'not_started' company is left in the group
//     3  | refused: the runner no longer owns the run (another process took it over, D71), or
//        | the group is not 'in_progress' (e.g. already 'complete', D90)
//     1  | crash: wrong arguments, no such run/group, cannot open the database, a database
//        | error that is not "busy" (D76), or any unexpected error
//   130  | stopped by Ctrl+C (SIGINT)
//   143  | stopped on request (the runner's stop message, the runner gone, or SIGTERM)

import { openDatabase } from '../db/database.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { describeWait } from '../shared/retry.js';
import { describeError } from '../shared/text.js';
import { connectToSupervisor, sendEvent } from '../supervisor/serviceLink.js';
import { createLogFile, runFolderName } from '../shared/logFile.js';
import { companyFailedEvent, createGoogleStreak, createQueueWaitEvents } from './groupEvents.js';
import { buildGroupSummary, createSessionStats, runGroupLoop } from './companyLoop.js';
import { createGoogleNewsClient, describeGoogleRetry } from './googleNews.js';
import { LostOwnershipError } from './jobLock.js';
import { createProgress } from './progress.js';

// Reads the three command-line arguments. Returns { runId, groupNumber, runnerPid }, or null
// when one of them is missing or not a whole number of at least 1.
function parseGroupArguments(args) {
  if (args.length !== 3) return null;
  const [runId, groupNumber, runnerPid] = args.map((text) => (/^\d+$/.test(text) ? Number(text) : NaN));
  if (![runId, groupNumber, runnerPid].every((value) => Number.isSafeInteger(value) && value >= 1)) return null;
  return { runId, groupNumber, runnerPid };
}

// Sends the "still alive" message to the runner (D90). Does nothing when there is no runner
// (e.g. started by hand) or the channel is already closed: a lost message only matters to the
// stuck check, which then acts on its own.
function sendAlive(state) {
  if (typeof process.send !== 'function' || !process.connected) return;
  try {
    process.send({ type: 'alive', state }, () => {}); // a send error only means the runner is gone
  } catch {
    // the channel closed; the 'disconnect' handler stops this process
  }
}

// Installs the handlers that end the process on a crash or a stop. None of them writes to the
// database (see the header). `closeDb` is called first, so the file is closed cleanly.
function installExitHandlers({ progress, closeDb }) {
  let ending = false;
  // Logs the reason once and exits with the given code.
  function endWith(reason, exitCode, logAsError) {
    if (ending) return;
    ending = true;
    if (logAsError) progress.error(reason);
    else progress.info(reason);
    closeDb();
    process.exit(exitCode);
  }
  process.on('uncaughtException', (error) => endWith(`Group process crashed: ${describeError(error)}`, EXIT_CODES.CRASHED, true));
  process.on('unhandledRejection', (error) => endWith(`Group process crashed (unhandled promise): ${describeError(error)}`, EXIT_CODES.CRASHED, true));
  process.on('SIGINT', () => endWith('Group process stopped by Ctrl+C.', EXIT_CODES.STOPPED_BY_CTRL_C, false));
  process.on('SIGTERM', () => endWith('Group process stopped on request.', EXIT_CODES.STOPPED_BY_REQUEST, false));
}

// This group's log file (logs/run-<runId>/group-<groupNumber>.log), once the arguments are read.
let logFile = null;

// The whole group process. Returns the exit code; crashes and stops exit through the handlers.
async function main(args) {
  const parsed = parseGroupArguments(args);
  if (!parsed) {
    // No run or group number: there is no log file to write to, only the terminal.
    createProgress().error(`Group process: expected <runId> <groupNumber> <runnerPid> (whole numbers), got: ${JSON.stringify(args)}.`);
    return EXIT_CODES.CRASHED;
  }
  const { runId, groupNumber, runnerPid } = parsed;
  logFile = createLogFile(`group-${groupNumber}.log`);
  logFile.setFolder(runFolderName(runId));
  const progress = createProgress({ logFile });

  // The exit handlers and the runner's message channel come FIRST, before the database is opened,
  // so a stop message or the runner going away is never missed (review G10). `db` is not set yet
  // at that moment, so closing it must work without it.
  let db = null;
  const closeDb = () => {
    try { db?.close(); } catch { /* already closed */ }
  };
  installExitHandlers({ progress, closeDb });
  // The runner's stop message (or the runner going away) runs our SIGTERM handler above.
  if (!connectToSupervisor() && typeof process.send === 'function') {
    // Started with a message channel, but it is already closed: the runner is gone. Nobody could
    // stop this process or hear it, so it stops at once instead of working alone.
    progress.info(`Group ${groupNumber}: the group runner is already gone; stopping.`);
    return EXIT_CODES.STOPPED_BY_REQUEST;
  }
  try {
    db = openDatabase();
  } catch (error) {
    progress.error(`Group ${groupNumber}: cannot open the database: ${error.message}`);
    return EXIT_CODES.CRASHED;
  }

  const group = db.prepare('SELECT status FROM JobRunGroup WHERE run_id = ? AND group_number = ?').get(runId, groupNumber);
  if (!group) {
    progress.error(`Group process: run ${runId} has no group ${groupNumber}.`);
    closeDb();
    return EXIT_CODES.CRASHED;
  }
  if (group.status !== 'in_progress') {
    progress.error(`Group ${groupNumber} of run ${runId} is '${group.status}', not 'in_progress': it is not collected. ` +
      'A complete group only runs again through `npm start -- --groups N`.');
    closeDb();
    return EXIT_CODES.REFUSED;
  }
  const groupTotal = db.prepare('SELECT COUNT(*) AS n FROM JobRunGroup WHERE run_id = ?').get(runId).n;
  progress.update({ groupNumber, groupTotal });

  const googleStreak = createGoogleStreak({ event: sendEvent });
  const queueEvents = createQueueWaitEvents({ event: sendEvent });
  const googleClient = createGoogleNewsClient({
    onRetry: (info) => {
      googleStreak.retry(info);
      progress.warn(describeGoogleRetry(info));
      progress.update({ note: `${info.reason}, retry in ${describeWait(info.waitMs)}` });
    },
    onAlive: sendAlive,
  });
  // The same client; a search that worked ends a streak of Google problems (one "OK again" line).
  const client = {
    ...googleClient,
    search: async (...searchArgs) => {
      const result = await googleClient.search(...searchArgs);
      googleStreak.ok();
      return result;
    },
  };
  const events = {
    queueFull: (count) => queueEvents.waiting(count),
    queueResumed: (count) => queueEvents.resumed(count),
    companyFailed: (name, reason) => sendEvent(companyFailedEvent(name, reason)),
  };

  const stats = createSessionStats();
  try {
    await runGroupLoop({ db, runId, groupNumber, runnerPid, client, progress, stats, onAlive: sendAlive, events });
  } catch (error) {
    if (error instanceof LostOwnershipError) {
      progress.error(error.message);
      closeDb();
      return EXIT_CODES.REFUSED;
    }
    throw error; // an unexpected error: main() fails and the program exits with 1 (below)
  }

  progress.finish();
  const summary = buildGroupSummary(db, runId, groupNumber, stats);
  console.log(summary);
  progress.record(summary);
  closeDb();
  return EXIT_CODES.FINISHED;
}

main(process.argv.slice(2)).then(
  (exitCode) => { process.exitCode = exitCode; },
  (error) => {
    // An error thrown out of main() (e.g. a database error that is not "busy", D76, or a bug).
    const text = `ERROR: Group process crashed: ${describeError(error)}`;
    logFile?.write(text);
    console.error(text);
    process.exit(EXIT_CODES.CRASHED);
  },
);

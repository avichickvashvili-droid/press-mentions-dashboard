// runCollect.js — the `npm run collect` command: the 90-day collection of every company.
//
// Where it sits: the entry point of the data collection (DC). It ends when every company of
// the run is 'finished' or 'failed'; the run is then 'collected' (D52). The classifier, the
// data/ export and the alert are separate steps.
// Reads/writes: the SQLite database (Company, JobRun, JobRunCompany, BufferQueue) and
// Google News over the internet.
//
// Order at start-up:
//   (a) read-only lock check: refuse if a live collection is running, or if no run is
//       'running' but an earlier run is still 'collected' (being classified);
//   (b) seed the Company table from the data files;
//   (c) take the lock in one transaction (re-checked): resume the crashed/stopped run,
//       or start a new one with a checklist of the companies just seeded;
// then heartbeat every 5 min, run the company loop, and print the summary.
// If the program crashes or is stopped, the emergency heartbeat releases the lock so the
// next start resumes at once (D48a). If the heartbeat, or any write on the run, finds that
// another process took the run over, this collector stops itself (D71).
// A resumed run also collects the companies added to the list since it started (D79).
//
// Exit codes (D68, src/shared/exitCodes.js), read by the orchestrator:
//
//   code | meaning
//   -----+----------------------------------------------------------------------------------
//     0  | finished: every company is finished or failed, the run is 'collected'
//     3  | refused / stood down, nothing is wrong: another live collection holds the lock,
//        | the previous run is still 'collected' (being classified), or another process
//        | took this run over while it was running
//     1  | real failure: crashed (including a database error that is not "busy", D76),
//        | cannot open the database, seed failed, cannot start the run
//   130  | stopped by Ctrl+C (SIGINT)
//   143  | stopped by SIGTERM

import { openDatabase } from '../db/database.js';
import { seedCompanies } from '../seed/seedLoader.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { findCollectedRun, findLiveRun } from '../shared/runLock.js';
import {
  acquireRun, CollectedRunPendingError, installEmergencyHandlers, LockHeldError, LostOwnershipError, startHeartbeat,
} from './jobLock.js';
import { createGoogleNewsClient } from './googleNews.js';
import { buildSummary, createSessionStats, runCompanyLoop } from './companyLoop.js';
import { createProgress } from './progress.js';
import { describeWait } from '../shared/retry.js';
import { connectToSupervisor } from '../supervisor/serviceLink.js';

// Puts the companies in run order: by section, and inside a section in file order.
function companiesInRunOrder(companies) {
  return companies
    .map((company, fileIndex) => ({ company, fileIndex }))
    .sort((a, b) => a.company.section - b.company.section || a.fileIndex - b.fileIndex)
    .map(({ company }) => company.id);
}

// The whole collect command. Returns the exit code for the normal cases; crashes go through
// the emergency handlers, which exit by themselves.
async function main() {
  // Lets the orchestrator's "stop" message run our SIGTERM handler, so the emergency heartbeat
  // is written on every stop (D70). Does nothing when collect runs alone.
  connectToSupervisor();
  const progress = createProgress();
  let db;
  try {
    db = openDatabase();
  } catch (error) {
    progress.error(`Cannot open the database: ${error.message}`);
    return EXIT_CODES.CRASHED;
  }

  // (a) Read-only lock check. A 'running' run that is not live will be resumed, so the
  // 'collected' rule only applies when there is nothing to resume.
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

  // (c) Take the lock (new run or take-over).
  let run;
  try {
    run = acquireRun(db, companiesInRunOrder(seed.companies));
  } catch (error) {
    if (error instanceof LockHeldError || error instanceof CollectedRunPendingError) {
      progress.error(error.message);
      return EXIT_CODES.REFUSED;
    }
    progress.error(`Could not start the run: ${error.message}`);
    return EXIT_CODES.CRASHED;
  }
  progress.info(run.tookOver
    ? `Resuming run ${run.runId} (started ${run.startedAt}).`
    : `Started run ${run.runId}.`);
  if (run.addedCompanies > 0) {
    progress.info(`${run.addedCompanies} companies were added to the list after run ${run.runId} started; they are collected in this run too.`);
  }

  const emergency = installEmergencyHandlers(db, run.runId, { log: (text) => progress.error(text) });
  const stopHeartbeat = startHeartbeat(db, run.runId, {
    warn: (text) => progress.warn(text),
    // Another process owns the run now: stop at once, without the emergency write (the run is
    // not ours any more), and exit as "refused", since nothing is broken (D71).
    onLostOwnership: (message) => {
      emergency.uninstall();
      progress.error(message);
      process.exit(EXIT_CODES.REFUSED);
    },
  });

  const client = createGoogleNewsClient({
    onRetry: ({ reason, waitMs }) => {
      progress.warn(`${reason}; retrying the same search in ${describeWait(waitMs)}.`);
      progress.update({ note: `${reason}, retry in ${describeWait(waitMs)}` });
    },
  });

  const stats = createSessionStats();
  try {
    await runCompanyLoop({ db, runId: run.runId, client, progress, stats, stopHeartbeat });
  } catch (error) {
    stopHeartbeat();
    if (error instanceof LostOwnershipError) {
      // Another process owns the run now (D71): stop without the emergency write (the run is
      // not ours any more) and exit as "refused", since nothing is broken.
      emergency.uninstall();
      progress.error(error.message);
      db.close();
      return EXIT_CODES.REFUSED;
    }
    emergency.handleFatal(error); // writes the emergency heartbeat and exits
    return EXIT_CODES.CRASHED;
  }

  emergency.uninstall(); // the heartbeat was already stopped when the run became 'collected'
  progress.finish();
  console.log(buildSummary(db, run.runId, stats));
  db.close();
  return EXIT_CODES.FINISHED;
}

main().then(
  (exitCode) => { process.exitCode = exitCode; },
  (error) => {
    // Only reached by a bug before the run was taken; nothing to release.
    console.error(`ERROR: ${error?.stack ?? error}`);
    process.exitCode = EXIT_CODES.CRASHED;
  },
);

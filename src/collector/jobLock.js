// jobLock.js — makes sure only one collection runs at a time, and records each run.
//
// Where it sits: used by `npm run collect` at start-up (take the lock), while running
// (heartbeat every 5 min) and when it crashes or is stopped (emergency heartbeat).
// The parts other programs need too (is the lock live? the emergency heartbeat) live in
// src/shared/runLock.js; this file has the collector-only parts.
// Reads/writes: the JobRun table (the lock and the run record) and, when a run starts or is
// taken over, the JobRunCompany table (the run's checklist of companies). When a run starts it
// also writes the JobRunGroup table (the run's groups, D83). D39, D48, D48a.
//
// The lock is simply "a JobRun row with status 'running'". It is LIVE (held) when all are true:
//   - owner_pid is set, and
//   - that process is still alive, and
//   - its last heartbeat is not older than 15 minutes.
// Otherwise it is released/stale and the next `collect` takes the run over and resumes it.
// When there is no 'running' run at all, `collect` starts a new run, UNLESS a run is still
// 'collected' (collection done, classification not yet 'done'): then it refuses, so the
// classifier can finish that run first.
// The checklist and the groups are fixed when the run starts (D88): a company added to the list
// later is NOT added to this run (not even when it is taken over or resumed); it waits for the
// next run. (This replaces D79's "added to the run on resume".)
// Every write the collector makes on the run checks, in the same transaction, that this process
// still owns the run; if another process took it over, the collector stops itself (D71).
// At the end of collection the run becomes 'collected' with owner_pid = NULL, which hands it
// over to the classifier (finishCollection in companyLoop.js).
// Re-running chosen groups (`--groups 2,5`, D87, D91): when the latest run is 'done', the run is
// reopened ('running', this process owns it; started_at is kept, so the 90 days stay the same,
// D55) and only the chosen groups are set back to 'pending' with their companies 'not_started'
// (reopenRunForGroups). When the latest run is 'running' but its lock is free by the usual rules
// (owner gone, released, or heartbeat stale; e.g. the collector of a --groups re-run crashed and
// the orchestrator restarts it), the run is taken over and the chosen groups are reset again the
// same way (D91). Refused while a live collector holds the run, or while it is 'collected'.
// The collector never sets a run to 'failed'.
// A NEW run removes the old runs (D93, D94): in the same transaction as the insert, every other
// run's JobRunGroup, JobRunCompany and JobRun rows are deleted (src/shared/runCleanup.js).
// Mention, Company and BufferQueue are kept. A resume, a take-over or a --groups re-open deletes
// nothing.

import { config } from '../config.js';
import { inTransaction, isDatabaseBusyError, nowIso } from '../db/database.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { findCollectedRun, findRunningRun, isProcessAlive, isRunLive, writeEmergencyHeartbeat } from '../shared/runLock.js';
import { describeError } from '../shared/text.js';
import { deleteOldRuns } from '../shared/runCleanup.js';
import { splitIntoGroups } from './groups.js';

// Thrown when another live process holds the lock. The message is for a person.
export class LockHeldError extends Error {
  constructor(run) {
    super(
      `Another collection is running (run ${run.id}, process ${run.owner_pid}, last heartbeat ${run.last_heartbeat}). ` +
        'Wait for it to finish, or stop it first.',
    );
    this.name = 'LockHeldError';
    this.run = run;
  }
}

// Thrown when a new run would start while an earlier run is still 'collected' (being classified).
export class CollectedRunPendingError extends Error {
  constructor(run) {
    super(
      `The previous run (run ${run.id}, collected ${run.finished_at ?? 'earlier'}) is still being classified. ` +
        'A new collection can start once that run is done.',
    );
    this.name = 'CollectedRunPendingError';
    this.run = run;
  }
}

// Thrown when this collector finds that another process has taken its run over (D71): it must
// stop, because two collectors must never work on the same run. Nothing is wrong, so the
// collector exits with 3 ("refused / stood down") and writes no emergency heartbeat (the run is
// not ours any more).
export class LostOwnershipError extends Error {
  constructor(runId) {
    super(`Run ${runId} was taken over by another process (this one was silent for too long). ` +
      'Stopping this collector so only one works on the run.');
    this.name = 'LostOwnershipError';
    this.runId = runId;
  }
}

// Thrown when `--groups` can't be used now: there is no run yet, the latest run is not 'done'
// (the collector or the classifier is still working on it), or a chosen group doesn't exist.
// Nothing is wrong, so the collector exits with 3. The message is for a person.
export class GroupsRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GroupsRequestError';
  }
}

// The message when `--groups` is asked while the latest run is still 'running' or 'collected' (D87).
export const RUN_IN_PROGRESS_MESSAGE = "A run is still in progress (collector or classifier). Try again when it's done.";

// True if this process still owns the 'running' run. Called inside the transaction of each
// write the collector makes on the run, so the check and the write happen together (D71). Read-only.
export function ownsRun(db, runId, pid = process.pid) {
  return Boolean(db.prepare("SELECT 1 FROM JobRun WHERE id = ? AND status = 'running' AND owner_pid = ?").get(runId, pid));
}

// Takes the lock in ONE transaction. It re-checks the lock first (something may have changed
// since the read-only check), then either:
//   - takes over the 'running' run (its owner is gone or silent): owner_pid = us, fresh
//     heartbeat, its 'fetching' company goes back to 'not_started' to be redone. Its checklist
//     and groups are NOT changed: no company is added and no group is made again (D88), or
//   - starts a new run: the companies are split into groups of about config.GROUP_TARGET_SIZE,
//     in the given order (groups.js, D83); one 'not_started' checklist row per company, with its group
//     number, and one 'pending' JobRunGroup row per group.
// Throws LockHeldError if a live process holds the lock, and CollectedRunPendingError if a new
// run would start while an earlier run is still 'collected'.
// `groupSize` (the target group size) can be given by tests; normally it is config.GROUP_TARGET_SIZE.
// A new run also deletes every other run's rows (JobRunGroup, JobRunCompany, JobRun) in the same
// transaction (D94); Mention, Company and BufferQueue are kept.
// Returns { runId, startedAt, tookOver, groupCount, removedRuns } (groupCount = how many groups
// the run has; removedRuns = how many old runs were deleted, always 0 on a take-over).
export function acquireRun(db, companyIdsInOrder, {
  now = Date.now(), pid = process.pid, isAlive = isProcessAlive, groupSize = config.GROUP_TARGET_SIZE,
} = {}) {
  return inTransaction(db, () => {
    const nowText = new Date(now).toISOString();
    const running = findRunningRun(db);

    if (running) {
      if (isRunLive(running, { now, isAlive })) throw new LockHeldError(running);
      db.prepare('UPDATE JobRun SET owner_pid = ?, last_heartbeat = ? WHERE id = ?').run(pid, nowText, running.id);
      db.prepare("UPDATE JobRunCompany SET status = 'not_started' WHERE run_id = ? AND status = 'fetching'").run(running.id);
      const groups = db.prepare('SELECT COUNT(*) AS n FROM JobRunGroup WHERE run_id = ?').get(running.id).n;
      return { runId: running.id, startedAt: running.started_at, tookOver: true, groupCount: groups, removedRuns: 0 };
    }

    const collectedRun = findCollectedRun(db);
    if (collectedRun) throw new CollectedRunPendingError(collectedRun);

    const groups = splitIntoGroups(companyIdsInOrder, groupSize);
    const result = db
      .prepare("INSERT INTO JobRun (started_at, status, last_heartbeat, owner_pid) VALUES (?, 'running', ?, ?)")
      .run(nowText, nowText, pid);
    const runId = Number(result.lastInsertRowid);
    const addGroup = db.prepare("INSERT INTO JobRunGroup (run_id, group_number, status) VALUES (?, ?, 'pending')");
    const addCompany = db.prepare("INSERT INTO JobRunCompany (run_id, company_id, status, group_number) VALUES (?, ?, 'not_started', ?)");
    groups.forEach((companyIds, index) => {
      const groupNumber = index + 1;
      addGroup.run(runId, groupNumber);
      for (const companyId of companyIds) addCompany.run(runId, companyId, groupNumber);
    });
    const removedRuns = deleteOldRuns(db, runId); // same transaction: all or nothing (D94)
    return { runId, startedAt: nowText, tookOver: false, groupCount: groups.length, removedRuns };
  });
}

// Reopens the latest run to collect the chosen groups again (`--groups`, D87, D91), in ONE transaction:
//   - the latest run must be 'done', or 'running' with a free lock (isRunLive false: the owner
//     is gone, released or silent for 15 min; a take-over, D91); otherwise GroupsRequestError
//     (nothing is changed). On a take-over, the run's 'fetching' companies go back to
//     'not_started', as in any take-over;
//   - every chosen group must exist in that run; otherwise GroupsRequestError;
//   - the run becomes 'running', owned by `pid`, with a fresh heartbeat; finished_at is cleared
//     (it is set again when the run is 'collected'); started_at is NOT changed, so the 90-day
//     window stays the same (D55); the classifier counters keep adding up (D90);
//   - each chosen group: 'pending', crashes_in_a_row 0, exported_at / started_at / finished_at /
//     last_error cleared; its companies go back to 'not_started' with no error.
// Groups that were not chosen are not touched.
// Returns { runId, startedAt, groupCount, tookOver } (tookOver = the run was 'running' and taken over).
export function reopenRunForGroups(db, groupNumbers, { pid = process.pid, now = Date.now(), isAlive = isProcessAlive } = {}) {
  return inTransaction(db, () => {
    const latest = db.prepare('SELECT * FROM JobRun ORDER BY id DESC LIMIT 1').get();
    if (!latest) throw new GroupsRequestError('There is no run yet: --groups re-runs groups of a finished run. Start a normal run first.');
    const tookOver = latest.status === 'running' && !isRunLive(latest, { now, isAlive });
    if (latest.status !== 'done' && !tookOver) throw new GroupsRequestError(RUN_IN_PROGRESS_MESSAGE);
    const existing = new Set(db.prepare('SELECT group_number FROM JobRunGroup WHERE run_id = ?').all(latest.id).map((row) => row.group_number));
    const missing = groupNumbers.filter((number) => !existing.has(number));
    if (missing.length > 0) {
      throw new GroupsRequestError(`Run ${latest.id} has groups 1 to ${existing.size}; there is no group ${missing.join(', ')}.`);
    }
    const nowText = new Date(now).toISOString();
    db.prepare("UPDATE JobRun SET status = 'running', owner_pid = ?, last_heartbeat = ?, finished_at = NULL WHERE id = ?")
      .run(pid, nowText, latest.id);
    if (tookOver) db.prepare("UPDATE JobRunCompany SET status = 'not_started' WHERE run_id = ? AND status = 'fetching'").run(latest.id);
    const resetGroup = db.prepare(`UPDATE JobRunGroup SET status = 'pending', crashes_in_a_row = 0, exported_at = NULL,
                                   started_at = NULL, finished_at = NULL, last_error = NULL
                                   WHERE run_id = ? AND group_number = ?`);
    const resetCompanies = db.prepare("UPDATE JobRunCompany SET status = 'not_started', error = NULL WHERE run_id = ? AND group_number = ?");
    for (const number of groupNumbers) {
      resetGroup.run(latest.id, number);
      resetCompanies.run(latest.id, number);
    }
    return { runId: latest.id, startedAt: latest.started_at, groupCount: existing.size, tookOver };
  });
}

// Writes "I'm alive" for our run. Only succeeds while we still own the run (checked in the same
// transaction, D71).
// Returns true if written, false if another process has taken the run over.
export function writeHeartbeat(db, runId, { pid = process.pid, now = nowIso() } = {}) {
  return inTransaction(db, () => {
    const result = db.prepare('UPDATE JobRun SET last_heartbeat = ? WHERE id = ? AND owner_pid = ?').run(now, runId, pid);
    return result.changes === 1;
  });
}

// Starts the heartbeat timer (every 5 min). A write that failed because the database was busy is
// logged and tried again at the next beat (the stale limit allows 3 missed beats). Any other
// database error is thrown on (D76): it reaches the crash handler, which exits with code 1.
// If the beat finds that another process has taken the run over (D71), the timer stops and
// onLostOwnership(message) is called: the collector must then stop itself, because two
// collectors must never work on the same run.
// Returns a function that stops the timer.
export function startHeartbeat(db, runId, {
  pid = process.pid, intervalMs = config.HEARTBEAT_MS, warn = console.warn, onLostOwnership = () => {},
} = {}) {
  const timer = setInterval(() => {
    let stillOwner;
    try {
      stillOwner = writeHeartbeat(db, runId, { pid });
    } catch (error) {
      if (!isDatabaseBusyError(error)) {
        clearInterval(timer);
        throw error;
      }
      warn(`Heartbeat could not be written (${error.message}); will try again in ${Math.round(intervalMs / 60000)} min.`);
      return;
    }
    if (!stillOwner) {
      clearInterval(timer);
      onLostOwnership(new LostOwnershipError(runId).message);
    }
  }, intervalMs);
  timer.unref(); // the heartbeat alone must not keep the program running
  return () => clearInterval(timer);
}

// Installs the handlers that fire the emergency heartbeat (writeEmergencyHeartbeat in
// src/shared/runLock.js; the run stays 'running', so the next `collect` resumes it) and then end the program:
// an uncaught error, an unhandled promise rejection, Ctrl+C (SIGINT) or SIGTERM.
// `beforeStop` (optional, may be async) runs first on Ctrl+C / SIGTERM only: the group runner uses
// it to stop its group process before the heartbeat is written (D70). A failure in it is logged
// and the stop goes on.
// Returns { handleFatal(error), uninstall() }; handleFatal is also used by the main program
// for an error that reaches its top level.
export function installEmergencyHandlers(db, runId, {
  pid = process.pid, log = console.error, exit = (code) => process.exit(code), beforeStop = null,
} = {}) {
  let alreadyHandled = false;

  // On Ctrl+C / SIGTERM: runs beforeStop (if any), then the normal stop below.
  async function stopAfterCleanUp(reason, exitCode) {
    if (alreadyHandled) return;
    if (beforeStop) {
      try {
        await beforeStop();
      } catch (error) {
        log(`Clean-up before stopping failed: ${describeError(error)}`);
      }
    }
    stopWith(reason, exitCode);
  }

  // Writes the emergency heartbeat once, then exits with the given code.
  function stopWith(reason, exitCode) {
    if (alreadyHandled) return;
    alreadyHandled = true;
    try {
      writeEmergencyHeartbeat(db, runId, reason, { pid });
      log(`Stopped: ${reason}. Run ${runId} is saved and will resume on the next "npm run collect".`);
    } catch (writeError) {
      log(`Stopped: ${reason}. The emergency heartbeat could not be written (${writeError.message}); ` +
        'the next "npm run collect" will take the run over once this process is gone.');
    }
    exit(exitCode);
  }

  const onUncaught = (error) => stopWith(`crashed: ${describeError(error)}`, EXIT_CODES.CRASHED);
  const onRejection = (error) => stopWith(`crashed (unhandled promise): ${describeError(error)}`, EXIT_CODES.CRASHED);
  const onSigint = () => stopAfterCleanUp('stopped by Ctrl+C (SIGINT)', EXIT_CODES.STOPPED_BY_CTRL_C);
  const onSigterm = () => stopAfterCleanUp('stopped by SIGTERM', EXIT_CODES.STOPPED_BY_REQUEST);

  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  return {
    handleFatal: onUncaught,
    // Writes the emergency heartbeat with this reason and exits with this code (used when the
    // runner stops for a reason of its own, e.g. its group process refused to work).
    stopWith,
    uninstall() {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onRejection);
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    },
  };
}

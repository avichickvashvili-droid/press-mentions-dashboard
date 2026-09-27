// jobLock.js — makes sure only one collection runs at a time, and records each run.
//
// Where it sits: used by `npm run collect` at start-up (take the lock), while running
// (heartbeat every 5 min) and when it crashes or is stopped (emergency heartbeat).
// The parts other programs need too (is the lock live? the emergency heartbeat) live in
// src/shared/runLock.js; this file has the collector-only parts.
// Reads/writes: the JobRun table (the lock and the run record) and, when a run starts or is
// taken over, the JobRunCompany table (the run's checklist of companies). D39, D48, D48a.
//
// The lock is simply "a JobRun row with status 'running'". It is LIVE (held) when all are true:
//   - owner_pid is set, and
//   - that process is still alive, and
//   - its last heartbeat is not older than 15 minutes.
// Otherwise it is released/stale and the next `collect` takes the run over and resumes it.
// When there is no 'running' run at all, `collect` starts a new run, UNLESS a run is still
// 'collected' (collection done, classification not yet 'done'): then it refuses, so the
// classifier can finish that run first.
// On a take-over, companies that were added to the company list after the run started are
// added to the run's checklist as 'not_started', so this run collects them too (D79).
// Every write the collector makes on the run checks, in the same transaction, that this process
// still owns the run; if another process took it over, the collector stops itself (D71).
// At the end of collection the run becomes 'collected' with owner_pid = NULL, which hands it
// over to the classifier (see companyLoop.js).
// The collector never sets a run to 'failed'.

import { config } from '../config.js';
import { inTransaction, isDatabaseBusyError, nowIso } from '../db/database.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { findCollectedRun, findRunningRun, isProcessAlive, isRunLive, writeEmergencyHeartbeat } from '../shared/runLock.js';
import { describeError } from '../shared/text.js';

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

// True if this process still owns the 'running' run. Called inside the transaction of each
// write the collector makes on the run, so the check and the write happen together (D71). Read-only.
export function ownsRun(db, runId, pid = process.pid) {
  return Boolean(db.prepare("SELECT 1 FROM JobRun WHERE id = ? AND status = 'running' AND owner_pid = ?").get(runId, pid));
}

// Takes the lock in ONE transaction. It re-checks the lock first (something may have changed
// since the read-only check), then either:
//   - takes over the 'running' run (its owner is gone or silent): owner_pid = us, fresh
//     heartbeat, its 'fetching' company goes back to 'not_started' to be redone, and companies
//     of the given list that are not in its checklist yet are added as 'not_started' (D79), or
//   - starts a new run with one 'not_started' checklist row per company, in the given order.
// Throws LockHeldError if a live process holds the lock, and CollectedRunPendingError if a new
// run would start while an earlier run is still 'collected'.
// Returns { runId, startedAt, tookOver, addedCompanies } (addedCompanies = how many companies a
// take-over added to the checklist; 0 for a new run).
export function acquireRun(db, companyIdsInOrder, { now = Date.now(), pid = process.pid, isAlive = isProcessAlive } = {}) {
  return inTransaction(db, () => {
    const nowText = new Date(now).toISOString();
    const running = findRunningRun(db);

    if (running) {
      if (isRunLive(running, { now, isAlive })) throw new LockHeldError(running);
      db.prepare('UPDATE JobRun SET owner_pid = ?, last_heartbeat = ? WHERE id = ?').run(pid, nowText, running.id);
      db.prepare("UPDATE JobRunCompany SET status = 'not_started' WHERE run_id = ? AND status = 'fetching'").run(running.id);
      const addMissing = db.prepare("INSERT OR IGNORE INTO JobRunCompany (run_id, company_id, status) VALUES (?, ?, 'not_started')");
      let addedCompanies = 0;
      for (const companyId of companyIdsInOrder) addedCompanies += addMissing.run(running.id, companyId).changes;
      return { runId: running.id, startedAt: running.started_at, tookOver: true, addedCompanies };
    }

    const collectedRun = findCollectedRun(db);
    if (collectedRun) throw new CollectedRunPendingError(collectedRun);

    const result = db
      .prepare("INSERT INTO JobRun (started_at, status, last_heartbeat, owner_pid) VALUES (?, 'running', ?, ?)")
      .run(nowText, nowText, pid);
    const runId = Number(result.lastInsertRowid);
    const addCompany = db.prepare("INSERT INTO JobRunCompany (run_id, company_id, status) VALUES (?, ?, 'not_started')");
    for (const companyId of companyIdsInOrder) addCompany.run(runId, companyId);
    return { runId, startedAt: nowText, tookOver: false, addedCompanies: 0 };
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
// Returns { handleFatal(error), uninstall() }; handleFatal is also used by the main program
// for an error that reaches its top level.
export function installEmergencyHandlers(db, runId, { pid = process.pid, log = console.error, exit = (code) => process.exit(code) } = {}) {
  let alreadyHandled = false;

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
  const onSigint = () => stopWith('stopped by Ctrl+C (SIGINT)', EXIT_CODES.STOPPED_BY_CTRL_C);
  const onSigterm = () => stopWith('stopped by SIGTERM', EXIT_CODES.STOPPED_BY_REQUEST);

  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  return {
    handleFatal: onUncaught,
    uninstall() {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onRejection);
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    },
  };
}

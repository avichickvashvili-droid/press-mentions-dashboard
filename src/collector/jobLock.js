// jobLock.js — makes sure only one collection runs at a time, and records each run.
//
// Where it sits: used by `npm run collect` at start-up (take the lock), while running
// (heartbeat every 5 min) and when it crashes or is stopped (emergency heartbeat).
// `npm run seed` also uses it to refuse to run while a collection is live.
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
// At the end of collection the run becomes 'collected' with owner_pid = NULL, which hands it
// over to the classifier (see companyLoop.js).
// The collector never sets a run to 'failed'.

import { config } from '../config.js';
import { inTransaction, nowIso } from '../db/database.js';

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

// The oldest run that is 'collected' but not yet 'done', or undefined. Read-only.
export function findCollectedRun(db) {
  return db.prepare("SELECT * FROM JobRun WHERE status = 'collected' ORDER BY id LIMIT 1").get();
}

// True if a process with this id exists. Signal 0 does not stop the process, it only checks.
// "EPERM" means it exists but belongs to someone else: still alive.
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// The current 'running' run, or undefined.
function findRunningRun(db) {
  return db.prepare("SELECT * FROM JobRun WHERE status = 'running' ORDER BY id DESC LIMIT 1").get();
}

// True if a 'running' run is still held by a live process (see the rules at the top).
export function isRunLive(run, { now = Date.now(), isAlive = isProcessAlive } = {}) {
  if (run.owner_pid === null || run.owner_pid === undefined) return false;
  if (!isAlive(run.owner_pid)) return false;
  const heartbeatAge = now - Date.parse(run.last_heartbeat);
  return !(heartbeatAge > config.STALE_AFTER_MS);
}

// Read-only lock check: returns the live run holding the lock, or null. Changes nothing.
// Used before seeding, so a live collection is never disturbed.
export function findLiveRun(db, options = {}) {
  const run = findRunningRun(db);
  return run && isRunLive(run, options) ? run : null;
}

// Takes the lock in ONE transaction. It re-checks the lock first (something may have changed
// since the read-only check), then either:
//   - takes over the 'running' run (its owner is gone or silent): owner_pid = us, fresh
//     heartbeat, and its 'fetching' company goes back to 'not_started' to be redone, or
//   - starts a new run with one 'not_started' checklist row per company, in the given order.
// Throws LockHeldError if a live process holds the lock, and CollectedRunPendingError if a new
// run would start while an earlier run is still 'collected'.
// Returns { runId, startedAt, tookOver }.
export function acquireRun(db, companyIdsInOrder, { now = Date.now(), pid = process.pid, isAlive = isProcessAlive } = {}) {
  return inTransaction(db, () => {
    const nowText = new Date(now).toISOString();
    const running = findRunningRun(db);

    if (running) {
      if (isRunLive(running, { now, isAlive })) throw new LockHeldError(running);
      db.prepare('UPDATE JobRun SET owner_pid = ?, last_heartbeat = ? WHERE id = ?').run(pid, nowText, running.id);
      db.prepare("UPDATE JobRunCompany SET status = 'not_started' WHERE run_id = ? AND status = 'fetching'").run(running.id);
      return { runId: running.id, startedAt: running.started_at, tookOver: true };
    }

    const collectedRun = findCollectedRun(db);
    if (collectedRun) throw new CollectedRunPendingError(collectedRun);

    const result = db
      .prepare("INSERT INTO JobRun (started_at, status, last_heartbeat, owner_pid) VALUES (?, 'running', ?, ?)")
      .run(nowText, nowText, pid);
    const runId = Number(result.lastInsertRowid);
    const addCompany = db.prepare("INSERT INTO JobRunCompany (run_id, company_id, status) VALUES (?, ?, 'not_started')");
    for (const companyId of companyIdsInOrder) addCompany.run(runId, companyId);
    return { runId, startedAt: nowText, tookOver: false };
  });
}

// Writes "I'm alive" for our run. Only succeeds while we still own the run.
// Returns true if written, false if another process has taken the run over.
export function writeHeartbeat(db, runId, { pid = process.pid, now = nowIso() } = {}) {
  return inTransaction(db, () => {
    const result = db.prepare('UPDATE JobRun SET last_heartbeat = ? WHERE id = ? AND owner_pid = ?').run(now, runId, pid);
    return result.changes === 1;
  });
}

// Starts the heartbeat timer (every 5 min). A failed write is logged and tried again at the
// next beat (the stale limit allows 3 missed beats).
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
      warn(`Heartbeat could not be written (${error.message}); will try again in ${Math.round(intervalMs / 60000)} min.`);
      return;
    }
    if (!stillOwner) {
      clearInterval(timer);
      onLostOwnership(`Run ${runId} was taken over by another process (this one was silent for too long). ` +
        'Stopping this collector so only one works on the run.');
    }
  }, intervalMs);
  timer.unref(); // the heartbeat alone must not keep the program running
  return () => clearInterval(timer);
}

// The emergency heartbeat (D48a): ONE write when the process crashes or is stopped:
// crashed_at, last_error, and owner_pid = NULL, which releases the lock at once.
// The run stays 'running', so the next `collect` resumes it immediately.
// Returns true if the row was written.
export function writeEmergencyHeartbeat(db, runId, reason, { pid = process.pid, now = nowIso() } = {}) {
  return inTransaction(db, () => {
    const result = db
      .prepare('UPDATE JobRun SET crashed_at = ?, last_error = ?, owner_pid = NULL WHERE id = ? AND owner_pid = ?')
      .run(now, String(reason), runId, pid);
    return result.changes === 1;
  });
}

// Turns any thrown value into readable text for last_error.
function describeError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

// Installs the handlers that fire the emergency heartbeat and then end the program:
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

  const onUncaught = (error) => stopWith(`crashed: ${describeError(error)}`, 1);
  const onRejection = (error) => stopWith(`crashed (unhandled promise): ${describeError(error)}`, 1);
  const onSigint = () => stopWith('stopped by Ctrl+C (SIGINT)', 130);
  const onSigterm = () => stopWith('stopped by SIGTERM', 143);

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

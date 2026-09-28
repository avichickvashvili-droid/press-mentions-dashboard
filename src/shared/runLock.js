// runLock.js — the parts of the JobRun lock (D39, D48, D48a, D63) that more than one program needs.
//
// Where it sits: shared by the collector (src/collector/jobLock.js takes the lock and beats the
// heartbeat), the classifier (it holds a 'collected' run while it finishes it, and releases it on a
// crash) and the seed command (it refuses to run while a live collection holds the lock).
// Keeping these here means no program imports another program's folder.
// Reads: the JobRun table. Writes: JobRun (only writeEmergencyHeartbeat).
//
// A 'running' run is LIVE (its lock is held) when all are true:
//   - owner_pid is set, and
//   - that process is still alive, and
//   - its last heartbeat is not older than STALE_AFTER_MS (15 minutes).
// Otherwise it is released/stale and the next `collect` takes the run over and resumes it.

import { config } from '../config.js';
import { inTransaction, nowIso } from '../db/database.js';

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

// The current 'running' run, or undefined. Read-only.
export function findRunningRun(db) {
  return db.prepare("SELECT * FROM JobRun WHERE status = 'running' ORDER BY id DESC LIMIT 1").get();
}

// The oldest run that is 'collected' but not yet 'done', or undefined. Read-only.
export function findCollectedRun(db) {
  return db.prepare("SELECT * FROM JobRun WHERE status = 'collected' ORDER BY id LIMIT 1").get();
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

// The emergency heartbeat (D48a): ONE write when the process crashes or is stopped:
// crashed_at, last_error, and owner_pid = NULL, which releases the lock at once.
// The run keeps its status, so the next start resumes it immediately.
// Only written while this process still owns the run. Returns true if the row was written.
export function writeEmergencyHeartbeat(db, runId, reason, { pid = process.pid, now = nowIso() } = {}) {
  return inTransaction(db, () => {
    const result = db
      .prepare('UPDATE JobRun SET crashed_at = ?, last_error = ?, owner_pid = NULL WHERE id = ? AND owner_pid = ?')
      .run(now, String(reason), runId, pid);
    return result.changes === 1;
  });
}

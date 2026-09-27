// runFinisher.js — finishes a collection run once the classifier has worked through its articles.
//
// Where it sits: the end of the whole pipeline for one run (D38, D61, D63). The collector marks a
// run 'collected' with owner_pid = NULL when every company is done; from then on the classifier
// owns it. When the queue is drained, the classifier:
//   1. takes the run (owner_pid = this process, fresh heartbeat),
//   2. moves the leftover relevant rows to Mention,
//   3. writes the data/ snapshot (exporter.js),
//   4. marks the run 'done' (finished_at = now, owner_pid = NULL).
// There is no alert here (D61): the daily job sends it later from Mention.alerted_at.
// If a step fails, the run stays 'collected' and the classifier tries again on its next pass.
// Reads/writes: JobRun (take over, done), BufferQueue + Mention (via mover.js), data/ (via exporter.js).

import { config } from '../config.js';
import { inTransaction } from '../db/database.js';
import { moveAllRelevantRows } from './mover.js';
import { buildExport, writeExportFiles } from './exporter.js';

// The oldest run that is 'collected' but not yet 'done', or undefined. Read-only.
export function findCollectedRun(db) {
  return db.prepare("SELECT * FROM JobRun WHERE status = 'collected' ORDER BY id LIMIT 1").get();
}

// Takes a 'collected' run for this process, in one transaction. Allowed when nobody holds it
// (owner_pid NULL, the normal hand-over from the collector), we already hold it, its holder's
// process is gone, or its heartbeat is older than STALE_AFTER_MS (D48).
// Returns true if this process now holds the run.
export function takeOverRun(db, runId, { pid = process.pid, now = Date.now(), isAlive, staleAfterMs = config.STALE_AFTER_MS }) {
  return inTransaction(db, () => {
    const run = db.prepare("SELECT id, owner_pid, last_heartbeat FROM JobRun WHERE id = ? AND status = 'collected'").get(runId);
    if (!run) return false;
    const holder = run.owner_pid;
    const free = holder === null || holder === pid || !isAlive(holder) || now - Date.parse(run.last_heartbeat) > staleAfterMs;
    if (!free) return false;
    db.prepare('UPDATE JobRun SET owner_pid = ?, last_heartbeat = ? WHERE id = ?').run(pid, new Date(now).toISOString(), runId);
    return true;
  });
}

// Marks the run 'done' and releases it, only while this process still holds it. Returns true if done.
export function markRunDone(db, runId, { pid = process.pid, now = new Date().toISOString() } = {}) {
  return inTransaction(db, () => db.prepare(`UPDATE JobRun SET status = 'done', finished_at = ?, owner_pid = NULL
                                             WHERE id = ? AND status = 'collected' AND owner_pid = ?`).run(now, runId, pid).changes === 1);
}

// Steps 2–4 for a run this process already holds. Throws if a step fails (the run stays 'collected').
// Returns { moved, files, done }.
export function finishHeldRun(db, runId, { pid = process.pid, now = Date.now(), dataDir } = {}) {
  const moveResult = moveAllRelevantRows(db);
  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId); // read after the move: fresh counters
  const files = writeExportFiles(buildExport(db, { run, now }), dataDir ? { dataDir } : undefined);
  const done = markRunDone(db, runId, { pid, now: new Date(now).toISOString() });
  return { moved: moveResult.moved, alreadyInMention: moveResult.alreadyInMention, files, done };
}

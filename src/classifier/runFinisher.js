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
//
// data/ after each group (D86, D96): while a run is 'running' (being collected) OR 'collected'
// (the collector has finished, but the classifier is still working through the articles), a group that
// has ended ('complete' or 'failed'), is not exported yet, and has no article left to classify
// (pending, to retry, or being worked on; articles that failed for good don't count, D72) is
// exported: its leftover relevant rows are moved to Mention, data/ is written (the full snapshot
// so far) and the group's exported_at is set. Groups are exported in group order, each as soon as
// its articles are done. This needs no hold on the run (the collector, or nobody, holds it): it only
// reads the run and writes data/ and JobRunGroup.exported_at. The 'collected' case matters most:
// the collector (~10–20 min) finishes long before the classifier (~1.5 h), so without it almost no
// after-group export would ever happen (D96). When the run becomes
// 'done', every group that has no exported_at yet gets one (the end export covers them all).
// Reads/writes: JobRun (take over, done), JobRunGroup (exported_at), BufferQueue + Mention (via mover.js), data/ (via
// exporter.js, which also reads the company list file: only listed companies are exported, D79).
// Finding the 'collected' run is shared with the collector (findCollectedRun, src/shared/runLock.js).

import { config } from '../config.js';
import { inTransaction } from '../db/database.js';
import { readCompanyNames } from '../shared/companyList.js';
import { moveAllRelevantRows } from './mover.js';
import { buildExport, writeExportFiles } from './exporter.js';

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

// Marks the run 'done' and releases it, only while this process still holds it. In the same
// transaction, every group without exported_at gets it (the end export covers all groups).
// Returns true if done.
export function markRunDone(db, runId, { pid = process.pid, now = new Date().toISOString() } = {}) {
  return inTransaction(db, () => {
    const done = db.prepare(`UPDATE JobRun SET status = 'done', finished_at = ?, owner_pid = NULL
                             WHERE id = ? AND status = 'collected' AND owner_pid = ?`).run(now, runId, pid).changes === 1;
    if (done) db.prepare('UPDATE JobRunGroup SET exported_at = ? WHERE run_id = ? AND exported_at IS NULL').run(now, runId);
    return done;
  });
}

// Every group that is ready for its after-group export (D86), in order: its run is 'running' or
// 'collected' (D96), the
// group ended ('complete' or 'failed'), it has no exported_at, and none of its companies has an
// article left to classify (pending, failed with attempts left, or claimed).
// Returns [{ runId, groupNumber, finishedAt }]. Read-only.
export function findGroupsToExport(db, { maxAttempts = config.MAX_ATTEMPTS } = {}) {
  return db.prepare(`
    SELECT g.run_id, g.group_number, g.finished_at FROM JobRunGroup g JOIN JobRun r ON r.id = g.run_id
    WHERE r.status IN ('running', 'collected') AND g.status IN ('complete', 'failed') AND g.exported_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM BufferQueue b JOIN JobRunCompany c ON c.company_id = b.company_id
        WHERE c.run_id = g.run_id AND c.group_number = g.group_number
          AND (b.status = 'pending' OR (b.status = 'failed' AND b.attempts < ?) OR b.claimed_at IS NOT NULL))
    ORDER BY g.run_id, g.group_number`).all(maxAttempts)
    .map((row) => ({ runId: row.run_id, groupNumber: row.group_number, finishedAt: row.finished_at }));
}

// The first group that is ready for its after-group export (see findGroupsToExport), or undefined.
export function findGroupToExport(db, options = {}) {
  return findGroupsToExport(db, options)[0];
}

// The after-group export (D86) of one group: moves the group's leftover relevant rows to
// Mention, writes data/ (the full snapshot so far), then sets the group's exported_at. Throws if
// writing data/ fails (exported_at stays NULL, so it is tried again on a later pass).
// exported_at is only set if the group is STILL the one that was found ready: still 'complete' or
// 'failed' and, when `finishedAt` is given, with the same finished_at. Writing the files takes a
// moment; if meanwhile a `--groups` re-run set the group back to 'pending' (or it already ended
// again), the mark is not set, so the group is exported again after its re-run (review G8).
// Returns { moved, files, marked } (marked = exported_at was set).
export async function exportGroup(db, { runId, groupNumber, finishedAt }, {
  now = Date.now(), dataDir, companyListFile = config.COMPANY_LIST_FILE, writeOptions = {},
} = {}) {
  const moveResult = moveAllRelevantRows(db, { group: { runId, groupNumber } });
  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId);
  const companyNames = readCompanyNames(companyListFile);
  const files = await writeExportFiles(
    buildExport(db, { run, now, companyNames, exportingGroup: groupNumber }),
    { ...(dataDir ? { dataDir } : {}), ...writeOptions },
  );
  const marked = inTransaction(db, () => db.prepare(`UPDATE JobRunGroup SET exported_at = ?
      WHERE run_id = ? AND group_number = ? AND exported_at IS NULL AND status IN ('complete', 'failed')
        AND (? = 0 OR finished_at IS ?)`)
    .run(new Date(now).toISOString(), runId, groupNumber, finishedAt === undefined ? 0 : 1, finishedAt ?? null).changes === 1);
  return { moved: moveResult.moved, files, marked };
}

// Steps 2–4 for a run this process already holds. Throws if a step fails (the run stays 'collected').
// `companyListFile` = the company list whose companies are exported (D79). `writeOptions` are
// passed to writeExportFiles (tests use them to simulate a failed rename).
// Returns { moved, alreadyInMention, files, done }.
export async function finishHeldRun(db, runId, {
  pid = process.pid, now = Date.now(), dataDir, companyListFile = config.COMPANY_LIST_FILE, writeOptions = {},
} = {}) {
  const moveResult = moveAllRelevantRows(db);
  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId); // read after the move: fresh counters
  const companyNames = readCompanyNames(companyListFile);
  const files = await writeExportFiles(buildExport(db, { run, now, companyNames }), { ...(dataDir ? { dataDir } : {}), ...writeOptions });
  const done = markRunDone(db, runId, { pid, now: new Date(now).toISOString() });
  return { moved: moveResult.moved, alreadyInMention: moveResult.alreadyInMention, files, done };
}

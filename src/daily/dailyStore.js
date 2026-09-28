// dailyStore.js — every database step of the daily job (D102, D106): the DailyRun table (its
// history and its lock), the "already alerted" marks on Mention, and the new mentions.
//
// Where it sits: used by dailyJob.js (one run) and dailyScheduler.js (is a run needed?).
// Reads: DailyRun, JobRun, Mention, Company. Writes: DailyRun, Mention.alerted_at.
// Every write is ONE transaction.
//
// "New" mentions: a mention whose alerted_at is empty (NULL). The mover adds every mention with
// an empty alerted_at; the daily job fills it in once Discord has accepted the message that
// listed it. The very first daily run (DailyRun is empty) first fills it in for every mention that
// is already there (the 11,600 of the real run, or the ones imported from data/), so those never
// reach Discord (D102).
//
// The lock: a 'running' DailyRun row whose process (owner_pid) is still alive = a daily run is
// going on, and no second one may start. A 'running' row whose process is gone was cut off by a
// crash or a closed window: it is marked 'failed' and a new run may start.
// (Only one `npm run daily` may be open at a time: that lock is a file, see processLock.js.)

import { inTransaction } from '../db/database.js';
import { isProcessAlive, isRunLive } from '../shared/runLock.js';

// The three sentiments a mention can have (the Mention table allows only these).
const SENTIMENTS = ['positive', 'neutral', 'negative'];

// Thrown when a daily run can't start because another one is going on.
export class DailyRunBusyError extends Error {
  constructor(run) {
    super(`another daily run (number ${run.id}, process ${run.owner_pid}) is going on`);
    this.name = 'DailyRunBusyError';
  }
}

// The 90-day collection that is not finished yet ('running' or 'collected'), or undefined.
// While it exists, the daily job waits: `npm start` is still collecting or classifying.
export function findOpenCollection(db) {
  return db.prepare("SELECT id, status, owner_pid, last_heartbeat FROM JobRun WHERE status IN ('running', 'collected') ORDER BY id DESC LIMIT 1").get();
}

// Why the daily run waits for this open collection, in words for the log. A 'running' collection
// that no live program holds (see runLock.js) was stopped halfway: nothing will finish it until
// the owner starts `npm start` again, so the reason says that. Read-only.
export function describeOpenCollection(run, { now = Date.now(), isAlive = isProcessAlive } = {}) {
  if (run.status === 'collected') return `the 90-day collection (run ${run.id}) is still being classified`;
  if (isRunLive(run, { now, isAlive })) return `the 90-day collection (run ${run.id}) is still collecting`;
  return `the 90-day collection (run ${run.id}) was stopped halfway and nothing is working on it. Run "npm start" to finish it; the daily job waits until then`;
}

// The last successful daily run, or undefined. Read-only.
export function findLastDoneDailyRun(db) {
  return db.prepare("SELECT * FROM DailyRun WHERE status = 'done' ORDER BY id DESC LIMIT 1").get();
}

// The start time of the last finished 90-day collection, or null. Read-only.
export function findLastCollectionStart(db) {
  return db.prepare("SELECT started_at FROM JobRun WHERE status = 'done' ORDER BY id DESC LIMIT 1").get()?.started_at ?? null;
}

// When the newest mention was first seen, or null. Read-only. In a database filled from data/
// (a fresh clone, D35: no collection row, no daily run) this is about when that data was
// collected, so the first daily run searches from there and no day is skipped.
export function findNewestMentionSeen(db) {
  return db.prepare('SELECT MAX(first_seen_at) AS newest FROM Mention').get()?.newest ?? null;
}

// Starts a daily run, in ONE transaction:
//   1. a 'running' row whose process is gone is marked 'failed' (cut off last time);
//   2. a 'running' row whose process is alive → DailyRunBusyError (nothing is changed);
//   3. if there has never been a daily run: every mention that is there now is marked as
//      already alerted (D102: no alert for the mentions that existed before the daily job);
//   4. the new 'running' row is added.
// Returns { runId, baselineMarked } (baselineMarked = mentions marked in step 3, 0 if not the first run).
export function startDailyRun(db, { pid = process.pid, now = new Date().toISOString(), isAlive = isProcessAlive } = {}) {
  return inTransaction(db, () => {
    const running = db.prepare("SELECT * FROM DailyRun WHERE status = 'running'").all();
    for (const run of running) {
      if (run.owner_pid !== pid && isAlive(run.owner_pid)) throw new DailyRunBusyError(run);
    }
    db.prepare(`UPDATE DailyRun SET status = 'failed', finished_at = ?, owner_pid = NULL,
                  last_error = COALESCE(last_error, 'the daily job stopped in the middle of this run (crash or closed window)')
                WHERE status = 'running'`).run(now);

    const firstRunEver = !db.prepare('SELECT 1 FROM DailyRun LIMIT 1').get();
    const baselineMarked = firstRunEver
      ? Number(db.prepare('UPDATE Mention SET alerted_at = ? WHERE alerted_at IS NULL').run(now).changes)
      : 0;

    const runId = Number(db.prepare("INSERT INTO DailyRun (started_at, status, owner_pid) VALUES (?, 'running', ?)")
      .run(now, pid).lastInsertRowid);
    return { runId, baselineMarked };
  });
}

// Ends a daily run: status 'done' or 'failed', with the counts and the error (if any).
// Only a row that is still 'running' is changed. Returns true if it was changed.
export function finishDailyRun(db, runId, {
  status, newMentions = 0, alertSentAt = null, error = null, now = new Date().toISOString(),
}) {
  return inTransaction(db, () => db.prepare(`
    UPDATE DailyRun SET status = ?, finished_at = ?, owner_pid = NULL, new_mentions = ?, alert_sent_at = ?, last_error = ?
    WHERE id = ? AND status = 'running'`).run(status, now, newMentions, alertSentAt, error, runId).changes === 1);
}

// Every mention that has not been alerted yet, with its company. Read-only.
// Returns [{ id, companyId, companyName, sentiment }].
export function readNewMentions(db) {
  return db.prepare(`
    SELECT m.id, m.company_id AS companyId, c.name AS companyName, m.sentiment
    FROM Mention m JOIN Company c ON c.id = m.company_id
    WHERE m.alerted_at IS NULL
    ORDER BY m.id`).all().map((row) => ({ ...row }));
}

// Groups new mentions by company: [{ companyId, name, total, positive, neutral, negative, mentionIds }],
// most mentions first, then by name (A-Z). Pure (no database).
export function summarizeByCompany(newMentions) {
  const byCompany = new Map();
  for (const mention of newMentions) {
    let entry = byCompany.get(mention.companyId);
    if (!entry) {
      entry = { companyId: mention.companyId, name: mention.companyName, total: 0, positive: 0, neutral: 0, negative: 0, mentionIds: [] };
      byCompany.set(mention.companyId, entry);
    }
    entry.total += 1;
    if (SENTIMENTS.includes(mention.sentiment)) entry[mention.sentiment] += 1;
    entry.mentionIds.push(mention.id);
  }
  return [...byCompany.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

// Marks exactly these mentions as alerted (after Discord accepted the message that listed them).
// Only mentions that are still not alerted are changed. Returns how many were marked.
export function markAlerted(db, mentionIds, { now = new Date().toISOString() } = {}) {
  if (mentionIds.length === 0) return 0;
  return inTransaction(db, () => Number(db.prepare(`
    UPDATE Mention SET alerted_at = ?
    WHERE alerted_at IS NULL AND id IN (SELECT value FROM json_each(?))`).run(now, JSON.stringify(mentionIds)).changes));
}

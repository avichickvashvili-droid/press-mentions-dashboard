// queueStore.js — every database step the classifier does on the BufferQueue table.
//
// Where it sits: between the queue (filled by the collector) and the AI step. The classifier
// loop calls these functions; each one is ONE transaction, so a crash never leaves half a batch.
// Reads: BufferQueue, Company, JobRun. Writes: BufferQueue (claim, results, give back) and the
// four counters of the current JobRun.
//
// Row life in the classifier (D24–D27, D45, D59):
//   pending / failed (fewer than MAX_ATTEMPTS tries)
//      │ claim: claimed_at + claimed_by_pid set, attempts + 1 BEFORE the AI is asked (poison rule)
//      ▼
//   answer "not about the company" → row DELETED (D25)
//   answer "about the company"     → status 'relevant' + sentiment (moved to Mention later, mover.js)
//   invalid answer (2 tries)       → status 'failed'; tried again later until MAX_ATTEMPTS
//   Ollama down                    → row given back unchanged (the attempt is undone)
//   worker died                    → claim released after CLAIM_TIMEOUT_MS or once its process is gone
//
// Counters on the current run (D64): classified_count = articles with a valid answer,
// relevant_count / irrelevant_count split those, failed_count = articles that failed for good
// (reached MAX_ATTEMPTS) during this run.

import { inTransaction } from '../db/database.js';
import { classifierConfig } from './classifierConfig.js';

// The run the counters belong to: the newest run that is still 'running' or 'collected'.
// Null when there is none (e.g. rows left from an older run).
function currentRunId(db) {
  const row = db.prepare("SELECT id FROM JobRun WHERE status IN ('running', 'collected') ORDER BY id DESC LIMIT 1").get();
  return row ? row.id : null;
}

// Gives back claims whose worker is gone: the claiming process no longer exists, or the claim is
// older than the timeout. The attempt is NOT undone: the worker may have crashed on this very
// article, and the poison rule must count that. Returns how many rows were released.
export function releaseAbandonedClaims(db, { now = Date.now(), isAlive, timeoutMs = classifierConfig.CLAIM_TIMEOUT_MS } = {}) {
  return inTransaction(db, () => {
    const claimed = db.prepare('SELECT id, claimed_at, claimed_by_pid FROM BufferQueue WHERE claimed_at IS NOT NULL').all();
    const release = db.prepare('UPDATE BufferQueue SET claimed_at = NULL, claimed_by_pid = NULL WHERE id = ? AND claimed_at = ?');
    let released = 0;
    for (const row of claimed) {
      const tooOld = now - Date.parse(row.claimed_at) > timeoutMs;
      const ownerGone = row.claimed_by_pid === null || !isAlive(row.claimed_by_pid);
      if (tooOld || ownerGone) released += release.run(row.id, row.claimed_at).changes;
    }
    return released;
  });
}

// Claims up to `limit` of the oldest rows waiting for the AI step, for this process.
// Waiting = 'pending', or 'failed' with fewer than MAX_ATTEMPTS tries, and not claimed by anyone.
// attempts goes up by 1 here, before the AI is asked (poison-article rule).
// Returns the claimed rows with their company's name and section number.
export function claimBatch(db, { limit, pid = process.pid, now = new Date().toISOString(), maxAttempts = classifierConfig.MAX_ATTEMPTS }) {
  return inTransaction(db, () => {
    const rows = db.prepare(`
      SELECT b.id, b.company_id, b.guid, b.url, b.title, b.publisher, b.attempts,
             c.name AS company_name, c.section AS company_section
      FROM BufferQueue b JOIN Company c ON c.id = b.company_id
      WHERE b.claimed_at IS NULL
        AND (b.status = 'pending' OR (b.status = 'failed' AND b.attempts < ?))
      ORDER BY b.id
      LIMIT ?`).all(maxAttempts, limit);
    const claim = db.prepare('UPDATE BufferQueue SET claimed_at = ?, claimed_by_pid = ?, attempts = attempts + 1 WHERE id = ?');
    for (const row of rows) {
      claim.run(now, pid, row.id);
      row.attempts += 1;
    }
    return rows;
  });
}

// Saves the answers of one batch in ONE transaction and updates the run's counters.
// Each result: { id, outcome: 'relevant' | 'irrelevant' | 'invalid', sentiment?, attempts }.
// A row is only changed while it is still claimed by this process (if its claim was released and
// someone else took it, our late answer is dropped). Returns what was saved.
export function saveBatchResults(db, results, { pid = process.pid, maxAttempts = classifierConfig.MAX_ATTEMPTS } = {}) {
  return inTransaction(db, () => {
    const deleteRow = db.prepare('DELETE FROM BufferQueue WHERE id = ? AND claimed_by_pid = ?');
    const markRelevant = db.prepare(`UPDATE BufferQueue SET status = 'relevant', sentiment = ?, claimed_at = NULL, claimed_by_pid = NULL
                                     WHERE id = ? AND claimed_by_pid = ?`);
    const markFailed = db.prepare(`UPDATE BufferQueue SET status = 'failed', claimed_at = NULL, claimed_by_pid = NULL
                                   WHERE id = ? AND claimed_by_pid = ?`);
    const saved = { relevant: 0, irrelevant: 0, failed: 0, failedForGood: 0 };
    for (const result of results) {
      if (result.outcome === 'irrelevant') {
        saved.irrelevant += deleteRow.run(result.id, pid).changes;
      } else if (result.outcome === 'relevant') {
        saved.relevant += markRelevant.run(result.sentiment, result.id, pid).changes;
      } else {
        const changed = markFailed.run(result.id, pid).changes;
        saved.failed += changed;
        if (changed && result.attempts >= maxAttempts) saved.failedForGood += 1;
      }
    }
    const runId = currentRunId(db);
    if (runId !== null) {
      db.prepare(`UPDATE JobRun SET classified_count = classified_count + ?, relevant_count = relevant_count + ?,
                    irrelevant_count = irrelevant_count + ?, failed_count = failed_count + ? WHERE id = ?`)
        .run(saved.relevant + saved.irrelevant, saved.relevant, saved.irrelevant, saved.failedForGood, runId);
    }
    return saved;
  });
}

// Gives rows back untouched because Ollama could not be used (down, timeout, HTTP error) or the
// classifier is being stopped: the claim is cleared and the attempt is undone, because the
// article itself did nothing wrong (owner decision Q6). Only rows claimed by this process.
// `ids` = the rows to give back, or null for every row this process holds. Returns how many.
export function giveBackClaims(db, ids, { pid = process.pid } = {}) {
  return inTransaction(db, () => {
    const giveBack = db.prepare(`UPDATE BufferQueue SET claimed_at = NULL, claimed_by_pid = NULL, attempts = MAX(attempts - 1, 0)
                                 WHERE id = ? AND claimed_by_pid = ?`);
    const rowIds = ids ?? db.prepare('SELECT id FROM BufferQueue WHERE claimed_by_pid = ?').all(pid).map((row) => row.id);
    let count = 0;
    for (const id of rowIds) count += giveBack.run(id, pid).changes;
    return count;
  });
}

// Clears this process's claims WITHOUT undoing the attempt. Used when the classifier crashes:
// the crash may have been caused by one of these articles, so the attempt must still count.
export function releaseOwnClaimsAfterCrash(db, { pid = process.pid } = {}) {
  return inTransaction(db, () => db.prepare('UPDATE BufferQueue SET claimed_at = NULL, claimed_by_pid = NULL WHERE claimed_by_pid = ?').run(pid).changes);
}

// Counts the queue by state, for the progress line and the "is the run finished?" check. Read-only.
export function countQueue(db, { maxAttempts = classifierConfig.MAX_ATTEMPTS } = {}) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)                        AS pending,
      COALESCE(SUM(CASE WHEN status = 'failed' AND attempts < ? THEN 1 ELSE 0 END), 0)      AS failedRetry,
      COALESCE(SUM(CASE WHEN status = 'failed' AND attempts >= ? THEN 1 ELSE 0 END), 0)     AS failedForGood,
      COALESCE(SUM(CASE WHEN status = 'relevant' THEN 1 ELSE 0 END), 0)                       AS relevant,
      COALESCE(SUM(CASE WHEN claimed_at IS NOT NULL THEN 1 ELSE 0 END), 0)                    AS claimed
    FROM BufferQueue`).get(maxAttempts, maxAttempts);
  return { pending: row.pending, failedRetry: row.failedRetry, failedForGood: row.failedForGood, relevant: row.relevant, claimed: row.claimed };
}

// True when nothing is left for the AI step: no pending rows, no failed rows that will be tried
// again, and no row being worked on. Rows that failed for good don't count (D59). Relevant rows
// waiting to move don't count either: the end of the run moves them.
export function isQueueDrained(db, options = {}) {
  const counts = countQueue(db, options);
  return counts.pending === 0 && counts.failedRetry === 0 && counts.claimed === 0;
}

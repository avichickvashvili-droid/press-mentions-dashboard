// bufferWriter.js — puts the articles of one search into the BufferQueue table.
//
// Where it sits: the last step of the collector for each date window. The classifier
// (a separate service) takes the rows from BufferQueue later.
// Reads:  BufferQueue and Mention (to skip articles we already have; to count the queue).
// Writes: BufferQueue — each search result is ONE transaction, rows start as 'pending'.
//
// Rules:
//  - Insert-if-absent (D16, D24, D32, D33): an article is skipped when the same company
//    already has it in BufferQueue OR Mention, either by guid, or by the same publisher +
//    same title (the " - Publisher" ending ignored when comparing). Existing rows are never
//    overwritten.
//  - Queue limit (D53): if the queue + this chunk would go over CAP (10,000), wait. Re-count
//    every 5 s and go on only once the queue is down to QUEUE_RESUME_AT (8,000). The count is
//    always asked from the database (the classifier removes rows while we wait).
//  - Rows that failed for good (status 'failed' and attempts >= MAX_ATTEMPTS) are NOT counted:
//    the classifier will never take them again, so they would block the queue forever (D72).
//    When such rows exist, a warning says how many (only when that number changes).
//  - While waiting for space, a count that fails because the database is busy is simply tried
//    again at the next check; any other database error is thrown on (D76).

import { config } from '../config.js';
import { inTransaction, isDatabaseBusyError, nowIso } from '../db/database.js';
import { sleep as realSleep } from '../shared/retry.js';
import { formatCount, stripPublisherSuffix } from '../shared/text.js';

// Reads the queue size for the CAP check: `live` = rows that still count (everything except
// rows that failed for good), `dead` = rows that failed for good and are left out.
export function readQueueCounts(db) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status = 'failed' AND attempts >= ? THEN 1 ELSE 0 END), 0) AS dead
    FROM BufferQueue`).get(config.MAX_ATTEMPTS);
  return { live: row.total - row.dead, dead: row.dead };
}

// How many rows count toward the queue limit right now (rows that failed for good are left out).
export function countQueue(db) {
  return readQueueCounts(db).live;
}

// Creates the function that reports rows that failed for good. It warns only when their number
// changes (and is above 0), so a long pause doesn't print the same line every 5 seconds.
export function createDeadRowReporter(warn = console.warn) {
  let lastReported = 0;
  return (deadCount) => {
    if (deadCount === lastReported) return;
    lastReported = deadCount;
    if (deadCount > 0) {
      warn(`${formatCount(deadCount)} queue rows failed the AI step for good (${config.MAX_ATTEMPTS} attempts); ` +
        'they stay in BufferQueue but are not counted toward the queue limit.');
    }
  };
}

// True if the company already has this article, by guid or by the D33 backup rule,
// in BufferQueue or Mention. Titles are compared without the " - Publisher" ending.
export function isAlreadyStored(db, companyId, item) {
  const sameGuid = db.prepare(`
    SELECT 1 FROM BufferQueue WHERE company_id = ? AND guid = ?
    UNION ALL
    SELECT 1 FROM Mention WHERE company_id = ? AND guid = ?
    LIMIT 1`).get(companyId, item.guid, companyId, item.guid);
  if (sameGuid) return true;

  if (!item.publisher) return false; // without a publisher only the guid check applies

  // A stored row matches if its title, with its own " - Publisher" ending removed, equals
  // ours without the ending. Both rows have the same publisher, so the stored title is either
  // exactly the short title or the short title + " - Publisher".
  const shortTitle = stripPublisherSuffix(item.title, item.publisher);
  const fullTitle = `${shortTitle} - ${item.publisher}`;
  const sameArticle = db.prepare(`
    SELECT 1 FROM BufferQueue WHERE company_id = ? AND publisher = ? AND title IN (?, ?)
    UNION ALL
    SELECT 1 FROM Mention WHERE company_id = ? AND publisher = ? AND title IN (?, ?)
    LIMIT 1`).get(companyId, item.publisher, shortTitle, fullTitle, companyId, item.publisher, shortTitle, fullTitle);
  return Boolean(sameArticle);
}

// Saves one search result (a "chunk") for one company in ONE transaction, as 'pending'.
// Articles the company already has are skipped (the check also sees rows added earlier in this
// same chunk). A plain INSERT is used on purpose: any other problem (e.g. a missing value) must
// fail loudly and roll back the chunk, not be silently ignored. Returns { inserted, duplicates }.
export function insertChunk(db, companyId, items, firstSeenAt = nowIso()) {
  return inTransaction(db, () => {
    const insert = db.prepare(`
      INSERT INTO BufferQueue (company_id, guid, url, title, publisher, published_at, first_seen_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`);
    let inserted = 0;
    let duplicates = 0;
    for (const item of items) {
      if (isAlreadyStored(db, companyId, item)) {
        duplicates += 1;
        continue;
      }
      insert.run(companyId, item.guid, item.url, item.title, item.publisher, item.published_at, firstSeenAt);
      inserted += 1;
    }
    return { inserted, duplicates };
  });
}

// Waits while adding `chunkSize` rows would push the queue over CAP. Once it has had to
// wait, it goes on only when the queue is down to QUEUE_RESUME_AT (8,000).
// onWaiting(queueCount) is called on every check while waiting (for the progress line);
// onDeadRows(count) gets the number of rows that failed for good at every check.
// A count that fails because the database is busy is logged and simply checked again later;
// any other database error is thrown on (D76).
// Returns the last queue count it read.
export async function waitForQueueSpace(db, chunkSize, {
  sleep = realSleep, onWaiting = () => {}, onDeadRows = () => {}, warn = console.warn,
} = {}) {
  const readCountSafely = () => {
    try {
      const { live, dead } = readQueueCounts(db);
      onDeadRows(dead);
      return live;
    } catch (error) {
      if (!isDatabaseBusyError(error)) throw error;
      warn(`Could not count the queue (${error.message}); checking again in ${config.CAP_POLL_MS / 1000} s.`);
      return null;
    }
  };

  let queueCount = readCountSafely();
  if (queueCount !== null && queueCount + chunkSize <= config.CAP) return queueCount;

  for (;;) {
    onWaiting(queueCount);
    await sleep(config.CAP_POLL_MS);
    queueCount = readCountSafely();
    if (queueCount !== null && queueCount <= config.QUEUE_RESUME_AT) return queueCount;
  }
}

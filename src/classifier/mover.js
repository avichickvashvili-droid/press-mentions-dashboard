// mover.js — moves finished ("relevant") articles from the BufferQueue to the Mention table.
//
// Where it sits: after the AI step. The classifier moves rows in chunks of MOVE_CHUNK (1,000, D51)
// whenever that many are waiting, moves one group's leftovers before the data/ export that
// follows that group (D86), and moves all leftovers at the end of a run.
// Reads/writes: BufferQueue (reads 'relevant' rows, deletes them) and Mention (inserts them);
// reads JobRunCompany to find the companies of a group.
//
// Each move is ONE transaction: the rows are added to Mention and deleted from BufferQueue
// together, so after a crash every article is in exactly one of the two tables (D16, D24).
// Mention.url is the Google News link as fetched: there is no URL decoding (D60).
// An article already in Mention (same company + guid) is never overwritten (D16): the copy in the
// queue is simply removed.

import { config } from '../config.js';
import { inTransaction } from '../db/database.js';

// Moves up to `limit` of the oldest relevant rows in one transaction. With `group`
// ({ runId, groupNumber }), only rows of that group's companies are moved.
// Returns { moved, alreadyInMention }.
export function moveRelevantRows(db, { limit = config.MOVE_CHUNK, group = null } = {}) {
  return inTransaction(db, () => {
    const rows = group
      ? db.prepare(`SELECT id, company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment
                    FROM BufferQueue WHERE status = 'relevant'
                    AND company_id IN (SELECT company_id FROM JobRunCompany WHERE run_id = ? AND group_number = ?)
                    ORDER BY id LIMIT ?`).all(group.runId, group.groupNumber, limit)
      : db.prepare(`SELECT id, company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment
                    FROM BufferQueue WHERE status = 'relevant' ORDER BY id LIMIT ?`).all(limit);
    const insert = db.prepare(`INSERT INTO Mention (company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                               ON CONFLICT (company_id, guid) DO NOTHING`);
    const remove = db.prepare('DELETE FROM BufferQueue WHERE id = ?');
    let moved = 0;
    let alreadyInMention = 0;
    for (const row of rows) {
      const added = insert.run(row.company_id, row.guid, row.url, row.title, row.publisher, row.published_at, row.first_seen_at, row.sentiment).changes;
      if (added) moved += 1; else alreadyInMention += 1;
      remove.run(row.id);
    }
    return { moved, alreadyInMention };
  });
}

// How many relevant rows are waiting to be moved. Read-only.
export function countRelevantRows(db) {
  return db.prepare("SELECT COUNT(*) AS count FROM BufferQueue WHERE status = 'relevant'").get().count;
}

// During a run: moves full chunks only, as long as at least `chunk` relevant rows are waiting.
// Returns the total moved.
export function moveFullChunks(db, { chunk = config.MOVE_CHUNK } = {}) {
  let total = { moved: 0, alreadyInMention: 0 };
  while (countRelevantRows(db) >= chunk) {
    const result = moveRelevantRows(db, { limit: chunk });
    total = { moved: total.moved + result.moved, alreadyInMention: total.alreadyInMention + result.alreadyInMention };
    if (result.moved + result.alreadyInMention === 0) break; // nothing could be moved; don't loop forever
  }
  return total;
}

// End of a run (or, with `group`, the end of one group): moves every relevant row that is left,
// one chunk (transaction) at a time.
export function moveAllRelevantRows(db, { chunk = config.MOVE_CHUNK, group = null } = {}) {
  let total = { moved: 0, alreadyInMention: 0 };
  for (;;) {
    const result = moveRelevantRows(db, { limit: chunk, group });
    if (result.moved + result.alreadyInMention === 0) return total;
    total = { moved: total.moved + result.moved, alreadyInMention: total.alreadyInMention + result.alreadyInMention };
  }
}

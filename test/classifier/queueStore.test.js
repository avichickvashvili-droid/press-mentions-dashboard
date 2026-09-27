// queueStore.test.js — claiming, saving answers and giving rows back (queueStore.js), the
// poison-article rule after crashes (D59), suspect rows claimed one at a time (D78), and moving
// relevant rows to Mention (mover.js). Offline, on a temporary SQLite file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTempDb } from '../helpers.js';
import { addCompanies, addQueueRows, addRun, queueRows } from './classifierHelpers.js';
import {
  claimBatch, countQueue, giveBackClaims, isQueueDrained, releaseAbandonedClaims, releaseOwnClaimsAfterCrash, saveBatchResults,
} from '../../src/classifier/queueStore.js';
import { moveAllRelevantRows, moveFullChunks, moveRelevantRows } from '../../src/classifier/mover.js';
import { readQueueCounts } from '../../src/collector/bufferWriter.js';

const NOW = '2026-09-27T10:00:00.000Z';

function setup(t, rows) {
  const { db } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey', section: 1 }, { id: 'ukko', name: 'Ukko', section: 2 }]);
  const ids = addQueueRows(db, rows);
  return { db, ids };
}

test('claims the oldest waiting rows, adds 1 to attempts first, and never gives a row twice', (t) => {
  const { db, ids } = setup(t, [
    { companyId: 'harvey', guid: 'a', title: 'A' },
    { companyId: 'ukko', guid: 'b', title: 'B', status: 'failed', attempts: 2 },
    { companyId: 'harvey', guid: 'c', title: 'C', status: 'failed', attempts: 3 }, // failed for good
    { companyId: 'harvey', guid: 'd', title: 'D', status: 'relevant', sentiment: 'positive' },
    { companyId: 'harvey', guid: 'e', title: 'E' },
  ]);
  const first = claimBatch(db, { limit: 2, pid: 111, now: NOW });
  assert.deepEqual(first.map((row) => row.id), [ids[0], ids[1]]);
  assert.deepEqual(first.map((row) => row.attempts), [1, 3]);
  assert.equal(first[1].company_name, 'Ukko');
  assert.equal(first[1].company_section, 2);

  const second = claimBatch(db, { limit: 10, pid: 222, now: NOW });
  assert.deepEqual(second.map((row) => row.id), [ids[4]]); // not the claimed ones, not failed-for-good, not relevant
  const rows = queueRows(db);
  assert.equal(rows[0].claimed_by_pid, 111);
  assert.equal(rows[0].claimed_at, NOW);
  assert.equal(rows[4].claimed_by_pid, 222);
});

test('saving a batch: irrelevant deleted, relevant kept with sentiment, invalid marked failed, run counters updated', (t) => {
  const { db, ids } = setup(t, [
    { companyId: 'harvey', guid: 'a', title: 'A' },
    { companyId: 'harvey', guid: 'b', title: 'B' },
    { companyId: 'harvey', guid: 'c', title: 'C' },
    { companyId: 'harvey', guid: 'd', title: 'D', status: 'failed', attempts: 2 },
  ]);
  const runId = addRun(db, { status: 'running' });
  const rows = claimBatch(db, { limit: 10, pid: 111, now: NOW });
  const saved = saveBatchResults(db, [
    { id: ids[0], outcome: 'irrelevant', attempts: 1 },
    { id: ids[1], outcome: 'relevant', sentiment: 'negative', attempts: 1 },
    { id: ids[2], outcome: 'invalid', attempts: 1 },
    { id: ids[3], outcome: 'invalid', attempts: rows[3].attempts }, // 3rd attempt → failed for good
  ], { pid: 111 });
  assert.deepEqual(saved, { relevant: 1, irrelevant: 1, failed: 2, failedForGood: 1 });

  const left = queueRows(db);
  assert.deepEqual(left.map((row) => [row.guid, row.status, row.sentiment, row.attempts, row.claimed_at]), [
    ['b', 'relevant', 'negative', 1, null],
    ['c', 'failed', null, 1, null],
    ['d', 'failed', null, 3, null],
  ]);
  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId);
  assert.deepEqual([run.classified_count, run.relevant_count, run.irrelevant_count, run.failed_count], [2, 1, 1, 1]);
  assert.deepEqual(countQueue(db), { pending: 0, failedRetry: 1, failedForGood: 1, relevant: 1, claimed: 0 });
});

test('a late answer for a row that another worker now holds is dropped', (t) => {
  const { db, ids } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'A' }]);
  claimBatch(db, { limit: 1, pid: 111, now: NOW });
  db.prepare('UPDATE BufferQueue SET claimed_by_pid = 222').run(); // claim moved to another worker
  const saved = saveBatchResults(db, [{ id: ids[0], outcome: 'irrelevant', attempts: 1 }], { pid: 111 });
  assert.equal(saved.irrelevant, 0);
  assert.equal(queueRows(db).length, 1);
});

test('giving rows back (Ollama down / stop) undoes the attempt; a crash release keeps it, marks the row suspect, and fails it for good at MAX_ATTEMPTS', (t) => {
  const { db, ids } = setup(t, [
    { companyId: 'harvey', guid: 'a', title: 'A' },
    { companyId: 'harvey', guid: 'b', title: 'B' },
    { companyId: 'harvey', guid: 'c', title: 'C', attempts: 2 },                     // 3rd try now
    { companyId: 'harvey', guid: 'd', title: 'D', status: 'failed', attempts: 2 },   // 3rd try now
  ]);
  const runId = addRun(db, { status: 'collected' });
  claimBatch(db, { limit: 4, pid: 111, now: NOW });
  assert.equal(giveBackClaims(db, [ids[0]], { pid: 111 }), 1);
  assert.equal(giveBackClaims(db, [ids[1]], { pid: 999 }), 0); // not ours
  assert.equal(releaseOwnClaimsAfterCrash(db, { pid: 111 }), 3);
  const rows = queueRows(db);
  assert.deepEqual(rows.map((row) => [row.guid, row.attempts, row.claimed_at, row.claimed_by_pid, row.status, row.suspect]), [
    ['a', 0, null, null, 'pending', 0], // given back: attempt undone, not suspect
    ['b', 1, null, null, 'pending', 1], // crash: attempt kept, suspect
    ['c', 3, null, null, 'failed', 0],  // crash on its 3rd attempt: failed for good (poison rule)
    ['d', 3, null, null, 'failed', 0],
  ]);
  assert.equal(db.prepare('SELECT failed_count FROM JobRun WHERE id = ?').get(runId).failed_count, 2, 'counted as failed for good (D64)');
  assert.deepEqual(countQueue(db), { pending: 2, failedRetry: 0, failedForGood: 2, relevant: 0, claimed: 0 });
});

test('a row that has used all its attempts is never claimed, whatever its status', (t) => {
  const { db, ids } = setup(t, [
    { companyId: 'harvey', guid: 'a', title: 'A', status: 'pending', attempts: 3 },
    { companyId: 'harvey', guid: 'b', title: 'B', status: 'failed', attempts: 3 },
    { companyId: 'harvey', guid: 'c', title: 'C' },
  ]);
  assert.deepEqual(claimBatch(db, { limit: 10, pid: 111, now: NOW }).map((row) => row.id), [ids[2]]);
});

test('poison article: 3 crashes (stop handler and dead-worker release) → failed for good, never claimed again, queue drained', (t) => {
  const { db, ids } = setup(t, [{ companyId: 'harvey', guid: 'poison', title: 'P' }]);
  const runId = addRun(db, { status: 'collected' });
  // Crash 1: the classifier's crash handler releases its own claims.
  claimBatch(db, { limit: 1, pid: 111, now: NOW });
  releaseOwnClaimsAfterCrash(db, { pid: 111 });
  // Crash 2: hard kill; the next classifier releases the dead worker's claim.
  claimBatch(db, { limit: 1, pid: 222, now: NOW });
  releaseAbandonedClaims(db, { now: Date.parse(NOW), isAlive: () => false });
  // Crash 3: the crash handler again.
  claimBatch(db, { limit: 1, pid: 333, now: NOW });
  releaseOwnClaimsAfterCrash(db, { pid: 333 });

  const [row] = queueRows(db);
  assert.deepEqual([row.id, row.status, row.attempts, row.claimed_at], [ids[0], 'failed', 3, null]);
  assert.deepEqual(claimBatch(db, { limit: 10, pid: 444, now: NOW }), []);
  assert.equal(isQueueDrained(db), true);
  assert.deepEqual(readQueueCounts(db), { live: 0, dead: 1 }, 'the collector does not count it toward the CAP (D72)');
  assert.equal(db.prepare('SELECT failed_count FROM JobRun WHERE id = ?').get(runId).failed_count, 1);
});

test('suspect rows are claimed one at a time, before any normal batch (D78)', (t) => {
  const { db, ids } = setup(t, [
    { companyId: 'harvey', guid: 'a', title: 'A' },
    { companyId: 'harvey', guid: 'b', title: 'B' },
    { companyId: 'harvey', guid: 'c', title: 'C' },
    { companyId: 'harvey', guid: 'd', title: 'D' },
  ]);
  // A worker takes a, b, c and dies.
  claimBatch(db, { limit: 3, pid: 111, now: NOW });
  releaseAbandonedClaims(db, { now: Date.parse(NOW), isAlive: () => false });
  assert.deepEqual(queueRows(db).map((row) => row.suspect), [1, 1, 1, 0]);

  // Two workers each get ONE suspect row, even though they ask for 10.
  const first = claimBatch(db, { limit: 10, pid: 222, now: NOW });
  const second = claimBatch(db, { limit: 10, pid: 333, now: NOW });
  assert.deepEqual([first.map((row) => row.id), second.map((row) => row.id)], [[ids[0]], [ids[1]]]);

  // An answer clears the suspect mark; a give-back (Ollama down) keeps it.
  saveBatchResults(db, [{ id: ids[0], outcome: 'relevant', sentiment: 'neutral', attempts: 2 }], { pid: 222 });
  giveBackClaims(db, null, { pid: 333 });
  assert.deepEqual(queueRows(db).map((row) => [row.guid, row.suspect, row.attempts]), [['a', 0, 2], ['b', 1, 1], ['c', 1, 1], ['d', 0, 0]]);

  // Suspects b and c go first, alone; only then does a normal batch come.
  assert.deepEqual(claimBatch(db, { limit: 10, pid: 444, now: NOW }).map((row) => row.guid), ['b']);
  assert.deepEqual(claimBatch(db, { limit: 10, pid: 444, now: NOW }).map((row) => row.guid), ['c']);
  assert.deepEqual(claimBatch(db, { limit: 10, pid: 444, now: NOW }).map((row) => row.guid), ['d']);
});

test('abandoned claims are released: dead process at once, live process only after the timeout', (t) => {
  const { db } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'A' }, { companyId: 'harvey', guid: 'b', title: 'B' }, { companyId: 'harvey', guid: 'c', title: 'C' }]);
  claimBatch(db, { limit: 1, pid: 111, now: NOW });                        // dead worker
  claimBatch(db, { limit: 1, pid: 222, now: NOW });                        // live, recent
  claimBatch(db, { limit: 1, pid: 333, now: '2026-09-27T09:40:00.000Z' }); // live, 20 min old
  const isAlive = (pid) => pid !== 111;
  const released = releaseAbandonedClaims(db, { now: Date.parse(NOW) + 1000, isAlive, timeoutMs: 10 * 60 * 1000 });
  assert.equal(released, 2);
  assert.deepEqual(queueRows(db).map((row) => [row.claimed_by_pid, row.attempts, row.suspect]), [[null, 1, 1], [222, 1, 0], [null, 1, 1]]);
});

test('isQueueDrained ignores failed-for-good and relevant rows, but not pending, retryable or claimed ones', (t) => {
  const { db } = setup(t, [
    { companyId: 'harvey', guid: 'a', title: 'A', status: 'failed', attempts: 3 },
    { companyId: 'harvey', guid: 'b', title: 'B', status: 'relevant', sentiment: 'neutral' },
  ]);
  assert.equal(isQueueDrained(db), true);
  addQueueRows(db, [{ companyId: 'harvey', guid: 'c', title: 'C', status: 'failed', attempts: 1 }]);
  assert.equal(isQueueDrained(db), false);
});

test('moving relevant rows: one chunk per transaction, oldest first, Google link kept', (t) => {
  const { db } = setup(t, [
    { companyId: 'harvey', guid: 'a', title: 'A - Example News', status: 'relevant', sentiment: 'positive' },
    { companyId: 'harvey', guid: 'b', title: 'B', status: 'relevant', sentiment: 'neutral' },
    { companyId: 'harvey', guid: 'c', title: 'C', status: 'pending' },
  ]);
  assert.deepEqual(moveRelevantRows(db, { limit: 1 }), { moved: 1, alreadyInMention: 0 });
  const mention = db.prepare('SELECT * FROM Mention').get();
  assert.equal(mention.guid, 'a');
  assert.equal(mention.url, 'https://news.google.com/rss/articles/a');
  assert.equal(mention.title, 'A - Example News');
  assert.equal(mention.sentiment, 'positive');
  assert.equal(mention.first_seen_at, '2026-09-26T08:00:00.000Z');
  assert.equal(mention.alerted_at, null);
  assert.deepEqual(queueRows(db).map((row) => row.guid), ['b', 'c']);
});

test('an article already in Mention is not overwritten; its queue copy is removed', (t) => {
  const { db } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'A', status: 'relevant', sentiment: 'negative' }]);
  db.prepare(`INSERT INTO Mention (company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment, alerted_at)
              VALUES ('harvey', 'a', 'u', 'Old', 'P', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'positive', '2026-09-02T00:00:00.000Z')`).run();
  assert.deepEqual(moveRelevantRows(db), { moved: 0, alreadyInMention: 1 });
  const mention = db.prepare('SELECT * FROM Mention').get();
  assert.equal(mention.sentiment, 'positive');
  assert.equal(mention.alerted_at, '2026-09-02T00:00:00.000Z');
  assert.equal(queueRows(db).length, 0);
});

test('during a run only full chunks move; at the end everything moves', (t) => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ companyId: 'harvey', guid: `g${index}`, title: `T${index}`, status: 'relevant', sentiment: 'neutral' }));
  const { db } = setup(t, rows);
  assert.equal(moveFullChunks(db, { chunk: 2 }).moved, 4);
  assert.equal(moveFullChunks(db, { chunk: 2 }).moved, 0); // 1 left, below the chunk
  assert.equal(moveAllRelevantRows(db, { chunk: 2 }).moved, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention').get().n, 5);
});

// bufferWriter.test.js — tests of the item rules and the BufferQueue writer:
// outside-window drop, bad-item skip, insert-if-absent (guid + D33), the CAP pause/resume, and
// leaving rows that failed for good out of the CAP count (D72).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { parseFeed } from '../src/collector/googleNews.js';
import { runRange } from '../src/collector/dateWindows.js';
import { sortItems } from '../src/collector/itemRules.js';
import { stripPublisherSuffix } from '../src/shared/text.js';
import { countQueue, createDeadRowReporter, insertChunk, readQueueCounts, waitForQueueSpace } from '../src/collector/bufferWriter.js';
import { TEST_NOW, makeTempDb, readFixture } from './helpers.js';

const RANGE = runRange(new Date(TEST_NOW).toISOString()); // 2026-06-30 .. 2026-09-27

// Adds one company row so BufferQueue/Mention rows can point to it.
function addCompany(db, id = 'harvey') {
  db.prepare("INSERT INTO Company (id, name, section, hint, query_param) VALUES (?, ?, 1, NULL, 'q')").run(id, id);
}

// A ready-to-store item.
function item(guid, title, publisher = 'Reuters') {
  return { guid, url: `https://news.google.com/${guid}`, title, publisher, published_at: '2026-09-21T07:00:00.000Z' };
}

test('items dated outside the 90 days are dropped; both edge days are kept', () => {
  const { items } = parseFeed(readFixture('feed-outside-window.xml'));
  const { good, bad, outside } = sortItems(items, RANGE);
  assert.deepEqual(good.map((i) => i.guid), ['FIRSTDAY', 'LASTDAY']);
  assert.equal(outside, 2);
  assert.equal(bad.length, 0);
});

test('items missing guid, link, title or a readable date are skipped with a reason', () => {
  const { items } = parseFeed(readFixture('feed-bad-items.xml'));
  const { good, bad } = sortItems(items, RANGE);
  assert.deepEqual(good.map((i) => i.guid), ['GOOD']);
  assert.deepEqual(bad.map((b) => b.reason), ['missing guid', 'missing link', 'missing title', 'missing readable date']);
});

test('the whole headline is stored as-is; an empty publisher becomes NULL', () => {
  const { items } = parseFeed(readFixture('feed-basic.xml'));
  const { good } = sortItems(items, RANGE);
  assert.equal(good[0].title, 'Harvey raises $300M at a $3B valuation - Reuters');
  assert.equal(good[0].publisher, 'Reuters');
  assert.equal(good[0].published_at, '2026-09-21T07:00:00.000Z');
  assert.equal(good[2].publisher, null);
});

test('stripPublisherSuffix removes only the exact trailing " - Publisher"', () => {
  assert.equal(stripPublisherSuffix('Big news - Reuters', 'Reuters'), 'Big news');
  assert.equal(stripPublisherSuffix('Big news - Reuters Health', 'Reuters'), 'Big news - Reuters Health');
  assert.equal(stripPublisherSuffix('Big news - Reuters', null), 'Big news - Reuters');
});

test('insertChunk stores rows as pending with attempts 0 and the full headline', (t) => {
  const { db } = makeTempDb(t);
  addCompany(db);
  const result = insertChunk(db, 'harvey', [item('g1', 'Story - Reuters')], '2026-09-27T10:00:00.000Z');
  assert.deepEqual(result, { inserted: 1, duplicates: 0 });
  const row = db.prepare('SELECT * FROM BufferQueue').get();
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 0);
  assert.equal(row.title, 'Story - Reuters');
  assert.equal(row.url, 'https://news.google.com/g1');
  assert.equal(row.first_seen_at, '2026-09-27T10:00:00.000Z');
});

test('the same chunk inserted again adds 0 rows and changes nothing', (t) => {
  const { db } = makeTempDb(t);
  addCompany(db);
  const chunk = [item('g1', 'One - Reuters'), item('g2', 'Two - Reuters'), item('g3', 'Three', null)];
  insertChunk(db, 'harvey', chunk);
  db.prepare("UPDATE BufferQueue SET status = 'relevant', sentiment = 'positive' WHERE guid = 'g1'").run();
  const before = db.prepare('SELECT * FROM BufferQueue ORDER BY id').all();
  const again = insertChunk(db, 'harvey', chunk);
  assert.deepEqual(again, { inserted: 0, duplicates: 3 });
  assert.deepEqual(db.prepare('SELECT * FROM BufferQueue ORDER BY id').all(), before, 'never overwritten');
});

test('an article already in Mention is skipped (guid check across both tables)', (t) => {
  const { db } = makeTempDb(t);
  addCompany(db);
  db.prepare(`INSERT INTO Mention (company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment)
              VALUES ('harvey', 'g1', 'u', 'Old title - Reuters', 'Reuters', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z', 'neutral')`).run();
  assert.deepEqual(insertChunk(db, 'harvey', [item('g1', 'Totally new title - Reuters')]), { inserted: 0, duplicates: 1 });
});

test('D33: same company + publisher + title (suffix ignored) is a duplicate even with a new guid', (t) => {
  const { db } = makeTempDb(t);
  addCompany(db);
  addCompany(db, 'other');
  insertChunk(db, 'harvey', [item('g1', 'Harvey raises $300M - Reuters')]);
  db.prepare(`INSERT INTO Mention (company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment)
              VALUES ('harvey', 'm1', 'u', 'Harvey signs a deal - Reuters', 'Reuters', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z', 'neutral')`).run();

  // Same headline, new guid -> duplicate (in BufferQueue); same for Mention.
  assert.equal(insertChunk(db, 'harvey', [item('g2', 'Harvey raises $300M - Reuters')]).duplicates, 1);
  assert.equal(insertChunk(db, 'harvey', [item('g3', 'Harvey signs a deal - Reuters')]).duplicates, 1);
  // Same headline without the suffix -> still a duplicate (compared without " - Publisher").
  assert.equal(insertChunk(db, 'harvey', [item('g4', 'Harvey raises $300M')]).duplicates, 1);
  // Other publisher, other company, or no publisher -> not a duplicate.
  assert.equal(insertChunk(db, 'harvey', [item('g5', 'Harvey raises $300M - Reuters', 'Reuters UK')]).inserted, 1);
  assert.equal(insertChunk(db, 'other', [item('g6', 'Harvey raises $300M - Reuters')]).inserted, 1);
  assert.equal(insertChunk(db, 'harvey', [item('g7', 'Harvey raises $300M - Reuters', null)]).inserted, 1);
  // The stored titles are the full headlines.
  assert.equal(db.prepare("SELECT title FROM BufferQueue WHERE guid = 'g1'").get().title, 'Harvey raises $300M - Reuters');
});

test('a chunk is all-or-nothing: an error inside rolls the whole chunk back', (t) => {
  const { db } = makeTempDb(t);
  addCompany(db);
  const broken = { ...item('g2', 'Two - Reuters'), url: null }; // url is NOT NULL -> the insert fails
  assert.throws(() => insertChunk(db, 'harvey', [item('g1', 'One - Reuters'), broken]));
  assert.equal(countQueue(db), 0);
});

// Fills BufferQueue with `count` rows quickly (one transaction).
function fillQueue(db, count) {
  db.exec('BEGIN');
  const insert = db.prepare(`INSERT INTO BufferQueue (company_id, guid, url, title, publisher, published_at, first_seen_at)
                             VALUES ('harvey', ?, 'u', ?, 'P', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')`);
  for (let i = 0; i < count; i += 1) insert.run(`fill-${i}`, `t${i}`);
  db.exec('COMMIT');
}

test('CAP: no wait while queue + chunk fits within 10,000', async (t) => {
  const { db } = makeTempDb(t);
  addCompany(db);
  fillQueue(db, config.CAP - 100);
  let waited = 0;
  await waitForQueueSpace(db, 100, { sleep: async () => { waited += 1; } });
  assert.equal(waited, 0);
});

test('CAP: pauses when over 10,000, re-checks every 5 s and resumes only at 8,000', async (t) => {
  const { db } = makeTempDb(t);
  addCompany(db);
  fillQueue(db, config.CAP - 50); // 9,950 + a chunk of 100 > 10,000 -> pause
  const waits = [];
  const seenCounts = [];
  // Each wait = the classifier removes some rows: 9,950 -> 8,950 -> 8,001 -> 8,000.
  const removals = [1000, 949, 1, 0];
  const sleep = async (ms) => {
    waits.push(ms);
    const remove = removals.shift() ?? 0;
    db.prepare('DELETE FROM BufferQueue WHERE id IN (SELECT id FROM BufferQueue LIMIT ?)').run(remove);
  };
  const finalCount = await waitForQueueSpace(db, 100, { sleep, onWaiting: (count) => seenCounts.push(count) });
  assert.equal(finalCount, 8000);
  assert.deepEqual(waits, [5000, 5000, 5000], 'still waits at 8,950 and 8,001 although a chunk would fit');
  assert.deepEqual(seenCounts, [9950, 8950, 8001]);
});

// Adds `count` rows with the given status and attempts (one transaction).
function addRows(db, prefix, count, status, attempts) {
  db.exec('BEGIN');
  const insert = db.prepare(`INSERT INTO BufferQueue (company_id, guid, url, title, publisher, published_at, first_seen_at, status, attempts)
                             VALUES ('harvey', ?, 'u', ?, 'P', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z', ?, ?)`);
  for (let i = 0; i < count; i += 1) insert.run(`${prefix}-${i}`, `${prefix} ${i}`, status, attempts);
  db.exec('COMMIT');
}

test('D72: rows that failed for good (failed + attempts >= MAX_ATTEMPTS) are not counted', (t) => {
  const { db } = makeTempDb(t);
  addCompany(db);
  addRows(db, 'pending', 5, 'pending', 0);
  addRows(db, 'retry', 4, 'failed', config.MAX_ATTEMPTS - 1); // may still be retried: counted
  addRows(db, 'dead', 7, 'failed', config.MAX_ATTEMPTS);      // failed for good: not counted
  addRows(db, 'dead-more', 2, 'failed', config.MAX_ATTEMPTS + 1);
  assert.deepEqual(readQueueCounts(db), { live: 9, dead: 9 });
  assert.equal(countQueue(db), 9);
});

test('D72: a queue full of dead rows does not block the collector; the count is reported', async (t) => {
  const { db } = makeTempDb(t);
  addCompany(db);
  addRows(db, 'dead', config.CAP, 'failed', config.MAX_ATTEMPTS);
  const deadCounts = [];
  let waited = 0;
  const count = await waitForQueueSpace(db, 100, { sleep: async () => { waited += 1; }, onDeadRows: (n) => deadCounts.push(n) });
  assert.equal(count, 0);
  assert.equal(waited, 0);
  assert.deepEqual(deadCounts, [config.CAP]);
});

test('D72: the dead-row warning is printed only when the number changes', () => {
  const warnings = [];
  const report = createDeadRowReporter((text) => warnings.push(text));
  for (const n of [0, 12, 12, 12, 15, 15, 0, 0, 3]) report(n);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /^12 queue rows failed the AI step for good \(3 attempts\)/);
  assert.match(warnings[1], /^15 /);
  assert.match(warnings[2], /^3 /);
});

// dailyStore.test.js — the daily job's database steps (src/daily/dailyStore.js, D102, D106): the
// first-run marking, the DailyRun lock, the new mentions and marking them alerted, the process
// lock (one `npm run daily` at a time), the reason given for an open 90-day collection, and the
// time of the newest mention (a database filled from data/).
// Offline: a temporary database.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTempDb } from '../helpers.js';
import { addCompanies, addRun } from '../classifier/classifierHelpers.js';
import {
  DailyRunBusyError, describeOpenCollection, findLastDoneDailyRun, findNewestMentionSeen, findOpenCollection, finishDailyRun,
  markAlerted, readNewMentions, startDailyRun, summarizeByCompany,
} from '../../src/daily/dailyStore.js';

// Adds mentions: [{ companyId, guid, sentiment, alertedAt? }].
function addMentions(db, mentions) {
  const insert = db.prepare(`INSERT INTO Mention (company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment, alerted_at)
                             VALUES (?, ?, 'https://x', ?, 'Pub', '2026-09-27T08:00:00.000Z', '2026-09-27T09:00:00.000Z', ?, ?)`);
  for (const m of mentions) insert.run(m.companyId, m.guid, `${m.guid} title`, m.sentiment ?? 'positive', m.alertedAt ?? null);
}

// A database with two companies and three mentions that were never alerted.
function setup(t) {
  const { db } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }, { id: 'ukko', name: 'Ukko' }]);
  addMentions(db, [
    { companyId: 'harvey', guid: 'h1', sentiment: 'positive' },
    { companyId: 'harvey', guid: 'h2', sentiment: 'negative' },
    { companyId: 'ukko', guid: 'u1', sentiment: 'neutral' },
  ]);
  return db;
}

const T1 = '2026-09-28T00:00:00.000Z';
const T2 = '2026-09-29T00:00:00.000Z';

test('the first daily run ever marks every mention that is already there as alerted', (t) => {
  const db = setup(t);
  assert.equal(readNewMentions(db).length, 3); // before any daily run: all "new" (expected, Prompt 292)
  const { runId, baselineMarked } = startDailyRun(db, { pid: 111, now: T1, isAlive: () => true });
  assert.equal(baselineMarked, 3);
  assert.equal(readNewMentions(db).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention WHERE alerted_at = ?').get(T1).n, 3);
  assert.deepEqual({ ...db.prepare('SELECT status, owner_pid FROM DailyRun WHERE id = ?').get(runId) }, { status: 'running', owner_pid: 111 });
});

test('later runs never mark anything at start: mentions that failed to go out stay new', (t) => {
  const db = setup(t);
  const first = startDailyRun(db, { pid: 111, now: T1, isAlive: () => true });
  finishDailyRun(db, first.runId, { status: 'done', now: T1 });
  addMentions(db, [{ companyId: 'ukko', guid: 'u2' }]); // a new mention whose alert failed
  const second = startDailyRun(db, { pid: 111, now: T2, isAlive: () => true });
  assert.equal(second.baselineMarked, 0);
  assert.deepEqual(readNewMentions(db).map((m) => m.companyId), ['ukko']);
});

test('the lock: a running daily run of a live process blocks a second one, and nothing changes', (t) => {
  const db = setup(t);
  startDailyRun(db, { pid: 111, now: T1, isAlive: () => true });
  assert.throws(() => startDailyRun(db, { pid: 222, now: T2, isAlive: (pid) => pid === 111 }), DailyRunBusyError);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM DailyRun').get().n, 1);
});

test('a running daily run whose process is gone is marked failed, and a new run starts', (t) => {
  const db = setup(t);
  const cut = startDailyRun(db, { pid: 111, now: T1, isAlive: () => true });
  const next = startDailyRun(db, { pid: 222, now: T2, isAlive: () => false });
  const old = db.prepare('SELECT * FROM DailyRun WHERE id = ?').get(cut.runId);
  assert.equal(old.status, 'failed');
  assert.equal(old.owner_pid, null);
  assert.match(old.last_error, /stopped in the middle/);
  assert.equal(db.prepare('SELECT status FROM DailyRun WHERE id = ?').get(next.runId).status, 'running');
});

test('finishDailyRun: saves the counts and the alert time, only on a running row', (t) => {
  const db = setup(t);
  const { runId } = startDailyRun(db, { pid: 111, now: T1, isAlive: () => true });
  assert.equal(finishDailyRun(db, runId, { status: 'done', newMentions: 4, alertSentAt: T2, now: T2 }), true);
  assert.equal(finishDailyRun(db, runId, { status: 'failed', now: T2 }), false);
  const row = db.prepare('SELECT * FROM DailyRun WHERE id = ?').get(runId);
  assert.deepEqual([row.status, row.new_mentions, row.alert_sent_at, row.finished_at, row.owner_pid], ['done', 4, T2, T2, null]);
  assert.equal(findLastDoneDailyRun(db).id, runId);
});

test('readNewMentions + summarizeByCompany: counts per company and sentiment, most first, ties A-Z', (t) => {
  const db = setup(t);
  addCompanies(db, [{ id: 'alpha', name: 'alpha tau' }]);
  addMentions(db, [{ companyId: 'alpha', guid: 'a1', sentiment: 'negative' }]);
  const summary = summarizeByCompany(readNewMentions(db));
  assert.deepEqual(summary.map((c) => [c.name, c.total, c.positive, c.neutral, c.negative]), [
    ['Harvey', 2, 1, 0, 1],
    ['alpha tau', 1, 0, 0, 1],
    ['Ukko', 1, 0, 1, 0],
  ]);
  assert.equal(summary[0].mentionIds.length, 2);
});

test('markAlerted: marks exactly the given mentions, and only ones not alerted yet', (t) => {
  const db = setup(t);
  const ids = readNewMentions(db).filter((m) => m.companyId === 'harvey').map((m) => m.id);
  assert.equal(markAlerted(db, ids, { now: T1 }), 2);
  assert.equal(markAlerted(db, ids, { now: T2 }), 0); // already alerted: the time is not changed
  assert.deepEqual(readNewMentions(db).map((m) => m.companyId), ['ukko']);
  assert.equal(db.prepare("SELECT alerted_at FROM Mention WHERE guid = 'h1'").get().alerted_at, T1);
  assert.equal(markAlerted(db, []), 0);
});

test('findOpenCollection: a 90-day collection that is running or collected blocks the daily job', (t) => {
  const db = setup(t);
  assert.equal(findOpenCollection(db), undefined);
  const done = addRun(db, { status: 'done' });
  assert.equal(findOpenCollection(db), undefined);
  db.prepare("UPDATE JobRun SET status = 'collected' WHERE id = ?").run(done);
  assert.equal(findOpenCollection(db).status, 'collected');
});

test('the reason for an open 90-day collection: collecting, classifying, or stopped halfway', (t) => {
  const db = setup(t);
  const now = Date.parse('2026-09-27T09:05:00.000Z'); // 5 min after the test heartbeat
  const runId = addRun(db, { status: 'running', ownerPid: 555 });
  const run = findOpenCollection(db);
  assert.equal(describeOpenCollection(run, { now, isAlive: () => true }), `the 90-day collection (run ${runId}) is still collecting`);
  const stopped = describeOpenCollection(run, { now, isAlive: () => false }); // its program is gone
  assert.match(stopped, new RegExp(`the 90-day collection \\(run ${runId}\\) was stopped halfway and nothing is working on it`));
  assert.match(stopped, /Run "npm start" to finish it; the daily job waits until then/);
  db.prepare('UPDATE JobRun SET owner_pid = NULL').run(); // released by its emergency heartbeat
  assert.match(describeOpenCollection(findOpenCollection(db), { now, isAlive: () => true }), /stopped halfway/);
  db.prepare("UPDATE JobRun SET status = 'collected'").run();
  assert.match(describeOpenCollection(findOpenCollection(db), { now }), /still being classified/);
});

test('findNewestMentionSeen: when the newest mention was first seen, or null', (t) => {
  const db = setup(t);
  assert.equal(findNewestMentionSeen(db), '2026-09-27T09:00:00.000Z');
  db.exec('DELETE FROM Mention');
  assert.equal(findNewestMentionSeen(db), null);
});

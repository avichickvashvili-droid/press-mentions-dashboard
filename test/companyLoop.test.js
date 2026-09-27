// companyLoop.test.js — tests of the whole collector loop (src/collector/companyLoop.js) with a
// fake Google News: window split order, permanent failures, bad items, crash + resume, and the
// end of the run ('collected', owner_pid released, heartbeat stopped).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCompanies } from '../src/seed/seedLoader.js';
import { CollectedRunPendingError, acquireRun, writeEmergencyHeartbeat } from '../src/collector/jobLock.js';
import { createGoogleNewsClient } from '../src/collector/googleNews.js';
import { buildSummary, createSessionStats, runCompanyLoop } from '../src/collector/companyLoop.js';
import { buildWindowQuery, formatDay, runRange, splitWindow } from '../src/collector/dateWindows.js';
import {
  TEST_KEYWORDS, TEST_NOW, makeFakeFetch, makeFeed, makeItems, makeSilentProgress, makeTempDb, queryOf, readFixture, writeDataFiles,
} from './helpers.js';

const RANGE = runRange(new Date(TEST_NOW).toISOString());
const EMPTY = { status: 200, body: readFixture('feed-empty.xml') };
const noWait = async () => {};

// Seeds Alpha, Beta (section 1) and Gamma (section 2) and starts a run owned by pid 1.
function setUpRun(t) {
  const { db, dir } = makeTempDb(t);
  const seed = seedCompanies(db, writeDataFiles(dir, { list: '## 2. Health\nGamma\n## 1. Tech\nAlpha\nBeta\n', keywords: TEST_KEYWORDS }));
  const order = [...seed.companies].sort((a, b) => a.section - b.section).map((c) => c.id);
  const run = acquireRun(db, order, { now: TEST_NOW, pid: 1 });
  return { db, runId: run.runId };
}

// A real Google News client over a fake fetch; `answer(query)` gives { status, body }.
function fakeClient(answer) {
  const fetchImpl = makeFakeFetch((url) => answer(queryOf(url)));
  const client = createGoogleNewsClient({ fetchImpl, sleep: noWait, now: () => 0, random: () => 0 });
  return { client, fetchImpl, queries: () => fetchImpl.calls.map(queryOf) };
}

// The checklist of a run as [[company_id, status, error]].
function checklist(db, runId) {
  return db.prepare('SELECT company_id, status, error FROM JobRunCompany WHERE run_id = ? ORDER BY rowid').all(runId)
    .map((r) => [r.company_id, r.status, r.error]);
}

test('companies go in section order; a permanent error fails only that company; the run ends collected', async (t) => {
  const { db, runId } = setUpRun(t);
  const { client, queries } = fakeClient((query) => {
    if (query.includes('"Alpha"')) return { status: 200, body: readFixture('feed-basic.xml') };
    if (query.includes('"Beta"')) return { status: 400 };
    return EMPTY;
  });
  const progress = makeSilentProgress();
  let heartbeatStopped = false;
  const stats = await runCompanyLoop({
    db, runId, client, progress, wait: noWait,
    stopHeartbeat: () => {
      heartbeatStopped = true;
      assert.equal(db.prepare('SELECT status FROM JobRun WHERE id = ?').get(runId).status, 'running', 'stopped before collected');
    },
  });

  assert.deepEqual(queries().map((q) => q.match(/"(\w+)"/)[1]), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(checklist(db, runId), [
    ['alpha', 'finished', null],
    ['beta', 'failed', 'Google rejected the search (HTTP 400)'],
    ['gamma', 'finished', null],
  ]);
  assert.equal(stats.inserted, 3);

  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId);
  assert.equal(run.status, 'collected');
  assert.ok(run.finished_at);
  assert.equal(run.owner_pid, null, 'released to the classifier');
  assert.equal(heartbeatStopped, true);

  const summary = buildSummary(db, runId, stats);
  assert.match(summary, /2 finished, 1 failed/);
  assert.match(summary, /Beta — Google rejected the search \(HTTP 400/);
  assert.match(summary, /articles added to the queue: +3/);
});

test('after the run is collected, a new collect is refused until the run is done', async (t) => {
  const { db, runId } = setUpRun(t);
  const { client } = fakeClient(() => EMPTY);
  await runCompanyLoop({ db, runId, client, progress: makeSilentProgress(), wait: noWait });
  assert.throws(() => acquireRun(db, ['alpha'], { now: TEST_NOW, pid: 2 }), CollectedRunPendingError);
  db.prepare("UPDATE JobRun SET status = 'done' WHERE id = ?").run(runId);
  assert.equal(acquireRun(db, ['alpha'], { now: TEST_NOW, pid: 2 }).tookOver, false);
});

test('the search is: date part first, then query_param, over the full 90 days', async (t) => {
  const { db, runId } = setUpRun(t);
  const { client, queries } = fakeClient(() => EMPTY);
  await runCompanyLoop({ db, runId, client, progress: makeSilentProgress(), wait: noWait });
  assert.equal(queries()[0], 'after:2026-06-29 before:2026-09-28 "Alpha" (company OR AI)');
});

test('a full window (95+) is stored, then split depth-first, oldest half first', async (t) => {
  const { db, runId } = setUpRun(t);
  const [older, newer] = splitWindow(RANGE);
  const [olderOlder, olderNewer] = splitWindow(older);
  const full = (prefix, window) => makeFeed(makeItems(prefix, 100, formatDay(window.start)));
  const answers = new Map([
    [buildWindowQuery(RANGE, '"Alpha" (company OR AI)'), full('all', RANGE)],
    [buildWindowQuery(older, '"Alpha" (company OR AI)'), makeFeed(makeItems('old', 96, formatDay(older.start)))],
  ]);
  const { client, queries } = fakeClient((query) => {
    if (answers.has(query)) return { status: 200, body: answers.get(query) };
    return { status: 200, body: makeFeed(makeItems(`q${query.length}`, 3, '2026-09-01')) };
  });
  const stats = await runCompanyLoop({ db, runId, client, progress: makeSilentProgress(), wait: noWait });

  const alphaQueries = queries().filter((q) => q.includes('"Alpha"'));
  assert.deepEqual(alphaQueries, [RANGE, older, olderOlder, olderNewer, newer].map((w) => buildWindowQuery(w, '"Alpha" (company OR AI)')));
  // The 100 + 96 items of the full windows were kept, not thrown away.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM BufferQueue WHERE guid LIKE 'all-%' OR guid LIKE 'old-%'").get().n, 196);
  assert.ok(stats.inserted >= 196);
});

test('a window is never split below 1 day (always-full answers give 179 searches for 90 days)', async (t) => {
  const { db, runId } = setUpRun(t);
  const feed = makeFeed(makeItems('same', 100, '2026-09-01'));
  const { client, queries } = fakeClient((query) => (query.includes('"Alpha"') ? { status: 200, body: feed } : EMPTY));
  await runCompanyLoop({ db, runId, client, progress: makeSilentProgress(), wait: noWait });
  const alphaQueries = queries().filter((q) => q.includes('"Alpha"'));
  assert.equal(alphaQueries.length, 179); // 90 one-day leaves + 89 splits
  assert.equal(new Set(alphaQueries).size, 179, 'no window searched twice');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM BufferQueue WHERE company_id = 'alpha'").get().n, 100, 'repeats are skipped');
});

test('bad items and items outside the 90 days are skipped; the company still finishes', async (t) => {
  const { db, runId } = setUpRun(t);
  const { client } = fakeClient((query) => {
    if (query.includes('"Alpha"')) return { status: 200, body: readFixture('feed-bad-items.xml') };
    if (query.includes('"Beta"')) return { status: 200, body: readFixture('feed-outside-window.xml') };
    return EMPTY;
  });
  const progress = makeSilentProgress();
  const stats = await runCompanyLoop({ db, runId, client, progress, wait: noWait });
  assert.deepEqual({ ...stats }, { inserted: 3, duplicates: 0, badItems: 4, outsideRange: 2 });
  assert.equal(progress.messages.warn.filter((w) => w.startsWith('Alpha: skipped an article')).length, 4);
  assert.ok(checklist(db, runId).every(([, status]) => status === 'finished'));
});

test('crash in the middle of a company, then resume: the company is redone, nothing duplicated', async (t) => {
  const { db, runId } = setUpRun(t);
  const feeds = {
    Alpha: makeFeed(makeItems('alpha', 5)),
    Beta: makeFeed(makeItems('beta', 5)),
    Gamma: makeFeed(makeItems('gamma', 5)),
  };
  const answer = (query) => ({ status: 200, body: feeds[query.match(/"(\w+)"/)[1]] });

  // First session: a bug-like error while Beta is being collected (after its chunk was saved).
  const real = fakeClient(answer);
  let betaCalls = 0;
  const crashingClient = {
    async search(query) {
      const result = await real.client.search(query);
      if (query.includes('"Beta"') && (betaCalls += 1) === 1) {
        db.prepare("INSERT INTO BufferQueue (company_id, guid, url, title, publisher, published_at, first_seen_at) VALUES ('beta', 'beta-0', 'u', 'beta story number 0 - Example News', 'Example News', '2026-09-20T12:00:00.000Z', 'x')").run();
        throw new Error('unexpected bug');
      }
      return result;
    },
  };
  await assert.rejects(runCompanyLoop({ db, runId, client: crashingClient, progress: makeSilentProgress(), wait: noWait }), /unexpected bug/);
  assert.deepEqual(checklist(db, runId).map(([id, status]) => [id, status]), [['alpha', 'finished'], ['beta', 'fetching'], ['gamma', 'not_started']]);
  writeEmergencyHeartbeat(db, runId, 'crashed: Error: unexpected bug', { pid: 1 });

  // Second session: take over and continue.
  const resumed = acquireRun(db, ['alpha', 'beta', 'gamma'], { now: TEST_NOW + 3600000, pid: 2 });
  assert.deepEqual([resumed.runId, resumed.tookOver], [runId, true]);
  const second = fakeClient(answer);
  const stats = await runCompanyLoop({ db, runId, client: second.client, progress: makeSilentProgress(), wait: noWait });

  assert.deepEqual(second.queries().map((q) => q.match(/"(\w+)"/)[1]), ['Beta', 'Gamma'], 'Alpha is not searched again');
  assert.deepEqual({ inserted: stats.inserted, duplicates: stats.duplicates }, { inserted: 9, duplicates: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n, 15);
  assert.ok(checklist(db, runId).every(([, status]) => status === 'finished'));
  assert.equal(db.prepare('SELECT status FROM JobRun WHERE id = ?').get(runId).status, 'collected');
});

test('the DB count is used for the progress line and the loop pauses when the queue is full', async (t) => {
  const { db, runId } = setUpRun(t);
  // Pretend the queue is already at 9,999 rows (the CAP is 10,000).
  db.exec('BEGIN');
  const insert = db.prepare("INSERT INTO BufferQueue (company_id, guid, url, title, published_at, first_seen_at) VALUES ('gamma', ?, 'u', ?, '2026-09-20T00:00:00Z', 'x')");
  for (let i = 0; i < 9999; i += 1) insert.run(`fill-${i}`, `t${i}`);
  db.exec('COMMIT');

  const { client } = fakeClient((query) => (query.includes('"Alpha"') ? { status: 200, body: readFixture('feed-basic.xml') } : EMPTY));
  let pauses = 0;
  const wait = async () => {
    pauses += 1;
    db.prepare("DELETE FROM BufferQueue WHERE id IN (SELECT id FROM BufferQueue WHERE guid LIKE 'fill-%' LIMIT 2000)").run();
  };
  const progress = makeSilentProgress();
  await runCompanyLoop({ db, runId, client, progress, wait });
  assert.equal(pauses, 1, '9,999 -> 7,999 after one 5 s pause');
  assert.ok(progress.messages.updates.some((u) => u.phase === 'waiting' && u.queueCount === 9999));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM BufferQueue WHERE company_id = 'alpha'").get().n, 3);
});

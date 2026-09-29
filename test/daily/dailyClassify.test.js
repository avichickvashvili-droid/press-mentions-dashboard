// dailyClassify.test.js — the AI step of a daily run (src/daily/dailyClassify.js, D106): an
// article left claimed by a program that is gone never makes the run wait for ever (review #1).
// Offline: a temporary database and a fake classifier (it is never asked, nothing is waiting).

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTempDb } from '../helpers.js';
import { addCompanies } from '../classifier/classifierHelpers.js';
import { classifyDaily } from '../../src/daily/dailyClassify.js';

const NOW = Date.parse('2026-09-28T00:30:00.000Z');

// Adds one queue row that is claimed: `status`, `attempts`, the claiming process and when.
function addClaimedRow(db, { status, attempts, pid, claimedAt = new Date(NOW - 60000).toISOString() }) {
  db.prepare(`INSERT INTO BufferQueue (company_id, guid, url, title, published_at, first_seen_at, status, attempts, claimed_at, claimed_by_pid)
              VALUES ('harvey', 'g1', 'https://x', 't', '2026-09-27T00:00:00Z', '2026-09-27T00:00:00Z', ?, ?, ?, ?)`)
    .run(status, attempts, claimedAt, pid);
}

// Runs classifyDaily with the search already over. Stops by itself after 50 waits (= it hung).
async function runClassify(db, { isAlive }) {
  let sleeps = 0;
  let passes = 0;
  const warnings = [];
  const classifier = { checkOllama: async () => true, runOnePass: async () => { passes += 1; return { kind: 'idle' }; } };
  const result = await classifyDaily({
    db, classifier, isSearchDone: () => true, shouldStop: () => sleeps >= 50, sleep: async () => { sleeps += 1; },
    warn: (text) => warnings.push(text), now: () => NOW, isAlive,
  });
  return { result, sleeps, passes, warnings };
}

test('a row on its last try, still claimed by a program that is gone: released, and the run ends', async (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }]);
  addClaimedRow(db, { status: 'failed', attempts: 3, pid: 999999 });
  const { sleeps, passes, warnings } = await runClassify(db, { isAlive: () => false });
  assert.equal(sleeps, 0, 'the run waited instead of ending');
  assert.equal(passes, 0);
  assert.match(warnings[0], /1 articles were left claimed by a program that stopped/);
  const row = db.prepare('SELECT status, attempts, claimed_at FROM BufferQueue').get();
  assert.deepEqual({ ...row }, { status: 'failed', attempts: 3, claimed_at: null }); // failed for good
});

test('a claim held by a live program is waited for, then released after the claim timeout', async (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }]);
  addClaimedRow(db, { status: 'failed', attempts: 3, pid: 4242 });
  const live = await runClassify(db, { isAlive: () => true });
  assert.equal(live.sleeps, 50); // still being worked on: it waits

  db.prepare('UPDATE BufferQueue SET claimed_at = ?').run(new Date(NOW - 11 * 60 * 1000).toISOString()); // older than 10 min
  const stale = await runClassify(db, { isAlive: () => true });
  assert.equal(stale.sleeps, 0);
  assert.equal(db.prepare('SELECT claimed_at FROM BufferQueue').get().claimed_at, null);
});

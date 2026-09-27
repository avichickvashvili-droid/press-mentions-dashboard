// jobLock.test.js — tests of the JobRun lock, the heartbeat and the emergency heartbeat
// (src/collector/jobLock.js). Uses temporary SQLite files; one test runs a real child process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import {
  CollectedRunPendingError, LockHeldError, acquireRun, findLiveRun, isProcessAlive, startHeartbeat, writeEmergencyHeartbeat, writeHeartbeat,
} from '../src/collector/jobLock.js';
import { TEST_NOW, makeTempDb } from './helpers.js';

const CRASH_CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'crash-child.mjs');
const OTHER_PID = 424242;
const alwaysAlive = () => true;

// Adds companies a, b, c so a run can have a checklist.
function addCompanies(db) {
  for (const id of ['a', 'b', 'c']) {
    db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES (?, ?, 1, 'q')").run(id, id.toUpperCase());
  }
}

// Starts a run owned by another (fake) process, with a heartbeat `ageMs` old.
function runOwnedByOther(db, { ageMs = 0, pid = OTHER_PID } = {}) {
  const run = acquireRun(db, ['a', 'b', 'c'], { now: TEST_NOW - ageMs, pid, isAlive: alwaysAlive });
  return run.runId;
}

// Reads one JobRun row as a plain object.
function jobRun(db, id) {
  return { ...db.prepare('SELECT * FROM JobRun WHERE id = ?').get(id) };
}

test('a new run: running, owned by us, checklist in the given order, counters 0', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const run = acquireRun(db, ['c', 'a', 'b'], { now: TEST_NOW, pid: 1234 });
  assert.equal(run.tookOver, false);
  const row = jobRun(db, run.runId);
  assert.equal(row.status, 'running');
  assert.equal(row.owner_pid, 1234);
  assert.equal(row.started_at, new Date(TEST_NOW).toISOString());
  assert.equal(row.classified_count + row.relevant_count + row.irrelevant_count + row.failed_count, 0);
  const checklist = db.prepare('SELECT company_id, status FROM JobRunCompany WHERE run_id = ? ORDER BY rowid').all(run.runId);
  assert.deepEqual(checklist.map((r) => [r.company_id, r.status]), [['c', 'not_started'], ['a', 'not_started'], ['b', 'not_started']]);
});

test('refused while a live process holds the lock (fresh heartbeat, process alive)', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const runId = runOwnedByOther(db, { ageMs: 60000 });
  assert.equal(findLiveRun(db, { now: TEST_NOW, isAlive: alwaysAlive }).id, runId);
  assert.throws(() => acquireRun(db, ['a'], { now: TEST_NOW, pid: 1, isAlive: alwaysAlive }), LockHeldError);
  assert.equal(jobRun(db, runId).owner_pid, OTHER_PID, 'nothing changed');
});

test('taken over when the heartbeat is older than 15 minutes (even if the process is alive)', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const runId = runOwnedByOther(db, { ageMs: config.STALE_AFTER_MS + 1000 });
  assert.equal(findLiveRun(db, { now: TEST_NOW, isAlive: alwaysAlive }), null);
  const run = acquireRun(db, ['a'], { now: TEST_NOW, pid: 1, isAlive: alwaysAlive });
  assert.deepEqual([run.runId, run.tookOver], [runId, true]);
  assert.equal(jobRun(db, runId).owner_pid, 1);
});

test('taken over at once when the owner process is dead (real exited process)', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const child = spawnSync(process.execPath, ['-e', '0']);
  assert.equal(isProcessAlive(child.pid), false);
  assert.equal(isProcessAlive(process.pid), true);
  const runId = runOwnedByOther(db, { pid: child.pid });
  const run = acquireRun(db, ['a'], { now: TEST_NOW, pid: process.pid });
  assert.deepEqual([run.runId, run.tookOver], [runId, true]);
});

test('taken over at once when owner_pid is NULL (released by the emergency heartbeat)', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const runId = runOwnedByOther(db);
  db.prepare('UPDATE JobRun SET owner_pid = NULL WHERE id = ?').run(runId);
  const run = acquireRun(db, ['a'], { now: TEST_NOW, pid: 1, isAlive: alwaysAlive });
  assert.equal(run.tookOver, true);
});

test('a take-over keeps started_at and the checklist; the fetching company goes back to not_started', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const runId = runOwnedByOther(db, { ageMs: 2 * 24 * 3600 * 1000 }); // started two days ago
  db.prepare("UPDATE JobRunCompany SET status = 'finished' WHERE company_id = 'a'").run();
  db.prepare("UPDATE JobRunCompany SET status = 'fetching' WHERE company_id = 'b'").run();
  db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES ('d', 'D', 1, 'q')").run();
  const before = jobRun(db, runId);

  const run = acquireRun(db, ['a', 'b', 'c', 'd'], { now: TEST_NOW, pid: 1, isAlive: () => false });
  assert.equal(run.startedAt, before.started_at);
  const statuses = db.prepare('SELECT company_id, status FROM JobRunCompany WHERE run_id = ? ORDER BY rowid').all(runId);
  assert.deepEqual(statuses.map((r) => [r.company_id, r.status]), [['a', 'finished'], ['b', 'not_started'], ['c', 'not_started']],
    'the newly seeded company d waits for the next run');
});

test('with no running run, a new run starts (after a done run)', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const oldId = runOwnedByOther(db);
  db.prepare("UPDATE JobRun SET status = 'done' WHERE id = ?").run(oldId);
  const run = acquireRun(db, ['a'], { now: TEST_NOW, pid: 1 });
  assert.equal(run.tookOver, false);
  assert.notEqual(run.runId, oldId);
});

test('refused to start a new run while an earlier run is still collected (being classified)', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const oldId = runOwnedByOther(db);
  db.prepare("UPDATE JobRun SET status = 'collected', owner_pid = NULL WHERE id = ?").run(oldId);
  assert.throws(() => acquireRun(db, ['a'], { now: TEST_NOW, pid: 1 }),
    (error) => error instanceof CollectedRunPendingError && /still being classified/.test(error.message));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRun').get().n, 1, 'no new run was created');
});

test('heartbeat: written while we own the run; not written after someone else took it over', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const { runId } = acquireRun(db, ['a'], { now: TEST_NOW, pid: 1 });
  assert.equal(writeHeartbeat(db, runId, { pid: 1, now: '2026-09-27T10:05:00.000Z' }), true);
  assert.equal(jobRun(db, runId).last_heartbeat, '2026-09-27T10:05:00.000Z');
  db.prepare('UPDATE JobRun SET owner_pid = 2 WHERE id = ?').run(runId);
  assert.equal(writeHeartbeat(db, runId, { pid: 1 }), false);
});

test('D71: the heartbeat timer notices a take-over, stops, and asks the collector to stop', async (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const { runId } = acquireRun(db, ['a'], { now: TEST_NOW, pid: 1 });
  let beatsAfterLoss = 0;
  const lost = new Promise((resolve) => {
    startHeartbeat(db, runId, {
      pid: 1,
      intervalMs: 5,
      warn: () => { beatsAfterLoss += 1; },
      onLostOwnership: resolve,
    });
  });
  db.prepare('UPDATE JobRun SET owner_pid = 2 WHERE id = ?').run(runId); // another process takes over
  const message = await lost;
  assert.match(message, new RegExp(`Run ${runId} was taken over by another process`));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(beatsAfterLoss, 0, 'the timer stopped');
  assert.equal(db.prepare('SELECT owner_pid FROM JobRun WHERE id = ?').get(runId).owner_pid, 2, 'the new owner is untouched');
});

test('emergency heartbeat: writes crashed_at + last_error, releases owner_pid, run stays running', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db);
  const { runId } = acquireRun(db, ['a'], { now: TEST_NOW, pid: 1 });
  assert.equal(writeEmergencyHeartbeat(db, runId, 'crashed: Error: boom', { pid: 1, now: '2026-09-27T11:00:00.000Z' }), true);
  const row = jobRun(db, runId);
  assert.equal(row.status, 'running');
  assert.equal(row.owner_pid, null);
  assert.equal(row.crashed_at, '2026-09-27T11:00:00.000Z');
  assert.equal(row.last_error, 'crashed: Error: boom');
  // The next start resumes at once.
  assert.equal(acquireRun(db, ['a'], { now: TEST_NOW, pid: 2, isAlive: alwaysAlive }).tookOver, true);
});

for (const mode of ['throw', 'reject']) {
  test(`emergency heartbeat in a real process: ${mode === 'throw' ? 'uncaught error' : 'unhandled rejection'}`, (t) => {
    const { db, dbPath } = makeTempDb(t);
    const child = spawnSync(process.execPath, [CRASH_CHILD, dbPath, mode], { encoding: 'utf8' });
    assert.equal(child.status, 1, `child exit code (stderr: ${child.stderr})`);
    const row = db.prepare('SELECT * FROM JobRun').get();
    assert.equal(row.status, 'running');
    assert.equal(row.owner_pid, null);
    assert.ok(row.crashed_at);
    assert.match(row.last_error, mode === 'throw' ? /child crashed on purpose/ : /child rejected a promise/);
  });
}

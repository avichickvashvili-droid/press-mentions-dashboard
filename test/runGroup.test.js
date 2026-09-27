// runGroup.test.js — tests of the group process (D83): runGroupLoop in src/collector/companyLoop.js
// with a fake Google News client, and the real program src/collector/runGroup.js started as a
// separate process with test/fixtures/offline-collect.mjs (a fake feed, nothing sent to Google).
// Checks: only the group's companies are collected; a group resumes inside itself; exit codes
// 0 / 1 / 3 / 143; a group that is not 'in_progress' (e.g. complete) is refused (D90); the
// "still alive" messages (D90); a stop or a crash never releases the runner's lock; the log lines
// (D92, D93: the group-N.log file, the "company finished" line, the system-log calls). Temporary
// SQLite files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seedCompanies } from '../src/seed/seedLoader.js';
import { LostOwnershipError, acquireRun } from '../src/collector/jobLock.js';
import { createGoogleNewsClient } from '../src/collector/googleNews.js';
import { runGroupLoop } from '../src/collector/companyLoop.js';
import {
  TEST_KEYWORDS, TEST_NOW, makeFakeFetch, makeFeed, makeItems, makeSilentProgress, makeTempDb, queryOf, testLogsDir, writeDataFiles,
} from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_GROUP = path.join(ROOT, 'src', 'collector', 'runGroup.js');
const OFFLINE_COLLECT = pathToFileURL(path.join(ROOT, 'test', 'fixtures', 'offline-collect.mjs')).href;
const RUNNER_PID = 1;
const noWait = async () => {};

// Seeds 5 companies (Alpha, Beta, Gamma in group 1; Delta, Epsilon in group 2) and starts a run
// owned by `runnerPid`, split into 2 groups (target size 3: 5 / 3 rounds to 2 groups).
// Returns the database, its file path and the run id.
function setUpRun(t, { runnerPid = RUNNER_PID, now = TEST_NOW } = {}) {
  const { db, dbPath, dir } = makeTempDb(t);
  seedCompanies(db, writeDataFiles(dir, { list: '## 1. Tech\nAlpha\nBeta\nGamma\nDelta\nEpsilon\n', keywords: TEST_KEYWORDS }));
  const run = acquireRun(db, ['alpha', 'beta', 'gamma', 'delta', 'epsilon'], { now, pid: runnerPid, groupSize: 3 });
  return { db, dbPath, runId: run.runId };
}

// The same run for the real group program: owned by this test process (alive, like a runner),
// started now, and group 1 marked 'in_progress' as the runner does before it starts the process.
function setUpProgramRun(t) {
  const setUp = setUpRun(t, { runnerPid: process.pid, now: Date.now() });
  setUp.db.prepare("UPDATE JobRunGroup SET status = 'in_progress' WHERE run_id = ? AND group_number = 1").run(setUp.runId);
  return setUp;
}

// A real Google News client over a fake fetch that gives each company 2 articles.
function fakeClient() {
  const fetchImpl = makeFakeFetch((url) => {
    const name = queryOf(url).match(/"(\w+)"/)[1];
    return { status: 200, body: makeFeed(makeItems(name, 2)) };
  });
  const client = createGoogleNewsClient({ fetchImpl, sleep: noWait, now: () => 0, random: () => 0 });
  return { client, searched: () => fetchImpl.calls.map((url) => queryOf(url).match(/"(\w+)"/)[1]) };
}

// The checklist as { company_id: status }.
function statuses(db, runId) {
  return Object.fromEntries(db.prepare('SELECT company_id, status FROM JobRunCompany WHERE run_id = ?').all(runId)
    .map((row) => [row.company_id, row.status]));
}

// Articles stored per company, as { company_id: count }.
function articlesPerCompany(db) {
  return Object.fromEntries(db.prepare('SELECT company_id, COUNT(*) AS n FROM BufferQueue GROUP BY company_id').all()
    .map((row) => [row.company_id, row.n]));
}

test('the run is split as expected for these tests: group 1 = Alpha, Beta, Gamma; group 2 = Delta, Epsilon', (t) => {
  const { db, runId } = setUpRun(t);
  const rows = db.prepare('SELECT company_id, group_number FROM JobRunCompany WHERE run_id = ? ORDER BY rowid').all(runId);
  assert.deepEqual(rows.map((row) => [row.company_id, row.group_number]),
    [['alpha', 1], ['beta', 1], ['gamma', 1], ['delta', 2], ['epsilon', 2]]);
});

test('runGroupLoop collects only its group\'s companies, and changes neither the run nor the group row', async (t) => {
  const { db, runId } = setUpRun(t);
  const { client, searched } = fakeClient();
  const { stats, reset } = await runGroupLoop({ db, runId, groupNumber: 2, runnerPid: RUNNER_PID, client, progress: makeSilentProgress(), wait: noWait });

  assert.deepEqual(searched(), ['Delta', 'Epsilon']);
  assert.deepEqual(statuses(db, runId), { alpha: 'not_started', beta: 'not_started', gamma: 'not_started', delta: 'finished', epsilon: 'finished' });
  assert.deepEqual([stats.inserted, reset], [4, 0]);
  const run = db.prepare('SELECT status, owner_pid FROM JobRun WHERE id = ?').get(runId);
  assert.deepEqual([run.status, run.owner_pid], ['running', RUNNER_PID], 'the run stays running and owned by the runner');
  assert.ok(db.prepare('SELECT status FROM JobRunGroup WHERE run_id = ?').all(runId).every((row) => row.status === 'pending'));
});

test('runGroupLoop resumes inside its group: finished companies are skipped, the cut-off one is redone', async (t) => {
  const { db, runId } = setUpRun(t);
  db.prepare("UPDATE JobRunCompany SET status = 'finished' WHERE company_id = 'alpha'").run();
  db.prepare("UPDATE JobRunCompany SET status = 'fetching' WHERE company_id = 'beta'").run();
  db.prepare("UPDATE JobRunCompany SET status = 'fetching' WHERE company_id = 'delta'").run(); // another group: not touched
  const { client, searched } = fakeClient();
  const progress = makeSilentProgress();
  const { reset } = await runGroupLoop({ db, runId, groupNumber: 1, runnerPid: RUNNER_PID, client, progress, wait: noWait });

  assert.equal(reset, 1);
  assert.deepEqual(searched(), ['Beta', 'Gamma']);
  assert.deepEqual(statuses(db, runId), { alpha: 'finished', beta: 'finished', gamma: 'finished', delta: 'fetching', epsilon: 'not_started' });
  assert.ok(progress.messages.info.some((text) => /Group 1: 1 company was cut off last time/.test(text)));
});

test('runGroupLoop writes nothing and throws LostOwnershipError when the runner does not own the run (D71)', async (t) => {
  const { db, runId } = setUpRun(t);
  db.prepare("UPDATE JobRunCompany SET status = 'fetching' WHERE company_id = 'alpha'").run();
  const { client, searched } = fakeClient();
  await assert.rejects(
    runGroupLoop({ db, runId, groupNumber: 1, runnerPid: 999, client, progress: makeSilentProgress(), wait: noWait }),
    LostOwnershipError,
  );
  assert.deepEqual(searched(), []);
  assert.equal(statuses(db, runId).alpha, 'fetching', 'not even the reset was written');
});

test('runGroupLoop: "waiting" on every queue check while the queue is full (D90)', async (t) => {
  const { db, runId } = setUpRun(t);
  db.exec('BEGIN');
  const insert = db.prepare("INSERT INTO BufferQueue (company_id, guid, url, title, published_at, first_seen_at) VALUES ('delta', ?, 'u', ?, '2026-09-20T00:00:00Z', 'x')");
  for (let i = 0; i < 10000; i += 1) insert.run(`fill-${i}`, `t${i}`);
  db.exec('COMMIT');
  let checks = 0;
  const wait = async () => {
    checks += 1;
    if (checks === 2) db.prepare("DELETE FROM BufferQueue WHERE guid LIKE 'fill-%'").run(); // the classifier caught up
  };
  const { client } = fakeClient();
  const alive = [];
  await runGroupLoop({ db, runId, groupNumber: 1, runnerPid: RUNNER_PID, client, progress: makeSilentProgress(), wait, onAlive: (state) => alive.push(state) });
  assert.deepEqual(alive, ['waiting', 'waiting'], 'one per 5 s check while full');
});

test('runGroupLoop: a permanent Google error fails only that company; the group goes on', async (t) => {
  const { db, runId } = setUpRun(t);
  const fetchImpl = makeFakeFetch((url) => {
    const name = queryOf(url).match(/"(\w+)"/)[1];
    return name === 'Alpha' ? { status: 400 } : { status: 200, body: makeFeed(makeItems(name, 1)) };
  });
  const client = createGoogleNewsClient({ fetchImpl, sleep: noWait, now: () => 0, random: () => 0 });
  await runGroupLoop({ db, runId, groupNumber: 1, runnerPid: RUNNER_PID, client, progress: makeSilentProgress(), wait: noWait });
  const s = statuses(db, runId);
  assert.deepEqual([s.alpha, s.beta, s.gamma], ['failed', 'finished', 'finished']);
});

// ---------- The real program, as a separate process ----------

// The environment for the group program: the test database, the fake feed, and the log files
// next to the test database.
function groupEnv(dbPath, extra = {}) {
  return { ...process.env, DB_PATH: dbPath, LOGS_DIR: testLogsDir(dbPath), ...extra };
}

// Runs the group program to its end and returns the result (status, stdout, stderr).
function runGroupProgram(dbPath, args, extraEnv = {}) {
  return spawnSync(process.execPath, ['--import', OFFLINE_COLLECT, RUN_GROUP, ...args.map(String)], {
    encoding: 'utf8', timeout: 30000, env: groupEnv(dbPath, extraEnv),
  });
}

// Starts the group program with a message channel (like the runner will) and returns the child
// and a promise of its exit code.
function startGroupProgram(dbPath, args, extraEnv = {}) {
  const child = spawn(process.execPath, ['--import', OFFLINE_COLLECT, RUN_GROUP, ...args.map(String)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: groupEnv(dbPath, extraEnv),
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ code, output })));
  return { child, exited };
}

// Waits (up to 15 s) until `check()` is true, looking every 50 ms.
async function waitUntil(check, what) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('group program: collects only its group, resumes inside it, exits 0; the run stays running and owned by the runner', (t) => {
  const { db, dbPath, runId } = setUpProgramRun(t);
  db.prepare("UPDATE JobRunCompany SET status = 'finished' WHERE company_id = 'alpha'").run();
  db.prepare("UPDATE JobRunCompany SET status = 'fetching' WHERE company_id = 'beta'").run();

  const result = runGroupProgram(dbPath, [runId, 1, process.pid]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Group 1 done: 3 finished, 0 failed \(of 3\)/);
  assert.match(result.stdout, /articles added to the queue: +4/);
  assert.deepEqual(articlesPerCompany(db), { beta: 2, gamma: 2 }, 'Alpha was not searched again; group 2 was not touched');
  assert.deepEqual(statuses(db, runId), { alpha: 'finished', beta: 'finished', gamma: 'finished', delta: 'not_started', epsilon: 'not_started' });
  const run = db.prepare('SELECT status, owner_pid FROM JobRun WHERE id = ?').get(runId);
  assert.deepEqual([run.status, run.owner_pid], ['running', process.pid]);
});

test('group program: exits 3 and writes nothing when the given runner does not own the run (D71)', (t) => {
  const { db, dbPath, runId } = setUpProgramRun(t);
  const result = runGroupProgram(dbPath, [runId, 1, 424242]);
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /taken over by another process/);
  assert.deepEqual(articlesPerCompany(db), {});
});

test('group program: refuses (exit 3) a group that is not in_progress, e.g. complete or pending, and collects nothing (D90)', (t) => {
  const { db, dbPath, runId } = setUpProgramRun(t);
  for (const status of ['complete', 'pending', 'failed']) {
    db.prepare('UPDATE JobRunGroup SET status = ? WHERE run_id = ? AND group_number = 1').run(status, runId);
    const result = runGroupProgram(dbPath, [runId, 1, process.pid]);
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, new RegExp(`Group 1 of run ${runId} is '${status}', not 'in_progress'`));
  }
  assert.deepEqual(articlesPerCompany(db), {});
  assert.equal(statuses(db, runId).alpha, 'not_started');
});

test('group program: sends "still alive" messages to the runner: fetching before each search (D90)', async (t) => {
  const { dbPath, runId } = setUpProgramRun(t);
  const { child, exited } = startGroupProgram(dbPath, [runId, 1, process.pid]);
  const messages = [];
  child.on('message', (message) => messages.push(message));
  const { code, output } = await exited;
  assert.equal(code, 0, output);
  assert.ok(messages.length >= 3, 'at least one per company');
  assert.ok(messages.every((message) => message.type === 'alive' && message.state === 'fetching'));
});

test('G10: a group process whose runner goes away while it is starting stops (143) and collects nothing', async (t) => {
  const { db, dbPath, runId } = setUpProgramRun(t);
  // Every search hangs, so the only way out is noticing that the runner is gone.
  const { child, exited } = startGroupProgram(dbPath, [runId, 1, process.pid], { TEST_FETCH_MODE: 'hang' });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  child.disconnect(); // the runner goes away before the group process has even loaded
  const { code, output } = await exited;
  assert.equal(code, 143, output);
  assert.deepEqual(articlesPerCompany(db), {});
  assert.notEqual(statuses(db, runId).alpha, 'finished');
});

test('group program: exits 1 on wrong arguments or a group that does not exist', (t) => {
  const { dbPath, runId } = setUpProgramRun(t);
  for (const args of [[], [runId, 1], [runId, 'abc', process.pid], [runId, 0, process.pid]]) {
    const result = runGroupProgram(dbPath, args);
    assert.equal(result.status, 1, `args ${JSON.stringify(args)}: ${result.stderr}`);
    assert.match(result.stderr, /expected <runId> <groupNumber> <runnerPid>/);
  }
  const missing = runGroupProgram(dbPath, [runId, 7, process.pid]);
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /has no group 7/);
});

for (const how of ['stop message', 'runner gone (channel closed)']) {
  test(`group program: stops with 143 on "${how}", and does not release the runner's lock`, async (t) => {
    const { db, dbPath, runId } = setUpProgramRun(t);
    const { child, exited } = startGroupProgram(dbPath, [runId, 1, process.pid], { TEST_FETCH_MODE: 'hang' });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    await waitUntil(() => statuses(db, runId).alpha === 'fetching', 'Alpha is being fetched');

    if (how === 'stop message') child.send({ type: 'stop' });
    else child.disconnect();
    const { code, output } = await exited;
    assert.equal(code, 143, output);
    const run = db.prepare('SELECT status, owner_pid, last_error FROM JobRun WHERE id = ?').get(runId);
    assert.deepEqual([run.status, run.owner_pid, run.last_error], ['running', process.pid, null], 'no emergency heartbeat from the group process');
    assert.equal(statuses(db, runId).alpha, 'fetching', 'redone by the next start of this group');
  });
}

test('group program: a crash exits 1 and does not release the runner\'s lock', async (t) => {
  const { db, dbPath, runId } = setUpProgramRun(t);
  const { exited } = startGroupProgram(dbPath, [runId, 1, process.pid], { TEST_FETCH_MODE: 'crash' });
  const { code, output } = await exited;
  assert.equal(code, 1, output);
  assert.match(output, /Group process crashed: Error: group process crashed on purpose/);
  const run = db.prepare('SELECT status, owner_pid, last_error FROM JobRun WHERE id = ?').get(runId);
  assert.deepEqual([run.status, run.owner_pid, run.last_error], ['running', process.pid, null]);
});

// ---------- Log lines (D92, D93) ----------

test('D93: one "company finished" line per company for the log file only, and a system-log line for a failed company', async (t) => {
  const { db, runId } = setUpRun(t);
  const fetchImpl = makeFakeFetch((url) => {
    const name = queryOf(url).match(/"(\w+)"/)[1];
    return name === 'Alpha' ? { status: 400 } : { status: 200, body: makeFeed(makeItems(name, 2)) };
  });
  const client = createGoogleNewsClient({ fetchImpl, sleep: noWait, now: () => 0, random: () => 0 });
  const progress = makeSilentProgress();
  const events = [];
  let clock = 0;
  await runGroupLoop({
    db, runId, groupNumber: 1, runnerPid: RUNNER_PID, client, progress, wait: noWait,
    now: () => { clock += 36000; return clock; }, // each company takes 36 s on this clock
    events: { companyFailed: (name, reason) => events.push(`${name}: ${reason}`) },
  });
  assert.deepEqual(progress.messages.records, [
    'Company 2/3 Beta: finished · 1 window · 2 new, 0 duplicates · 36 s',
    'Company 3/3 Gamma: finished · 1 window · 2 new, 0 duplicates · 36 s',
  ]);
  assert.equal(events.length, 1);
  assert.match(events[0], /^Alpha: Google rejected the search \(HTTP 400/);
  assert.ok(!progress.messages.info.some((text) => /Company \d\/\d/.test(text)), 'not on the terminal');
});

test('D93: a full queue gives ONE "queue full" call per wait and one "resumed" call when it is over', async (t) => {
  const { db, runId } = setUpRun(t);
  db.exec('BEGIN');
  const insert = db.prepare("INSERT INTO BufferQueue (company_id, guid, url, title, published_at, first_seen_at) VALUES ('delta', ?, 'u', ?, '2026-09-20T00:00:00Z', 'x')");
  for (let i = 0; i < 10000; i += 1) insert.run(`fill-${i}`, `t${i}`);
  db.exec('COMMIT');
  let checks = 0;
  const wait = async () => {
    checks += 1;
    if (checks === 3) db.prepare("DELETE FROM BufferQueue WHERE guid LIKE 'fill-%'").run();
  };
  const calls = [];
  const { client } = fakeClient();
  await runGroupLoop({
    db, runId, groupNumber: 1, runnerPid: RUNNER_PID, client, progress: makeSilentProgress(), wait,
    events: { queueFull: () => calls.push('full'), queueResumed: (count) => calls.push(`resumed ${count}`) },
  });
  assert.deepEqual(calls, ['full', 'full', 'full', 'resumed 0'], 'the runGroup trackers turn this into one line each');
});

test('group program: writes logs/run-<id>/group-<n>.log with the date and time, a line per company and the summary, but no progress line', (t) => {
  const { dbPath, runId } = setUpProgramRun(t);
  const result = runGroupProgram(dbPath, [runId, 1, process.pid]);
  assert.equal(result.status, 0, result.stderr);
  const file = path.join(testLogsDir(dbPath), `run-${runId}`, 'group-1.log');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.ok(lines.every((line) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} /.test(line)), 'every line has the date and time');
  const text = lines.join('\n');
  assert.match(text, /Company 1\/3 Alpha: finished · 1 window · 2 new, 0 duplicates · \d+ s/);
  assert.match(text, /Company 3\/3 Gamma: finished/);
  assert.match(text, /Group 1 done: 3 finished, 0 failed \(of 3\)/);
  assert.doesNotMatch(text, /group 1\/2 · company/, 'the progress line is not in the file');
  assert.doesNotMatch(result.stdout, /Company 1\/3 Alpha: finished/, 'the terminal output is unchanged');
});

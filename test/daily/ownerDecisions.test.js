// ownerDecisions.test.js — the owner's decisions after the Step 6 review (Prompt 298):
//   #4 no 90-day collection (npm start / npm run collect) while a daily run is going on;
//   A  a 90-day collection's mentions are marked as alerted (never sent to Discord);
//   B  "⚠️ Daily job problem" message: waiting 3 h, going on 3 h, or given up;
//   F  the api answers only requests addressed to this computer (DNS rebinding);
//   run.json collectedAt = the collection's finish time when data/ is from another collection.
// Offline: temporary databases and folders, fake timers; the real programs are started only to
// see them refuse (they stop before doing anything).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeTempDb } from '../helpers.js';
import { addCompanies, addQueueRows, addRun } from '../classifier/classifierHelpers.js';
import { addStandardData, makeApiDb, startApi } from '../api/apiHelpers.js';
import { config } from '../../src/config.js';
import { EXIT_CODES } from '../../src/shared/exitCodes.js';
import { findLiveDailyRun } from '../../src/shared/dailyRunCheck.js';
import { checkNoDailyRun } from '../../src/supervisor/collectionCheck.js';
import { moveRelevantRows } from '../../src/classifier/mover.js';
import { createDailyScheduler } from '../../src/daily/dailyScheduler.js';
import { buildProblemMessage } from '../../src/daily/digest.js';
import { buildDailyExport } from '../../src/daily/dailyExport.js';

const HOUR = 60 * 60 * 1000;

// Adds a 'running' DailyRun row held by `pid`. Returns its id.
function addDailyRun(db, pid) {
  return Number(db.prepare("INSERT INTO DailyRun (started_at, status, owner_pid) VALUES ('2026-09-29T00:00:00.000Z', 'running', ?)").run(pid).lastInsertRowid);
}

// Starts a program on a database and waits for it to end. Returns { code, output }.
function runProgram(file, dbPath, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: config.PROJECT_ROOT, env: { ...process.env, DB_PATH: dbPath } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => resolve({ code, output }));
  });
}

// ---------- #4 ----------

test('#4 findLiveDailyRun: a running daily run of a live process counts; a crashed one does not', (t) => {
  const { db } = makeTempDb(t);
  assert.equal(findLiveDailyRun(db), null);
  const id = addDailyRun(db, 4242);
  assert.equal(findLiveDailyRun(db, { isAlive: () => false }), null);
  assert.equal(findLiveDailyRun(db, { isAlive: () => true }).id, id);
});

test('#4 npm start refuses (exit 3) while a daily run is going on, and starts nothing', { timeout: 30000 }, async (t) => {
  const { db, dbPath } = makeTempDb(t);
  addDailyRun(db, process.pid); // this test process is alive
  assert.equal(checkNoDailyRun({ dbPath }).ok, false);
  const { code, output } = await runProgram(path.join(config.PROJECT_ROOT, 'src', 'supervisor', 'runSupervisor.js'), dbPath);
  assert.equal(code, EXIT_CODES.REFUSED, output);
  assert.match(output, /A daily run is going on \(daily run 1, process \d+/);
  assert.match(output, /Nothing was started/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRun').get().n, 0);
});

test('#4 npm run collect refuses (exit 3) while a daily run is going on', { timeout: 30000 }, async (t) => {
  const { db, dbPath } = makeTempDb(t);
  addDailyRun(db, process.pid);
  const { code, output } = await runProgram(path.join(config.PROJECT_ROOT, 'src', 'collector', 'runCollect.js'), dbPath);
  assert.equal(code, EXIT_CODES.REFUSED, output);
  assert.match(output, /A daily run is going on/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRun').get().n, 0);
});

test('#4 checkNoDailyRun: no database, or no daily run → may start', (t) => {
  const { dbPath } = makeTempDb(t);
  assert.deepEqual(checkNoDailyRun({ dbPath }), { ok: true });
  assert.deepEqual(checkNoDailyRun({ dbPath: path.join(path.dirname(dbPath), 'missing.sqlite') }), { ok: true });
});

// ---------- A ----------

test('A: mentions moved while a 90-day collection is open are marked alerted; the daily job\'s stay new', (t) => {
  const { db } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }]);
  addQueueRows(db, [{ companyId: 'harvey', guid: 'during-collection', title: 't1', status: 'relevant', sentiment: 'positive' }]);
  const runId = addRun(db, { status: 'running' });
  moveRelevantRows(db, { now: '2026-09-29T01:00:00.000Z' });
  assert.equal(db.prepare("SELECT alerted_at FROM Mention WHERE guid = 'during-collection'").get().alerted_at, '2026-09-29T01:00:00.000Z');

  db.prepare("UPDATE JobRun SET status = 'done' WHERE id = ?").run(runId); // collection finished: the daily job's turn
  addQueueRows(db, [{ companyId: 'harvey', guid: 'daily', title: 't2', status: 'relevant', sentiment: 'negative' }]);
  moveRelevantRows(db);
  assert.equal(db.prepare("SELECT alerted_at FROM Mention WHERE guid = 'daily'").get().alerted_at, null);
});

// ---------- B ----------

// A scheduler with fake timers and a fake clock; records the problem messages.
function problemScheduler(results) {
  const state = { now: Date.parse('2026-09-29T00:00:00.000Z'), timers: [], problems: [], runs: 0 };
  let finishRun = null;
  const scheduler = createDailyScheduler({
    runOnce: async () => {
      const result = results[Math.min(state.runs, results.length - 1)];
      state.runs += 1;
      if (result === 'hang') return new Promise((resolve) => { finishRun = resolve; });
      return result;
    },
    readLastDoneStartedAt: () => null,
    now: () => state.now,
    cronLib: { validate: () => true, schedule: () => ({ stop() {} }) },
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; state.timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.cleared = true; },
    log: () => {},
    blockedRetryMs: 15 * 60 * 1000,
    failedRetryMs: 30 * 60 * 1000,
    failedRetries: 3,
    problemAfterMs: 3 * HOUR,
    onProblem: (text, options) => { state.problems.push({ text, ...options }); },
    describeState: () => 'Ollama is not ready; the new articles wait.',
  });
  state.fire = async (ms) => {
    const timer = state.timers.filter((x) => !x.cleared && !x.fired && x.ms === ms).at(-1);
    timer.fired = true;
    await timer.fn();
  };
  state.finish = (result) => finishRun(result);
  return { scheduler, state };
}

test('B: waiting (blocked) for 3 hours sends ONE problem message, and it keeps trying', async () => {
  const { scheduler, state } = problemScheduler([{ status: 'blocked', reason: 'the 90-day collection (run 2) is still collecting' }]);
  await scheduler.trigger('scheduled');
  for (let i = 0; i < 14; i += 1) { // 14 retries × 15 min = 3.5 h
    state.now += 15 * 60 * 1000;
    await state.fire(15 * 60 * 1000);
  }
  assert.equal(state.problems.length, 1);
  assert.match(state.problems[0].text, /has been waiting for 3 h: the 90-day collection \(run 2\) is still collecting/);
  assert.equal(state.problems[0].keepsTrying, true);
});

test('B: a run going on for 3 hours sends ONE problem message with the last warning', async () => {
  const { scheduler, state } = problemScheduler(['hang']);
  const running = scheduler.trigger('scheduled');
  await state.fire(3 * HOUR);
  assert.equal(state.problems.length, 1);
  assert.match(state.problems[0].text, /started 3 h ago and is not done yet\. Last problem: Ollama is not ready/);
  state.finish({ status: 'done' });
  await running;
  assert.equal(state.problems.length, 1);
});

test('B: giving up after the failed retries sends a problem message saying it waits for the next run', async () => {
  const { scheduler, state } = problemScheduler([{ status: 'failed', error: 'database is locked' }]);
  await scheduler.trigger('scheduled');
  for (let i = 0; i < 3; i += 1) await state.fire(30 * 60 * 1000);
  assert.equal(state.problems.length, 1);
  assert.match(state.problems[0].text, /failed 4 times in a row\. Last error: database is locked/);
  assert.equal(state.problems[0].keepsTrying, false);
});

test('B: the problem message (red, never pings anyone)', () => {
  const body = buildProblemMessage({ problem: 'The daily run started 3 h ago and is not done yet.', keepsTrying: true, sentAt: new Date('2026-09-28T22:00:00.000Z'), timeZone: 'Asia/Jerusalem' });
  assert.equal(body.embeds[0].title, '⚠️ Daily job problem · Tue 29 Sep');
  assert.equal(body.embeds[0].color, config.DISCORD_PROBLEM_COLOR);
  assert.match(body.embeds[0].description, /not done yet\.\n\nIt keeps trying by itself/);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  const gaveUp = buildProblemMessage({ problem: 'x', keepsTrying: false, cron: '0 3 * * *' });
  assert.match(gaveUp.embeds[0].description, /tries again at the next scheduled run \(03:00\)/);
});

// ---------- F ----------

// Sends a GET with a chosen Host header (fetch can't set it). Resolves with the status code.
function getWithHost(baseUrl, host) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: '/api/companies', headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
}

test('F: the api answers only requests addressed to this computer', async (t) => {
  const { db, openReadOnly, onCleanup } = makeApiDb(t);
  addStandardData(db);
  const { baseUrl } = await startApi(onCleanup, { db: openReadOnly() });
  const port = new URL(baseUrl).port;
  assert.equal(await getWithHost(baseUrl, `localhost:${port}`), 200);
  assert.equal(await getWithHost(baseUrl, `127.0.0.1:${port}`), 200);
  assert.equal(await getWithHost(baseUrl, `[::1]:${port}`), 200);
  assert.equal(await getWithHost(baseUrl, `evil.example:${port}`), 403);
  assert.equal(await getWithHost(baseUrl, 'localhost.evil.example'), 403);
});

// ---------- collectedAt ----------

test('run.json from another collection: collectedAt and finishedAt are the collection\'s finish time', (t) => {
  const { db, dir } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }]);
  addRun(db, { status: 'done', finishedAt: '2026-09-28T07:01:06.000Z', companyIds: ['harvey'] });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ runId: 99, collectedAt: '2020-01-01T00:00:00.000Z' }));
  const files = buildDailyExport(db, { now: Date.parse('2026-09-29T01:00:00.000Z'), lastDailyRun: {}, companyNames: ['Harvey'], dataDir: dir });
  assert.equal(files['run.json'].collectedAt, '2026-09-28T07:01:06.000Z');
  assert.equal(files['run.json'].finishedAt, '2026-09-28T07:01:06.000Z');
});

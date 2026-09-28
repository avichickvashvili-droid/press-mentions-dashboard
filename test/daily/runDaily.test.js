// runDaily.test.js — the real `npm run daily` program (src/daily/runDaily.js) started as its own
// process on a temporary database: it starts, says when it runs, and STAYS UP waiting for 03:00
// (node-cron keeps it alive). The database has a daily run from a minute ago, so no "missed run"
// starts (nothing talks to Google, Ollama or Discord). Its log goes next to the temporary database.
// A second `npm run daily` on the same database refuses to start (exit 3) while the first is open.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeTempDb, testLogsDir } from '../helpers.js';
import { config } from '../../src/config.js';
import { EXIT_CODES } from '../../src/shared/exitCodes.js';

const RUN_DAILY = path.join(config.PROJECT_ROOT, 'src', 'daily', 'runDaily.js');

// Starts `npm run daily` on the given database. Returns { child, output(), exited }; it is stopped when the test ends.
function startDaily(t, dbPath) {
  const child = spawn(process.execPath, [RUN_DAILY], {
    cwd: config.PROJECT_ROOT,
    env: { ...process.env, DB_PATH: dbPath, DISCORD_WEBHOOK_URL: '' },
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  t.after(async () => { if (child.exitCode === null) { child.kill(); await exited; } });
  return { child, output: () => output, exited };
}

// Waits until the program printed `text` or ended (at most 15 s).
async function waitForOutput(program, text) {
  const deadline = Date.now() + 15000;
  while (!program.output().includes(text) && program.child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// A database with a daily run from a minute ago (so no missed run starts).
function makeDatabase(t) {
  const { db, dbPath } = makeTempDb(t);
  db.prepare("INSERT INTO DailyRun (started_at, finished_at, status) VALUES (?, ?, 'done')")
    .run(new Date(Date.now() - 60000).toISOString(), new Date().toISOString());
  return dbPath;
}

test('npm run daily: starts, stays up waiting for the schedule, and writes daily.log', { timeout: 20000 }, async (t) => {
  const dbPath = makeDatabase(t);
  const program = startDaily(t, dbPath);
  await waitForOutput(program, 'Daily job started');
  const output = program.output();
  assert.match(output, /Daily job started \(process \d+, database .*\)\. It runs every day at 03:00 \(Asia\/Jerusalem\)/);
  assert.match(output, /WARNING: DISCORD_WEBHOOK_URL is not set in \.env/);

  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(program.child.exitCode, null, `the program ended on its own:
${program.output()}`);
  assert.doesNotMatch(program.output(), /Daily run starting/); // a run a minute ago: nothing missed

  const logFile = path.join(testLogsDir(dbPath), 'daily', 'daily.log');
  assert.match(fs.readFileSync(logFile, 'utf8'), /Daily job started/);
});

test('a second npm run daily on the same database refuses to start (exit 3); the first stays up', { timeout: 30000 }, async (t) => {
  const dbPath = makeDatabase(t);
  const first = startDaily(t, dbPath);
  await waitForOutput(first, 'Daily job started');
  assert.equal(first.child.exitCode, null);

  const second = startDaily(t, dbPath);
  const code = await second.exited;
  assert.equal(code, EXIT_CODES.REFUSED, second.output());
  assert.match(second.output(), new RegExp(`Another daily job is already open \\(process ${first.child.pid}, started `));
  assert.match(second.output(), /Daily job stopped: another daily job is already open/);
  assert.doesNotMatch(second.output(), /Daily job started/);
  assert.equal(first.child.exitCode, null, 'the first daily job must keep running');
});

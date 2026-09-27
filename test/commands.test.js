// commands.test.js — runs the real `seed` and `collect` programs as separate processes on a
// temporary database and checks their exit codes (D68): 0 = finished, 3 = refused (nothing
// wrong), 1 = real failure. No request ever reaches Google: most cases stop before searching,
// and the two full `collect` runs use test/fixtures/offline-collect.mjs (a fake feed, a tiny list).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TEST_KEYWORDS, makeTempDb, makeTempDir, testLogsDir, writeDataFiles } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_COLLECT = path.join(ROOT, 'src', 'collector', 'runCollect.js');
const RUN_SEED = path.join(ROOT, 'src', 'seed', 'runSeed.js');
const OFFLINE_COLLECT = pathToFileURL(path.join(ROOT, 'test', 'fixtures', 'offline-collect.mjs')).href;

// Runs one of the programs with DB_PATH pointing to the test database (and the log files next
// to it, never in the project's logs/ folder).
function runProgram(script, dbPath) {
  return spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, DB_PATH: dbPath, LOGS_DIR: testLogsDir(dbPath) }, timeout: 30000 });
}

// Runs the real collect program offline (fake feed, the given small data files). `extraEnv`
// adds settings for offline-collect.mjs (e.g. TEST_TAKE_OVER_PID).
function runCollectOffline(dbPath, files, extraEnv = {}) {
  return spawnSync(process.execPath, ['--import', OFFLINE_COLLECT, RUN_COLLECT], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      LOGS_DIR: testLogsDir(dbPath),
      TEST_COMPANY_LIST: files.listFile,
      TEST_HINTS: files.hintsFile,
      TEST_KEYWORDS: files.keywordsFile,
      ...extraEnv,
    },
  });
}

// Adds a JobRun row with the given status and owner (heartbeat = now).
function addRun(db, status, ownerPid) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO JobRun (started_at, status, last_heartbeat, owner_pid) VALUES (?, ?, ?, ?)').run(now, status, now, ownerPid);
}

test('collect exits 3 when a live collection holds the lock', (t) => {
  const { db, dbPath } = makeTempDb(t);
  addRun(db, 'running', process.pid); // this test process is alive and the heartbeat is fresh
  const result = runProgram(RUN_COLLECT, dbPath);
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /Another collection is running/);
});

test('collect exits 3 while the previous run is still collected (being classified)', (t) => {
  const { db, dbPath } = makeTempDb(t);
  addRun(db, 'collected', null);
  const result = runProgram(RUN_COLLECT, dbPath);
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /still being classified/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRun').get().n, 1, 'no new run');
});

test('seed exits 3 when a live collection holds the lock, and 0 otherwise', (t) => {
  const { db, dbPath } = makeTempDb(t);
  addRun(db, 'running', process.pid);
  const refused = runProgram(RUN_SEED, dbPath);
  assert.equal(refused.status, 3, refused.stderr);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Company').get().n, 0);

  db.prepare("UPDATE JobRun SET status = 'done'").run();
  const done = runProgram(RUN_SEED, dbPath);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Company').get().n, 258);
});

test('collect and seed exit 1 when the database cannot be opened', (t) => {
  const dir = makeTempDir(t); // a folder, not a database file
  assert.equal(runProgram(RUN_COLLECT, dir).status, 1);
  assert.equal(runProgram(RUN_SEED, dir).status, 1);
});

test('collect exits 0 after a full (offline) run: every company finished, the run collected and handed over', (t) => {
  const { db, dbPath, dir } = makeTempDb(t);
  const files = writeDataFiles(dir, { list: '## 1. Tech\nAlpha\nBeta\n## 2. Health\nGamma\n', keywords: TEST_KEYWORDS });
  const result = runCollectOffline(dbPath, files);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Run 1 collected\./);
  assert.match(result.stdout, /Companies: 3 finished, 0 failed \(of 3\)/);
  const run = db.prepare('SELECT status, owner_pid FROM JobRun').get();
  assert.deepEqual([run.status, run.owner_pid], ['collected', null]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n, 6);
});

test('collect exits 3 when another process takes its run over while it works (D71), and writes nothing more', (t) => {
  const { db, dbPath, dir } = makeTempDb(t);
  const files = writeDataFiles(dir, { list: '## 1. Tech\nAlpha\nBeta\n', keywords: TEST_KEYWORDS });
  const result = runCollectOffline(dbPath, files, { TEST_TAKE_OVER_PID: String(process.pid) });
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /taken over by another process/);
  const run = db.prepare('SELECT status, owner_pid, last_error FROM JobRun').get();
  assert.deepEqual([run.status, run.owner_pid, run.last_error], ['running', process.pid, null], 'left to the new owner, no emergency write');
  const statuses = db.prepare('SELECT status FROM JobRunCompany ORDER BY rowid').all().map((row) => row.status);
  assert.deepEqual(statuses, ['fetching', 'not_started'], 'Alpha was not marked finished by the replaced collector');
});

// commands.test.js — runs the real `seed` and `collect` programs as separate processes on a
// temporary database and checks their exit codes (D68): 3 = refused (nothing wrong),
// 1 = real failure. Every case here stops BEFORE any Google request is made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDb, makeTempDir } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_COLLECT = path.join(ROOT, 'src', 'collector', 'runCollect.js');
const RUN_SEED = path.join(ROOT, 'src', 'seed', 'runSeed.js');

// Runs one of the programs with DB_PATH pointing to the test database.
function runProgram(script, dbPath) {
  return spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, DB_PATH: dbPath }, timeout: 30000 });
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


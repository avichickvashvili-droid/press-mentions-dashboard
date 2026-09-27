// runCleanup.test.js — tests of the clean-up when a NEW run is created (D93, D94,
// src/shared/runCleanup.js and acquireRun in src/collector/jobLock.js): the old runs' rows go
// (JobRunGroup, JobRunCompany, JobRun) in the same transaction as the insert, while Mention,
// Company and BufferQueue stay; a resume, a take-over or a --groups re-open deletes nothing; the
// old log folders go, a stale folder with the new run's name is emptied, and a folder that can't
// be removed is only reported. Offline; temporary databases and folders only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acquireRun, reopenRunForGroups } from '../src/collector/jobLock.js';
import { deleteOldRuns, describeCleanup, removeOldLogFolders } from '../src/shared/runCleanup.js';
import { TEST_NOW, makeTempDb, makeTempDir } from './helpers.js';

const PID = 1;

// Adds companies a, b, c, one queue article and one mention (these must survive every clean-up).
function fillDatabase(db) {
  for (const id of ['a', 'b', 'c']) db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES (?, ?, 1, 'q')").run(id, id.toUpperCase());
  db.prepare("INSERT INTO BufferQueue (company_id, guid, url, title, published_at, first_seen_at) VALUES ('a', 'q1', 'u', 'A news', '2026-09-20T00:00:00Z', 'x')").run();
  db.prepare("INSERT INTO Mention (company_id, guid, url, title, published_at, first_seen_at, sentiment) VALUES ('b', 'm1', 'u', 'B news', '2026-09-20T00:00:00Z', 'x', 'positive')").run();
}

// Starts a run and marks it 'done' (as the classifier does at the end). Returns its id.
function doneRun(db) {
  const { runId } = acquireRun(db, ['a', 'b', 'c'], { now: TEST_NOW, pid: PID, groupSize: 2 });
  db.prepare("UPDATE JobRun SET status = 'done', owner_pid = NULL WHERE id = ?").run(runId);
  return runId;
}

// Adds a finished old run by hand (id `id`, companies a, b, c in 2 groups), like one left from
// before the latest run.
function addOldRun(db, id) {
  db.prepare("INSERT INTO JobRun (id, started_at, status, last_heartbeat) VALUES (?, '2026-09-01T00:00:00Z', 'done', '2026-09-01T00:00:00Z')").run(id);
  for (const group of [1, 2]) db.prepare("INSERT INTO JobRunGroup (run_id, group_number, status) VALUES (?, ?, 'complete')").run(id, group);
  for (const [company, group] of [['a', 1], ['b', 1], ['c', 2]]) {
    db.prepare("INSERT INTO JobRunCompany (run_id, company_id, status, group_number) VALUES (?, ?, 'finished', ?)").run(id, company, group);
  }
}

// How many rows each table has.
function counts(db) {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    JobRun: count('JobRun'), JobRunCompany: count('JobRunCompany'), JobRunGroup: count('JobRunGroup'),
    Company: count('Company'), BufferQueue: count('BufferQueue'), Mention: count('Mention'),
  };
}

test('D94: a new run deletes the old runs (groups, checklist, run rows) and keeps Company, BufferQueue and Mention', (t) => {
  const { db } = makeTempDb(t);
  fillDatabase(db);
  doneRun(db);
  addOldRun(db, 50);
  assert.deepEqual(counts(db), { JobRun: 2, JobRunCompany: 6, JobRunGroup: 4, Company: 3, BufferQueue: 1, Mention: 1 });
  const run = acquireRun(db, ['a', 'b', 'c'], { now: TEST_NOW, pid: PID, groupSize: 2 });
  assert.equal(run.removedRuns, 2);
  assert.deepEqual(counts(db), { JobRun: 1, JobRunCompany: 3, JobRunGroup: 2, Company: 3, BufferQueue: 1, Mention: 1 });
  assert.equal(db.prepare('SELECT id FROM JobRun').get().id, run.runId);

  const { db: fresh } = makeTempDb(t);
  fillDatabase(fresh);
  assert.equal(acquireRun(fresh, ['a'], { now: TEST_NOW, pid: PID }).removedRuns, 0, 'the very first run has nothing to delete');
});

test('D94: a take-over of a dead run and a --groups re-open delete nothing', (t) => {
  const { db } = makeTempDb(t);
  fillDatabase(db);
  const oldRun = doneRun(db);
  const { runId: running } = acquireRun(db, ['a', 'b', 'c'], { now: TEST_NOW, pid: PID, groupSize: 2 });
  db.prepare('UPDATE JobRun SET owner_pid = NULL WHERE id = ?').run(running); // its collector died
  addOldRun(db, oldRun); // it was removed when `running` was created; add it back to see it stays
  const before = counts(db);
  const takeOver = acquireRun(db, ['a', 'b', 'c'], { now: TEST_NOW, pid: 2, groupSize: 2 });
  assert.deepEqual([takeOver.tookOver, takeOver.removedRuns], [true, 0]);
  assert.deepEqual(counts(db), before);

  db.prepare("UPDATE JobRun SET status = 'done', owner_pid = NULL WHERE id = ?").run(running);
  reopenRunForGroups(db, [1], { pid: 3, now: TEST_NOW });
  assert.deepEqual(counts(db), before, '--groups re-open');
});

test('D94: deleteOldRuns keeps only the given run', (t) => {
  const { db } = makeTempDb(t);
  fillDatabase(db);
  const one = doneRun(db);
  db.prepare("INSERT INTO JobRun (id, started_at, status, last_heartbeat) VALUES (99, '2026-09-01T00:00:00Z', 'done', '2026-09-01T00:00:00Z')").run();
  assert.equal(deleteOldRuns(db, one), 1);
  assert.deepEqual(db.prepare('SELECT id FROM JobRun').all().map((row) => row.id), [one]);
});

test('D94: old log folders are removed (with no-run/), a stale folder with the new run\'s name is emptied, loose files stay', (t) => {
  const logsDir = makeTempDir(t);
  for (const folder of ['run-1', 'run-2', 'no-run']) {
    fs.mkdirSync(path.join(logsDir, folder));
    fs.writeFileSync(path.join(logsDir, folder, 'collector.log'), 'old\n');
  }
  fs.writeFileSync(path.join(logsDir, 'notes.txt'), 'mine');
  const result = removeOldLogFolders({ keepFolder: 'run-2', logsDir });
  assert.deepEqual(result.removed.sort(), ['no-run', 'run-1']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(fs.readdirSync(logsDir), ['notes.txt'], 'run-2 was stale: emptied (removed; the new run writes it again)');
  assert.deepEqual(removeOldLogFolders({ keepFolder: 'run-1', logsDir: path.join(logsDir, 'missing') }), { removed: [], failed: [] });
});

test('D94: a folder that cannot be removed is only reported; the others are still removed', (t) => {
  const logsDir = makeTempDir(t);
  for (const folder of ['run-1', 'run-2']) fs.mkdirSync(path.join(logsDir, folder));
  const fileSystem = {
    readdirSync: fs.readdirSync,
    rmSync: (target, options) => {
      if (target.endsWith('run-1')) throw new Error('EBUSY: resource busy or locked');
      return fs.rmSync(target, options);
    },
  };
  let result;
  assert.doesNotThrow(() => { result = removeOldLogFolders({ keepFolder: 'run-3', logsDir, fileSystem }); });
  assert.deepEqual(result.removed, ['run-2']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].name, 'run-1');
  const unreadable = removeOldLogFolders({ keepFolder: 'run-3', logsDir, fileSystem: { readdirSync: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } } });
  assert.equal(unreadable.failed.length, 1);
});

test('D94: the system-log line of the clean-up', () => {
  assert.equal(describeCleanup(2, 1, { removed: ['run-1'] }), 'New run 2: removed 1 old run and its logs');
  assert.equal(describeCleanup(5, 3, { removed: [] }), 'New run 5: removed 3 old runs and their logs');
  assert.equal(describeCleanup(1, 0, { removed: [] }), 'New run 1: no old runs to remove');
  assert.equal(describeCleanup(1, 0, { removed: ['no-run'] }), 'New run 1: no old runs to remove (old log folders removed: no-run)');
});

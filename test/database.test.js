// database.test.js — tests of the database set-up for the groups (src/db/database.js, D89):
// the JobRunGroup table and the JobRunCompany.group_number column exist on a new database and
// are added to an older database file when it is opened again. Offline, temporary SQLite files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db/database.js';
import { makeTempDb, makeTempDir } from './helpers.js';

// The column names of a table, in order.
function columnsOf(db, table) {
  return db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((row) => row.name);
}

// Adds one company and one run, so JobRunGroup rows can point to a run.
function addRun(db) {
  db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES ('a', 'A', 1, 'q')").run();
  const now = new Date().toISOString();
  return Number(db.prepare("INSERT INTO JobRun (started_at, status, last_heartbeat) VALUES (?, 'running', ?)").run(now, now).lastInsertRowid);
}

test('a new database has the JobRunGroup table and JobRunCompany.group_number', (t) => {
  const { db } = makeTempDb(t);
  assert.deepEqual(columnsOf(db, 'JobRunGroup'),
    ['run_id', 'group_number', 'status', 'crashes_in_a_row', 'failed_rounds', 'started_at', 'finished_at', 'last_error', 'exported_at']);
  assert.ok(columnsOf(db, 'JobRunCompany').includes('group_number'));
  assert.ok(columnsOf(db, 'JobRunCompany').includes('group_crashes'), 'D97: crashes counted per company');
});

test('JobRunGroup: defaults, allowed statuses only, one row per (run, group), the run must exist', (t) => {
  const { db } = makeTempDb(t);
  const runId = addRun(db);
  db.prepare('INSERT INTO JobRunGroup (run_id, group_number) VALUES (?, 1)').run(runId);
  const row = db.prepare('SELECT * FROM JobRunGroup').get();
  assert.deepEqual([row.status, row.crashes_in_a_row, row.failed_rounds, row.started_at, row.finished_at, row.last_error, row.exported_at],
    ['pending', 0, 0, null, null, null, null]);
  for (const status of ['in_progress', 'complete', 'failed', 'pending']) {
    db.prepare('UPDATE JobRunGroup SET status = ?').run(status);
  }
  assert.throws(() => db.prepare("UPDATE JobRunGroup SET status = 'done'").run(), /CHECK constraint/);
  assert.throws(() => db.prepare('INSERT INTO JobRunGroup (run_id, group_number) VALUES (?, 1)').run(runId), /UNIQUE|PRIMARY KEY/);
  assert.throws(() => db.prepare('INSERT INTO JobRunGroup (run_id, group_number) VALUES (?, 0)').run(runId), /CHECK constraint/);
  assert.throws(() => db.prepare('INSERT INTO JobRunGroup (run_id, group_number) VALUES (999, 1)').run(), /FOREIGN KEY/);
});

test('an older database file (no JobRunGroup, no group_number) gets both on open; its rows are kept', (t) => {
  const dir = makeTempDir(t);
  const dbPath = path.join(dir, 'old.sqlite');
  const old = new DatabaseSync(dbPath);
  old.exec(`CREATE TABLE JobRunCompany (run_id INTEGER NOT NULL, company_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'not_started', error TEXT, PRIMARY KEY (run_id, company_id));
            INSERT INTO JobRunCompany (run_id, company_id, status) VALUES (1, 'a', 'finished');`);
  old.close();

  const db = openDatabase(dbPath);
  try {
    assert.ok(columnsOf(db, 'JobRunCompany').includes('group_number'));
    assert.ok(columnsOf(db, 'JobRunGroup').length > 0);
    const row = db.prepare('SELECT status, group_number, group_crashes FROM JobRunCompany').get();
    assert.deepEqual([row.status, row.group_number, row.group_crashes], ['finished', null, 0], 'the old row is kept; no data is converted (D89)');
    assert.ok(columnsOf(db, 'JobRunGroup').includes('failed_rounds'));
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_jobruncompany_run_group_status'").get());
  } finally {
    db.close();
  }
  const again = openDatabase(dbPath); // opening a second time changes nothing
  try {
    assert.equal(columnsOf(again, 'JobRunCompany').filter((name) => name === 'group_number').length, 1);
  } finally {
    again.close();
  }
});

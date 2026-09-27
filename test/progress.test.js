// progress.test.js — tests for `npm run progress` (src/tools/progress.js) and for the ready-made
// queries in queries/progress.sql.
//
// Each test builds a temporary database with the real schema (openDatabase), fills it with a
// small made-up run (groups, companies, queue articles, mentions) and checks the numbers the
// progress command reads. Every query in progress.sql is also run against it to prove it is
// valid SQL. No real database is touched; temp files are deleted after each test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { makeTempDb, makeTempDir } from './helpers.js';
import {
  NO_DATABASE_MESSAGE, buildReport, getAllCompanies, getCompanyCounts, getCurrentGroup, getFailedCompanies,
  getFailedGroups, getGroups, staleHeartbeatWarning, getLatestRun, getMentionCounts, getQueueCounts, openReadOnly, runProgress,
} from '../src/tools/progress.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROGRESS_SQL = path.join(ROOT, 'queries', 'progress.sql');
const PROGRESS_JS = path.join(ROOT, 'src', 'tools', 'progress.js');
const NOW = Date.parse('2026-09-27T10:00:00.000Z');

// Fills the database with an old finished run (1) and a running run (2) of 3 groups:
//   group 1 complete  : a finished, b finished, c failed (400)
//   group 2 in_progress: d finished, e fetching, f not_started
//   group 3 pending   : g not_started
// plus queue rows in every state and 4 mentions (a: 2, b: 1, d: 1). Company h has no run row.
function fillSampleRun(db) {
  const addCompany = db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES (?, ?, 1, 'q')");
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) addCompany.run(id, `Company ${id.toUpperCase()}`);

  const addRun = db.prepare(`INSERT INTO JobRun (id, started_at, finished_at, status, last_heartbeat, owner_pid, last_error,
    classified_count, relevant_count, irrelevant_count, failed_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  addRun.run(1, '2026-09-20T08:00:00.000Z', '2026-09-20T12:00:00.000Z', 'done', '2026-09-20T12:00:00.000Z', null, null, 50, 10, 40, 0);
  addRun.run(2, '2026-09-27T08:00:00.000Z', null, 'running', '2026-09-27T09:57:00.000Z', 4242, null, 120, 30, 88, 2);

  const addGroup = db.prepare(`INSERT INTO JobRunGroup (run_id, group_number, status, crashes_in_a_row, started_at, finished_at, last_error, exported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  addGroup.run(1, 1, 'complete', 0, '2026-09-20T08:00:00.000Z', '2026-09-20T09:00:00.000Z', null, '2026-09-20T09:30:00.000Z');
  addGroup.run(2, 1, 'complete', 0, '2026-09-27T08:00:00.000Z', '2026-09-27T09:00:00.000Z', null, '2026-09-27T09:20:00.000Z');
  addGroup.run(2, 2, 'in_progress', 1, '2026-09-27T09:00:00.000Z', null, 'Error: group process died', null);
  addGroup.run(2, 3, 'pending', 0, null, null, null, null);

  const addCheck = db.prepare('INSERT INTO JobRunCompany (run_id, company_id, status, error, group_number) VALUES (?, ?, ?, ?, ?)');
  addCheck.run(1, 'a', 'finished', null, 1); // the old run: must not be counted in run 2
  addCheck.run(2, 'a', 'finished', null, 1);
  addCheck.run(2, 'b', 'finished', null, 1);
  addCheck.run(2, 'c', 'failed', 'Google answered 400 Bad Request 3 times', 1);
  addCheck.run(2, 'd', 'finished', null, 2);
  addCheck.run(2, 'e', 'fetching', null, 2);
  addCheck.run(2, 'f', 'not_started', null, 2);
  addCheck.run(2, 'g', 'not_started', null, 3);

  const addArticle = db.prepare(`INSERT INTO BufferQueue (company_id, guid, url, title, published_at, first_seen_at, status, attempts, claimed_at)
    VALUES (?, ?, 'https://news.google.com/x', ?, '2026-09-20T12:00:00.000Z', '2026-09-27T08:00:00.000Z', ?, ?, ?)`);
  addArticle.run('d', 'q1', 'waiting 1', 'pending', 0, null);
  addArticle.run('d', 'q2', 'waiting 2', 'pending', 0, null);
  addArticle.run('e', 'q3', 'claimed', 'pending', 1, '2026-09-27T09:59:00.000Z');
  addArticle.run('e', 'q4', 'retry', 'failed', 1, null);
  addArticle.run('e', 'q5', 'failed for good', 'failed', 3, null);
  addArticle.run('d', 'q6', 'relevant', 'relevant', 1, null);

  const addMention = db.prepare(`INSERT INTO Mention (company_id, guid, url, title, published_at, first_seen_at, sentiment)
    VALUES (?, ?, 'https://news.google.com/x', 't', '2026-09-20T12:00:00.000Z', '2026-09-27T08:00:00.000Z', ?)`);
  addMention.run('a', 'm1', 'positive');
  addMention.run('a', 'm2', 'negative');
  addMention.run('b', 'm3', 'neutral');
  addMention.run('d', 'm4', 'positive');
}

// Splits progress.sql into its statements: comment lines are removed, then it is cut at ";".
// (The file has no ";" inside strings or comments-within-lines, so this simple split is enough.)
function readSqlStatements() {
  const text = fs.readFileSync(PROGRESS_SQL, 'utf8');
  const withoutComments = text.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
  return withoutComments.split(';').map((statement) => statement.trim()).filter(Boolean);
}

test('the query functions return the right numbers for the latest run', (t) => {
  const { db } = makeTempDb(t);
  fillSampleRun(db);

  const run = getLatestRun(db);
  assert.equal(run.id, 2);
  assert.equal(run.status, 'running');
  assert.equal(run.classified_count, 120);

  const groups = getGroups(db, 2);
  assert.deepEqual(groups.map((g) => [g.group_number, g.status, g.done, g.failed, g.left, g.total]), [
    [1, 'complete', 2, 1, 0, 3],
    [2, 'in_progress', 1, 0, 2, 3],
    [3, 'pending', 0, 0, 1, 1],
  ]);

  const current = getCurrentGroup(db, 2);
  assert.equal(current.group_number, 2);
  assert.equal(current.firstCompany, 'Company D');
  assert.equal(current.lastCompany, 'Company F');
  assert.deepEqual(current.companies.map((c) => c.status), ['finished', 'fetching', 'not_started']);

  assert.deepEqual(getCompanyCounts(db, 2), { finished: 3, failed: 1, fetching: 1, not_started: 2, total: 7 });
  assert.deepEqual(getFailedCompanies(db, 2), [{ name: 'Company C', group_number: 1, error: 'Google answered 400 Bad Request 3 times' }]);
  assert.deepEqual(getFailedGroups(db, 2), []);
  assert.equal(getAllCompanies(db, 2).length, 7);
  assert.equal(getAllCompanies(db, 2).find((c) => c.name === 'Company A').mentions, 2);

  assert.deepEqual(getQueueCounts(db, 3), { waiting: 2, claimed: 1, retry: 1, failed_for_good: 1, relevant: 1, total: 6 });
  assert.deepEqual(getMentionCounts(db), {
    total: 4, positive: 2, negative: 1, neutral: 1, companies_with_mentions: 3, companies_without_mentions: 5,
  });
});

test('a failed group is listed, and no running group gives null', (t) => {
  const { db } = makeTempDb(t);
  fillSampleRun(db);
  db.prepare("UPDATE JobRunGroup SET status = 'failed', crashes_in_a_row = 5, last_error = 'Error: out of memory' WHERE run_id = 2 AND group_number = 2").run();
  assert.deepEqual(getFailedGroups(db, 2), [{ group_number: 2, crashes_in_a_row: 5, last_error: 'Error: out of memory' }]);
  assert.equal(getCurrentGroup(db, 2), null);
});

test('the report shows every section and --all lists every company', (t) => {
  const { db, dbPath } = makeTempDb(t);
  fillSampleRun(db);
  const { lines, hadError } = buildReport(db, { all: true, now: NOW, dbPath });
  const text = lines.join('\n');
  assert.equal(hadError, false);
  assert.match(text, /Run 2 · running · started 2026-09-27 08:00 .*\(3\.0 min ago\) · process 4242/);
  assert.match(text, /3 finished · 1 failed · 1 fetching · 2 not started · 7 total/);
  assert.match(text, /1 complete · 0 failed · 1 in progress · 1 pending · 3 total/);
  assert.match(text, /Group 2 \(Company D … Company F\): 1 done · 0 failed · 2 left of 3/);
  assert.match(text, /Company C\s+1\s+Google answered 400/);
  assert.match(text, /2 waiting · 1 being classified · 1 to retry · 1 failed for good/);
  assert.match(text, /4 total · 2 positive · 1 negative · 1 neutral/);
  assert.match(text, /ALL COMPANIES OF THE RUN/);
});

test('a running run with an old heartbeat gets a warning; a fresh or finished one does not', (t) => {
  const { db, dbPath } = makeTempDb(t);
  fillSampleRun(db); // run 2 is running, last heartbeat 09:57
  const later = Date.parse('2026-09-27T10:17:00.000Z'); // 20 minutes after the last heartbeat
  const warning = staleHeartbeatWarning(getLatestRun(db), later, 15 * 60 * 1000);
  assert.deepEqual(warning, ['  WARNING: No heartbeat for 20 min: the collector may have crashed or be stuck.']);
  assert.match(buildReport(db, { now: later, dbPath }).lines.join('\n'), /No heartbeat for 20 min/);

  assert.deepEqual(staleHeartbeatWarning(getLatestRun(db), NOW, 15 * 60 * 1000), [], 'fresh heartbeat: no warning');
  assert.doesNotMatch(buildReport(db, { now: NOW, dbPath }).lines.join('\n'), /No heartbeat/);
  db.prepare("UPDATE JobRun SET status = 'collected' WHERE id = 2").run();
  assert.deepEqual(staleHeartbeatWarning(getLatestRun(db), later, 15 * 60 * 1000), [], 'not running: no warning');
});

test('an empty database says there is no run yet', (t) => {
  const { db, dbPath } = makeTempDb(t);
  const { lines, hadError } = buildReport(db, { dbPath });
  assert.equal(hadError, false);
  assert.match(lines.join('\n'), /No run yet/);
});

test('a missing table is reported clearly instead of crashing', (t) => {
  const dir = makeTempDir(t);
  const dbPath = path.join(dir, 'partial.sqlite');
  const partial = new DatabaseSync(dbPath);
  partial.exec("CREATE TABLE JobRun (id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, status TEXT, last_heartbeat TEXT, owner_pid INTEGER, last_error TEXT, classified_count INTEGER DEFAULT 0, relevant_count INTEGER DEFAULT 0, irrelevant_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0)");
  partial.exec("INSERT INTO JobRun (id, started_at, status, last_heartbeat) VALUES (1, '2026-09-27T08:00:00.000Z', 'running', '2026-09-27T08:00:00.000Z')");
  partial.close();

  const output = [];
  const code = runProgress({ argv: [], dbPath, out: (text) => output.push(text), err: (text) => output.push(text) });
  const text = output.join('\n');
  assert.equal(code, 0);
  assert.match(text, /Run 1 · running/);
  assert.match(text, /tables JobRunGroup, JobRunCompany don't exist yet/);
  assert.match(text, /table BufferQueue doesn't exist yet/);
});

test('the database is opened read-only: nothing can be written through it', (t) => {
  const { dbPath } = makeTempDb(t);
  const db = openReadOnly(dbPath);
  t.after(() => db.close());
  assert.throws(() => db.exec("INSERT INTO Company (id, name, section, query_param) VALUES ('x', 'X', 1, 'q')"), /readonly/i);
});

test('a WAL database that no service has open can still be read', (t) => {
  const { db, dbPath } = makeTempDb(t);
  fillSampleRun(db);
  db.close(); // like after a run: no writer is connected (makeTempDb's later close is harmless)
  const output = [];
  const code = runProgress({ argv: [], dbPath, out: (text) => output.push(text) });
  assert.equal(code, 0);
  assert.match(output.join('\n'), /Run 2 · running/);
});

test('a missing database file gives the friendly message, exit 0, and creates no file', (t) => {
  const dir = makeTempDir(t);
  const dbPath = path.join(dir, 'nothing-here.sqlite');
  const output = [];
  const code = runProgress({ argv: [], dbPath, out: (text) => output.push(text) });
  assert.equal(code, 0);
  assert.deepEqual(output, [NO_DATABASE_MESSAGE]);
  assert.equal(fs.existsSync(dbPath), false);

  // The same through the real command (as `npm run progress` starts it).
  const result = spawnSync(process.execPath, [PROGRESS_JS], { encoding: 'utf8', env: { ...process.env, DB_PATH: dbPath }, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No database yet — start a run with `npm start`/);
  assert.equal(fs.existsSync(dbPath), false);
});

test('an unknown option is refused with a clear message', () => {
  const errors = [];
  const code = runProgress({ argv: ['--bogus'], dbPath: 'unused.sqlite', err: (text) => errors.push(text) });
  assert.equal(code, 1);
  assert.match(errors[0], /unknown option --bogus/);
});

test('every query in queries/progress.sql is valid SQL and runs on the real schema', (t) => {
  const { db } = makeTempDb(t);
  fillSampleRun(db);
  const statements = readSqlStatements();
  assert.ok(statements.length >= 15, `expected at least 15 queries, found ${statements.length}`);
  for (const statement of statements) {
    assert.match(statement, /^SELECT/i, 'every query must be a read-only SELECT');
    assert.doesNotThrow(() => db.prepare(statement).all(), `query failed:\n${statement}`);
  }
});

test('the progress.sql answers match the numbers of the progress command', (t) => {
  const { db } = makeTempDb(t);
  fillSampleRun(db);
  const statements = readSqlStatements();
  const find = (fragment) => statements.find((statement) => statement.includes(fragment));

  const current = db.prepare(find("AND g.status = 'in_progress'")).all();
  assert.equal(current.length, 1);
  assert.deepEqual([current[0].group_number, current[0].first_company, current[0].last_company, current[0].done, current[0].left, current[0].total],
    [2, 'Company D', 'Company F', 1, 2, 3]);

  const counts = db.prepare(find('AS not_started')).get();
  assert.deepEqual({ ...counts }, { finished: 3, failed: 1, fetching: 1, not_started: 2, total: 7 });

  const queue = Object.fromEntries(db.prepare(find('AS state')).all().map((row) => [row.state, row.articles]));
  assert.deepEqual(queue, {
    'waiting for the AI': 2, 'being classified now': 1, 'failed once, will be retried': 1,
    'failed for good': 1, 'relevant, waiting to be moved': 1,
  });

  const noMentions = db.prepare(find('WHERE NOT EXISTS')).all().map((row) => row.company);
  assert.deepEqual(noMentions, ['Company C', 'Company E', 'Company F', 'Company G', 'Company H']);
});

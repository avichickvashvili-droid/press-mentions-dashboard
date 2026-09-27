// groups.test.js — tests of splitting a run's companies into groups (src/collector/groups.js, D83)
// and of creating the groups when a run starts (acquireRun in src/collector/jobLock.js, D83, D88).
// Offline, temporary SQLite files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { groupCountFor, splitIntoGroups } from '../src/collector/groups.js';
import { acquireRun } from '../src/collector/jobLock.js';
import { TEST_NOW, makeTempDb } from './helpers.js';

// The numbers 1..count, standing in for companies in list order.
function numbers(count) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

// Adds `count` companies c001, c002, ... and returns their ids in list order.
function addCompanies(db, count) {
  const ids = numbers(count).map((n) => `c${String(n).padStart(3, '0')}`);
  const insert = db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES (?, ?, 1, 'q')");
  for (const id of ids) insert.run(id, id.toUpperCase());
  return ids;
}

test('the setting is groups of about 25 companies (D83)', () => {
  assert.equal(config.GROUP_TARGET_SIZE, 25);
});

test('258 companies -> 10 groups: groups 1-8 have 26, groups 9-10 have 25, in list order', () => {
  const groups = splitIntoGroups(numbers(258), 25);
  assert.deepEqual(groups.map((group) => group.length), [26, 26, 26, 26, 26, 26, 26, 26, 25, 25]);
  const firstAndLast = groups.map((group) => [group[0], group.at(-1)]);
  assert.deepEqual(firstAndLast, [
    [1, 26], [27, 52], [53, 78], [79, 104], [105, 130], [131, 156], [157, 182], [183, 208], [209, 233], [234, 258],
  ]);
  assert.deepEqual(groups.flat(), numbers(258), 'every company once, order kept');
});

test('100 companies -> 4 groups of 25; 40 -> 2 groups of 20', () => {
  assert.deepEqual(splitIntoGroups(numbers(100), 25).map((group) => group.length), [25, 25, 25, 25]);
  assert.deepEqual(splitIntoGroups(numbers(40), 25).map((group) => group.length), [20, 20]);
});

test('fewer than 25 companies -> 1 group (24 and 7); the rounding goes to the nearest whole number', () => {
  assert.deepEqual(splitIntoGroups(numbers(24), 25), [numbers(24)]);
  assert.deepEqual(splitIntoGroups(numbers(7), 25), [numbers(7)]);
  assert.deepEqual([1, 37, 38, 62, 63].map((n) => groupCountFor(n, 25)), [1, 1, 2, 2, 3]);
  assert.deepEqual(splitIntoGroups(numbers(38), 25).map((group) => group.length), [19, 19]);
  assert.deepEqual(splitIntoGroups(numbers(63), 25).map((group) => group.length), [21, 21, 21]);
  assert.deepEqual(splitIntoGroups(numbers(64), 25).map((group) => group.length), [22, 21, 21], 'the first group gets the extra one');
});

test('no companies -> no groups', () => {
  assert.deepEqual(splitIntoGroups([], 25), []);
});

test('a wrong group size is refused with a clear message', () => {
  for (const bad of [0, -1, 2.5, undefined, '25']) {
    assert.throws(() => splitIntoGroups(numbers(5), bad), /GROUP_TARGET_SIZE in src\/config\.js/);
  }
});

test('a new run of 258 companies gets 10 pending groups and each company its group number (same transaction)', (t) => {
  const { db } = makeTempDb(t);
  const ids = addCompanies(db, 258);
  const run = acquireRun(db, ids, { now: TEST_NOW, pid: 1 });
  assert.equal(run.groupCount, 10);

  const groups = db.prepare('SELECT * FROM JobRunGroup WHERE run_id = ? ORDER BY group_number').all(run.runId);
  assert.deepEqual(groups.map((g) => g.group_number), numbers(10));
  for (const group of groups) {
    assert.deepEqual(
      [group.status, group.crashes_in_a_row, group.started_at, group.finished_at, group.last_error, group.exported_at],
      ['pending', 0, null, null, null, null],
    );
  }
  const sizes = db.prepare('SELECT group_number, COUNT(*) AS n FROM JobRunCompany WHERE run_id = ? GROUP BY group_number ORDER BY group_number').all(run.runId);
  assert.deepEqual(sizes.map((row) => row.n), [26, 26, 26, 26, 26, 26, 26, 26, 25, 25]);
  const groupOf = (id) => db.prepare('SELECT group_number FROM JobRunCompany WHERE run_id = ? AND company_id = ?').get(run.runId, id).group_number;
  assert.deepEqual([groupOf(ids[0]), groupOf(ids[25]), groupOf(ids[26]), groupOf(ids[232]), groupOf(ids[233]), groupOf(ids[257])], [1, 1, 2, 9, 10, 10]);
});

test('if a company row cannot be written, nothing of the new run is kept (run, checklist and groups are one transaction)', (t) => {
  const { db } = makeTempDb(t);
  const ids = addCompanies(db, 12);
  assert.throws(() => acquireRun(db, [...ids, 'not-a-company'], { now: TEST_NOW, pid: 1 }), /FOREIGN KEY/);
  for (const table of ['JobRun', 'JobRunCompany', 'JobRunGroup']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, `${table} is empty`);
  }
});

test('resuming a run makes no groups again and adds no newly listed company (D88)', (t) => {
  const { db } = makeTempDb(t);
  const ids = addCompanies(db, 250); // 10 groups of 25
  const first = acquireRun(db, ids, { now: TEST_NOW, pid: 1 });
  db.prepare("UPDATE JobRunGroup SET status = 'complete' WHERE run_id = ? AND group_number = 1").run(first.runId);
  db.prepare('UPDATE JobRun SET owner_pid = NULL WHERE id = ?').run(first.runId); // released (emergency heartbeat)
  const newId = 'c999';
  db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES (?, 'NEW', 1, 'q')").run(newId);

  const resumed = acquireRun(db, [...ids, newId], { now: TEST_NOW + 60000, pid: 2 });
  assert.deepEqual([resumed.runId, resumed.tookOver, resumed.groupCount], [first.runId, true, 10]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRunGroup WHERE run_id = ?').get(first.runId).n, 10);
  assert.equal(db.prepare("SELECT status FROM JobRunGroup WHERE run_id = ? AND group_number = 1").get(first.runId).status, 'complete');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRunCompany WHERE run_id = ?').get(first.runId).n, 250);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRunCompany WHERE company_id = ?').get(newId).n, 0, 'the new company waits for the next run');
});

// groupExport.test.js — data/ after each group (D86): runFinisher.js (findGroupToExport,
// exportGroup, markRunDone), exporter.js (the groups and failedCompanies in run.json), mover.js
// (moving only one group's rows) and the classifier loop calling it. Fake Ollama, offline,
// temporary SQLite + data folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDb } from '../helpers.js';
import { addCompanies, addQueueRows, makeFakeClient, makeLogger, SECTION_NAMES, writeCompanyList } from './classifierHelpers.js';
import { createClassifier } from '../../src/classifier/classifierLoop.js';
import { exportGroup, findGroupToExport, finishHeldRun, takeOverRun } from '../../src/classifier/runFinisher.js';
import { moveRelevantRows } from '../../src/classifier/mover.js';
import { config } from '../../src/config.js';

const NOW = Date.parse('2026-09-27T10:00:00.000Z');

// A run being collected ('running', owned by the collector, pid 77) with 2 groups:
// group 1 = Harvey, Ukko; group 2 = Zeta. Harvey finished, Ukko failed (Google 400), Zeta not started.
function setup(t) {
  const { db, dir } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }, { id: 'ukko', name: 'Ukko' }, { id: 'zeta', name: 'Zeta' }]);
  const companyListFile = writeCompanyList(dir, ['Harvey', 'Ukko', 'Zeta']);
  const runId = Number(db.prepare(`INSERT INTO JobRun (started_at, status, last_heartbeat, owner_pid)
                                   VALUES ('2026-09-27T06:00:00.000Z', 'running', '2026-09-27T09:00:00.000Z', 77)`).run().lastInsertRowid);
  const addCompany = db.prepare('INSERT INTO JobRunCompany (run_id, company_id, status, error, group_number) VALUES (?, ?, ?, ?, ?)');
  addCompany.run(runId, 'harvey', 'finished', null, 1);
  addCompany.run(runId, 'ukko', 'failed', 'Google rejected the search (HTTP 400), 3 tries 1 min apart', 1);
  addCompany.run(runId, 'zeta', 'not_started', null, 2);
  db.prepare("INSERT INTO JobRunGroup (run_id, group_number, status) VALUES (?, 1, 'in_progress'), (?, 2, 'pending')").run(runId, runId);
  return { db, runId, dataDir: path.join(dir, 'data'), companyListFile };
}

// Sets a group's status.
function setGroup(db, runId, groupNumber, status) {
  db.prepare('UPDATE JobRunGroup SET status = ? WHERE run_id = ? AND group_number = ?').run(status, runId, groupNumber);
}

// Reads one data/ file as an object.
function readData(dataDir, name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
}

test('a group is ready for export only once it has ended and none of its articles is left to classify', (t) => {
  const { db, runId } = setup(t);
  const [pendingId] = addQueueRows(db, [
    { companyId: 'harvey', guid: 'h1', title: 'Harvey one' },                                    // pending
    { companyId: 'harvey', guid: 'h2', title: 'Harvey two', status: 'failed', attempts: config.MAX_ATTEMPTS }, // failed for good: ignored (D72)
    { companyId: 'zeta', guid: 'z1', title: 'Zeta one' },                                        // another group: ignored
  ]);
  assert.equal(findGroupToExport(db), undefined, 'group 1 has not ended yet');
  setGroup(db, runId, 1, 'complete');
  assert.equal(findGroupToExport(db), undefined, 'Harvey still has a pending article');

  db.prepare("UPDATE BufferQueue SET status = 'failed', attempts = 1 WHERE id = ?").run(pendingId);
  assert.equal(findGroupToExport(db), undefined, 'a failed article with attempts left will be retried');
  db.prepare("UPDATE BufferQueue SET status = 'relevant', sentiment = 'positive', claimed_at = 'x' WHERE id = ?").run(pendingId);
  assert.equal(findGroupToExport(db), undefined, 'a claimed article is still being worked on');
  db.prepare('UPDATE BufferQueue SET claimed_at = NULL WHERE id = ?').run(pendingId);
  assert.deepEqual(findGroupToExport(db), { runId, groupNumber: 1, finishedAt: null });

  setGroup(db, runId, 1, 'failed');
  assert.deepEqual(findGroupToExport(db), { runId, groupNumber: 1, finishedAt: null }, 'a failed group is exported too');
  db.prepare("UPDATE JobRun SET status = 'collected'").run();
  assert.equal(findGroupToExport(db), undefined, 'once the run is collected, the end-of-run export takes over');
});

test('moving one group\'s rows leaves the other groups\' relevant rows in the queue', (t) => {
  const { db, runId } = setup(t);
  addQueueRows(db, [
    { companyId: 'harvey', guid: 'h1', title: 'Harvey one', status: 'relevant', sentiment: 'positive' },
    { companyId: 'zeta', guid: 'z1', title: 'Zeta one', status: 'relevant', sentiment: 'neutral' },
  ]);
  assert.deepEqual(moveRelevantRows(db, { group: { runId, groupNumber: 1 } }), { moved: 1, alreadyInMention: 0 });
  assert.deepEqual(db.prepare('SELECT company_id FROM Mention').all().map((row) => row.company_id), ['harvey']);
  assert.deepEqual(db.prepare('SELECT company_id FROM BufferQueue').all().map((row) => row.company_id), ['zeta']);
});

test('after group 1: its rows move to Mention, data/ is written with the groups and failed companies, exported_at is set; group 2 waits', async (t) => {
  const { db, runId, dataDir, companyListFile } = setup(t);
  setGroup(db, runId, 1, 'complete');
  addQueueRows(db, [{ companyId: 'harvey', guid: 'h1', title: 'Harvey one', status: 'relevant', sentiment: 'positive' }]);

  const result = await exportGroup(db, { runId, groupNumber: 1 }, { now: NOW, dataDir, companyListFile });
  assert.equal(result.moved, 1);
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ['companies.json', 'mentions.json', 'run.json']);
  assert.equal(readData(dataDir, 'mentions.json').mentions.length, 1);
  const runFile = readData(dataDir, 'run.json');
  assert.deepEqual(runFile.groups, { total: 2, complete: [1], failed: [], exported: 1 });
  assert.deepEqual(runFile.failedCompanies, ['Ukko']);
  assert.equal(runFile.finishedAt, null, 'the run is not finished yet');
  assert.equal(runFile.asOf, new Date(NOW).toISOString());
  assert.equal(db.prepare('SELECT exported_at FROM JobRunGroup WHERE group_number = 1').get().exported_at, new Date(NOW).toISOString());
  assert.equal(db.prepare('SELECT exported_at FROM JobRunGroup WHERE group_number = 2').get().exported_at, null);
  assert.equal(findGroupToExport(db), undefined, 'group 1 is not exported twice');
  assert.equal(db.prepare('SELECT status, owner_pid FROM JobRun').get().owner_pid, 77, 'the collector still owns the run');
});

test('the classifier loop writes data/ after group 1 once its articles are classified, and not for group 2 before its are', async (t) => {
  const { db, runId, dataDir, companyListFile } = setup(t);
  setGroup(db, runId, 1, 'complete');
  setGroup(db, runId, 2, 'complete');
  db.prepare("UPDATE JobRunCompany SET status = 'finished' WHERE company_id = 'zeta'").run();
  addQueueRows(db, [
    { companyId: 'harvey', guid: 'h1', title: 'Harvey one' },
    { companyId: 'zeta', guid: 'z1', title: 'Zeta one' },
  ]);
  // Harvey's article is answered; Zeta's keeps failing (it stays waiting for a retry).
  const client = makeFakeClient((article) => (article.companyName === 'Zeta' ? 'invalid' : { relevant: true, sentiment: 'positive' }));
  const logger = makeLogger();
  const classifier = createClassifier({
    db, client, sectionNames: SECTION_NAMES, pid: 4242, concurrency: 1, claimBatchSize: 4, moveChunk: 1000, dataDir, companyListFile,
    isAlive: () => true, sleep: async () => {}, now: () => NOW, log: logger.log, warn: logger.warn,
  });
  await classifier.runOnePass();
  assert.ok(fs.existsSync(path.join(dataDir, 'run.json')), 'data/ written after group 1');
  const exported = db.prepare('SELECT group_number, exported_at FROM JobRunGroup ORDER BY group_number').all().map((row) => [row.group_number, row.exported_at !== null]);
  assert.deepEqual(exported, [[1, true], [2, false]], 'group 2 still has an article to retry');
  assert.equal(readData(dataDir, 'run.json').groups.exported, 1);
  assert.ok(logger.lines.log.some((line) => /group 1: all its articles are classified/.test(line)));
});

test('the end-of-run export covers every group: run.json groups.exported = total, finishedAt set, all groups get exported_at', async (t) => {
  const { db, runId, dataDir, companyListFile } = setup(t);
  setGroup(db, runId, 1, 'complete');
  setGroup(db, runId, 2, 'failed');
  db.prepare("UPDATE JobRunGroup SET exported_at = '2026-09-27T08:00:00.000Z' WHERE group_number = 1").run();
  db.prepare("UPDATE JobRun SET status = 'collected', owner_pid = NULL, finished_at = '2026-09-27T09:30:00.000Z'").run();
  assert.equal(takeOverRun(db, runId, { pid: 4242, now: NOW, isAlive: () => true }), true);
  const result = await finishHeldRun(db, runId, { pid: 4242, now: NOW, dataDir, companyListFile });
  assert.equal(result.done, true);
  const runFile = readData(dataDir, 'run.json');
  assert.deepEqual(runFile.groups, { total: 2, complete: [1], failed: [2], exported: 2 });
  assert.equal(runFile.finishedAt, new Date(NOW).toISOString());
  const rows = db.prepare('SELECT group_number, exported_at FROM JobRunGroup ORDER BY group_number').all().map((row) => [row.group_number, row.exported_at]);
  assert.deepEqual(rows, [[1, '2026-09-27T08:00:00.000Z'], [2, new Date(NOW).toISOString()]], 'the earlier export time is kept');
});

test('G2: a failing after-group export never fails the pass: classifying goes on, ONE warning, the group is tried again only after 5 min', async (t) => {
  const { db, runId, dataDir, companyListFile } = setup(t);
  setGroup(db, runId, 1, 'complete'); // group 1 is ready to export at once
  db.prepare("UPDATE JobRunCompany SET status = 'fetching' WHERE company_id = 'zeta'").run();
  setGroup(db, runId, 2, 'in_progress'); // group 2 is still being collected: its articles keep coming
  addQueueRows(db, Array.from({ length: 6 }, (_, index) => ({ companyId: 'zeta', guid: `z${index}`, title: `Zeta news ${index}` })));
  let renames = 0;
  const rename = () => { renames += 1; throw Object.assign(new Error('EPERM: run.json is open in another program'), { code: 'EPERM' }); };
  let clock = NOW;
  const logger = makeLogger();
  const classifier = createClassifier({
    db, client: makeFakeClient(() => ({ relevant: false })), sectionNames: SECTION_NAMES, pid: 4242, concurrency: 1, claimBatchSize: 2,
    moveChunk: 1000, dataDir, companyListFile, exportWriteOptions: { rename, tries: 1 },
    isAlive: () => true, sleep: async () => {}, now: () => clock, log: logger.log, warn: logger.warn,
  });
  for (let pass = 0; pass < 3; pass += 1) {
    const result = await classifier.runOnePass();
    assert.equal(result.kind, 'worked', `pass ${pass + 1} classified its batch`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n, 0, 'all 6 articles classified (irrelevant ones deleted)');
  assert.equal(renames, 1, 'the export was tried once, not on every pass');
  const warnings = logger.lines.warn.filter((line) => /group 1: data\/ could not be written/.test(line));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Classifying goes on/);
  assert.equal(db.prepare('SELECT exported_at FROM JobRunGroup WHERE group_number = 1').get().exported_at, null);

  clock += config.GROUP_EXPORT_RETRY_MS; // 5 minutes later: tried again (and fails again, quietly)
  assert.equal((await classifier.runOnePass()).kind, 'idle');
  assert.equal(renames, 2);
  assert.equal(logger.lines.warn.filter((line) => /could not be written/.test(line)).length, 1, 'still one warning');
});

test('G8: a --groups re-run that resets the group while its data/ is being written: the group is NOT marked exported', async (t) => {
  const { db, runId, dataDir, companyListFile } = setup(t);
  setGroup(db, runId, 1, 'complete');
  db.prepare("UPDATE JobRunGroup SET finished_at = '2026-09-27T09:00:00.000Z' WHERE group_number = 1").run();
  const group = findGroupToExport(db);
  assert.equal(group.finishedAt, '2026-09-27T09:00:00.000Z');
  // While the files are renamed, the re-run resets group 1 (as reopenRunForGroups does).
  const rename = (from, to) => {
    db.prepare("UPDATE JobRunGroup SET status = 'pending', finished_at = NULL, exported_at = NULL WHERE group_number = 1").run();
    fs.renameSync(from, to);
  };
  const result = await exportGroup(db, group, { now: NOW, dataDir, companyListFile, writeOptions: { rename } });
  assert.equal(result.marked, false);
  assert.equal(db.prepare('SELECT exported_at FROM JobRunGroup WHERE group_number = 1').get().exported_at, null);

  // The re-run ends again (a new finished_at): the old export's mark must not count for it either.
  setGroup(db, runId, 1, 'complete');
  db.prepare("UPDATE JobRunGroup SET finished_at = '2026-09-27T09:45:00.000Z' WHERE group_number = 1").run();
  const stale = await exportGroup(db, group, { now: NOW, dataDir, companyListFile });
  assert.equal(stale.marked, false, 'finished_at changed since the group was found ready');
  const fresh = await exportGroup(db, findGroupToExport(db), { now: NOW, dataDir, companyListFile });
  assert.equal(fresh.marked, true);
});

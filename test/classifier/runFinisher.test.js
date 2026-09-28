// runFinisher.test.js — finishing a collected run: take-over rules, leftovers moved, data/ written
// crash-safely (including a rename that fails, D41), only companies in the current list exported
// (D79), run marked 'done' (runFinisher.js, exporter.js). Offline, temporary SQLite + folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDb } from '../helpers.js';
import { addCompanies, addQueueRows, addRun, writeCompanyList } from './classifierHelpers.js';
import { finishHeldRun, takeOverRun } from '../../src/classifier/runFinisher.js';
import { findCollectedRun } from '../../src/shared/runLock.js';
import { buildExport, writeExportFiles } from '../../src/classifier/exporter.js';

const NOW = Date.parse('2026-09-27T10:00:00.000Z');

// A temp database with Harvey, Ukko and Zeta, and a company list file with the same three names.
function setup(t) {
  const { db, dir } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey', section: 1 }, { id: 'ukko', name: 'Ukko', section: 2 }, { id: 'zeta', name: 'Zeta', section: 1 }]);
  const companyListFile = writeCompanyList(dir, ['Harvey', 'Ukko', 'Zeta']);
  return { db, dir, dataDir: path.join(dir, 'data'), companyListFile };
}

// A rename that fails with `code` the first `failures` times it is called for `fileName`, then
// works. Records every call as the target file name.
function flakyRename(fileName, failures, code) {
  const calls = [];
  let failed = 0;
  const rename = (from, to) => {
    calls.push(path.basename(to));
    if (path.basename(to) === fileName && failed < failures) {
      failed += 1;
      throw Object.assign(new Error(`${code}: rename '${from}' failed`), { code });
    }
    fs.renameSync(from, to);
  };
  return { rename, calls };
}

// A sleep that returns at once but remembers every wait.
function recordingSleep() {
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); };
  return { sleep, waits };
}

function addMention(db, { companyId, guid, publishedAt, sentiment = 'positive' }) {
  db.prepare(`INSERT INTO Mention (company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment)
              VALUES (?, ?, ?, ?, 'P', ?, '2026-09-26T00:00:00.000Z', ?)`).run(companyId, guid, `https://news.google.com/rss/articles/${guid}`, `Title ${guid}`, publishedAt, sentiment);
}

test('take-over: allowed when free, ours, dead or stale; refused while another live process holds it', (t) => {
  const { db } = setup(t);
  const alive = () => true;
  const free = addRun(db, { status: 'collected', ownerPid: null });
  assert.equal(takeOverRun(db, free, { pid: 10, now: NOW, isAlive: alive }), true);
  assert.equal(db.prepare('SELECT owner_pid FROM JobRun WHERE id = ?').get(free).owner_pid, 10);
  assert.equal(takeOverRun(db, free, { pid: 10, now: NOW, isAlive: alive }), true); // already ours

  const heldFresh = addRun(db, { status: 'collected', ownerPid: 20, heartbeat: '2026-09-27T09:55:00.000Z' });
  assert.equal(takeOverRun(db, heldFresh, { pid: 10, now: NOW, isAlive: alive }), false);
  assert.equal(takeOverRun(db, heldFresh, { pid: 10, now: NOW, isAlive: (pid) => pid !== 20 }), true); // holder dead

  const heldStale = addRun(db, { status: 'collected', ownerPid: 30, heartbeat: '2026-09-27T09:40:00.000Z' });
  assert.equal(takeOverRun(db, heldStale, { pid: 10, now: NOW, isAlive: alive }), true); // 20 min > 15 min

  const running = addRun(db, { status: 'running', ownerPid: null });
  assert.equal(takeOverRun(db, running, { pid: 10, now: NOW, isAlive: alive }), false); // collector's run
});

test('findCollectedRun picks the oldest collected run', (t) => {
  const { db } = setup(t);
  addRun(db, { status: 'done' });
  const first = addRun(db, { status: 'collected' });
  addRun(db, { status: 'collected' });
  assert.equal(findCollectedRun(db).id, first);
});

test('finishing a run moves the leftovers, writes the 3 files and marks the run done', async (t) => {
  const { db, dataDir, companyListFile } = setup(t);
  const runId = addRun(db, { status: 'collected', companyIds: ['harvey', 'ukko', 'zeta'] });
  db.prepare("UPDATE JobRunCompany SET status = 'failed', error = 'HTTP 400' WHERE run_id = ? AND company_id = 'zeta'").run(runId);
  db.prepare('UPDATE JobRun SET classified_count = 5, relevant_count = 3, irrelevant_count = 2, failed_count = 1 WHERE id = ?').run(runId);
  addMention(db, { companyId: 'harvey', guid: 'old', publishedAt: '2026-05-01T00:00:00.000Z' });       // outside 90 days
  addMention(db, { companyId: 'harvey', guid: 'h1', publishedAt: '2026-09-24T09:00:00.000Z', sentiment: 'negative' });
  addQueueRows(db, [
    { companyId: 'harvey', guid: 'h2', title: 'H2 - Example News', status: 'relevant', sentiment: 'positive', publishedAt: '2026-09-25T12:00:00.000Z' },
    { companyId: 'ukko', guid: 'u1', title: 'U1', status: 'failed', attempts: 3 },
  ]);
  assert.equal(takeOverRun(db, runId, { pid: 10, now: NOW, isAlive: () => true }), true);

  const result = await finishHeldRun(db, runId, { pid: 10, now: NOW, dataDir, companyListFile });
  assert.equal(result.done, true);
  assert.deepEqual(result.files.map((file) => path.basename(file)), ['companies.json', 'mentions.json', 'run.json'], 'run.json is renamed last');
  assert.equal(result.moved, 1);
  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId);
  assert.equal(run.status, 'done');
  assert.equal(run.owner_pid, null);
  assert.equal(run.finished_at, '2026-09-27T10:00:00.000Z');

  assert.deepEqual(fs.readdirSync(dataDir).sort(), ['companies.json', 'mentions.json', 'run.json']); // no .tmp left
  const companies = JSON.parse(fs.readFileSync(path.join(dataDir, 'companies.json'), 'utf8'));
  assert.equal(companies.asOf, '2026-09-27T10:00:00.000Z');
  assert.equal(companies.windowStart, '2026-06-29T10:00:00.000Z');
  assert.deepEqual(companies.companies.map((c) => [c.id, c.status, c.lastMentionAt, c.daysAgo, c.mentionCount]), [
    ['harvey', 'mentioned', '2026-09-25T12:00:00.000Z', 1, 2],
    ['ukko', 'no_coverage', null, null, 0],
    ['zeta', 'no_coverage', null, null, 0],
  ]);
  assert.deepEqual(companies.companies[0].sentimentCounts, { positive: 1, neutral: 0, negative: 1 });

  const mentions = JSON.parse(fs.readFileSync(path.join(dataDir, 'mentions.json'), 'utf8'));
  assert.deepEqual(mentions.mentions.map((m) => m.guid), ['h2', 'h1']); // newest first, old one left out
  assert.deepEqual(Object.keys(mentions.mentions[0]).sort(), ['alertedAt', 'companyId', 'companyName', 'firstSeenAt', 'guid', 'publishedAt', 'publisher', 'sentiment', 'title', 'url']);

  const runFile = JSON.parse(fs.readFileSync(path.join(dataDir, 'run.json'), 'utf8'));
  assert.equal(runFile.runId, runId);
  assert.equal(runFile.collectedAt, '2026-09-27T09:00:00.000Z');
  assert.deepEqual(runFile.counts, { classified: 5, relevant: 3, irrelevantDeleted: 2, failedPermanently: 1 });
  assert.deepEqual(runFile.companies, { total: 3, finished: 2, failed: [{ id: 'zeta', name: 'Zeta', error: 'HTTP 400' }] });
  assert.deepEqual(runFile.failedArticles.map((a) => a.guid), ['u1']);
  assert.equal(runFile.mentionsInWindow, 2);
});

test('a failed export leaves the run collected (retried later), not done', async (t) => {
  const { db, dataDir, companyListFile } = setup(t);
  const runId = addRun(db, { status: 'collected' });
  fs.writeFileSync(dataDir, 'a file where the folder should be'); // makes mkdir fail
  takeOverRun(db, runId, { pid: 10, now: NOW, isAlive: () => true });
  await assert.rejects(finishHeldRun(db, runId, { pid: 10, now: NOW, dataDir, companyListFile }));
  assert.equal(db.prepare('SELECT status FROM JobRun WHERE id = ?').get(runId).status, 'collected');
});

test('a rename that fails for a moment (file open in another program) is tried again and then works', async (t) => {
  const { dataDir } = setup(t);
  const { rename, calls } = flakyRename('mentions.json', 2, 'EPERM');
  const { sleep, waits } = recordingSleep();
  const files = { 'run.json': { runId: 1 }, 'companies.json': { asOf: 'x' }, 'mentions.json': { asOf: 'x' } };
  const written = await writeExportFiles(files, { dataDir, rename, sleep, tries: 5, retryMs: 200 });
  assert.deepEqual(written.map((file) => path.basename(file)), ['companies.json', 'mentions.json', 'run.json'], 'fixed order, run.json last');
  assert.deepEqual(calls, ['companies.json', 'mentions.json', 'mentions.json', 'mentions.json', 'run.json']);
  assert.deepEqual(waits, [200, 200], 'short export waits, not the Ollama backoff');
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ['companies.json', 'mentions.json', 'run.json'], 'no .tmp left');
});

test('a rename that keeps failing: the export throws after the last try, run.json is not replaced, the run stays collected, and a later try finishes it', async (t) => {
  const { db, dataDir, companyListFile } = setup(t);
  const runId = addRun(db, { status: 'collected', companyIds: ['harvey'] });
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'run.json'), '{"runId": "old"}\n');
  takeOverRun(db, runId, { pid: 10, now: NOW, isAlive: () => true });

  const stuck = flakyRename('mentions.json', Infinity, 'EBUSY');
  const { sleep, waits } = recordingSleep();
  await assert.rejects(
    finishHeldRun(db, runId, { pid: 10, now: NOW, dataDir, companyListFile, writeOptions: { rename: stuck.rename, sleep, tries: 5, retryMs: 200 } }),
    /EBUSY/,
  );
  assert.equal(stuck.calls.filter((name) => name === 'mentions.json').length, 5, 'tried 5 times');
  assert.deepEqual(waits, [200, 200, 200, 200]);
  assert.equal(stuck.calls.includes('run.json'), false, 'run.json is renamed last, so it was never replaced');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'run.json'), 'utf8')), { runId: 'old' });
  assert.equal(db.prepare('SELECT status FROM JobRun WHERE id = ?').get(runId).status, 'collected');

  const result = await finishHeldRun(db, runId, { pid: 10, now: NOW, dataDir, companyListFile });
  assert.equal(result.done, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'run.json'), 'utf8')).runId, runId);
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ['companies.json', 'mentions.json', 'run.json']);
});

test('a rename error that is not "file busy" is thrown at once, without retrying', async (t) => {
  const { dataDir } = setup(t);
  const broken = flakyRename('companies.json', Infinity, 'ENOSPC');
  const { sleep, waits } = recordingSleep();
  await assert.rejects(writeExportFiles({ 'companies.json': {} }, { dataDir, rename: broken.rename, sleep }), /ENOSPC/);
  assert.equal(broken.calls.length, 1);
  assert.deepEqual(waits, []);
});

test('only companies in the current list are exported, with their mentions (D79); old rows stay in the database', async (t) => {
  const { db, dir, dataDir } = setup(t);
  addMention(db, { companyId: 'zeta', guid: 'z1', publishedAt: '2026-09-24T09:00:00.000Z' });
  addMention(db, { companyId: 'harvey', guid: 'h1', publishedAt: '2026-09-24T09:00:00.000Z' });
  const runId = addRun(db, { status: 'collected' });
  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId);
  const files = buildExport(db, { run, now: NOW, companyNames: ['Harvey', 'Ukko'] }); // Zeta was removed from the list
  assert.deepEqual(files['companies.json'].companies.map((c) => c.id), ['harvey', 'ukko']);
  assert.deepEqual(files['mentions.json'].mentions.map((m) => m.guid), ['h1']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM Company WHERE id = 'zeta'").get().n, 1, 'never deleted (D46)');

  // End to end: finishing the run reads the list file (here: Zeta renamed to "Zeta Labs", a new name).
  const companyListFile = writeCompanyList(dir, ['Harvey', 'Ukko', 'Zeta Labs']);
  takeOverRun(db, runId, { pid: 10, now: NOW, isAlive: () => true });
  await finishHeldRun(db, runId, { pid: 10, now: NOW, dataDir, companyListFile });
  const companies = JSON.parse(fs.readFileSync(path.join(dataDir, 'companies.json'), 'utf8'));
  assert.deepEqual(companies.companies.map((c) => c.name), ['Harvey', 'Ukko']);
});

test('buildExport lists every company in the list even with no mentions at all', (t) => {
  const { db } = setup(t);
  const runId = addRun(db, { status: 'collected' });
  const files = buildExport(db, { run: db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId), now: NOW, companyNames: ['Harvey', 'Ukko', 'Zeta'] });
  assert.equal(files['companies.json'].companies.length, 3);
  assert.equal(files['mentions.json'].mentions.length, 0);
  assert.equal(files['run.json'].mentionsInWindow, 0);
});

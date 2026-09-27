// runFinisher.test.js — finishing a collected run: take-over rules, leftovers moved, data/ written
// crash-safely, run marked 'done' (runFinisher.js, exporter.js). Offline, temporary SQLite + folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDb } from '../helpers.js';
import { addCompanies, addQueueRows, addRun } from './classifierHelpers.js';
import { finishHeldRun, findCollectedRun, takeOverRun } from '../../src/classifier/runFinisher.js';
import { buildExport } from '../../src/classifier/exporter.js';

const NOW = Date.parse('2026-09-27T10:00:00.000Z');

function setup(t) {
  const { db, dir } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey', section: 1 }, { id: 'ukko', name: 'Ukko', section: 2 }, { id: 'zeta', name: 'Zeta', section: 1 }]);
  return { db, dataDir: path.join(dir, 'data') };
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

test('finishing a run moves the leftovers, writes the 3 files and marks the run done', (t) => {
  const { db, dataDir } = setup(t);
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

  const result = finishHeldRun(db, runId, { pid: 10, now: NOW, dataDir });
  assert.equal(result.done, true);
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

test('a failed export leaves the run collected (retried later), not done', (t) => {
  const { db, dataDir } = setup(t);
  const runId = addRun(db, { status: 'collected' });
  fs.writeFileSync(dataDir, 'a file where the folder should be'); // makes mkdir fail
  takeOverRun(db, runId, { pid: 10, now: NOW, isAlive: () => true });
  assert.throws(() => finishHeldRun(db, runId, { pid: 10, now: NOW, dataDir }));
  assert.equal(db.prepare('SELECT status FROM JobRun WHERE id = ?').get(runId).status, 'collected');
});

test('buildExport lists every company even with no mentions at all', (t) => {
  const { db } = setup(t);
  const runId = addRun(db, { status: 'collected' });
  const files = buildExport(db, { run: db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId), now: NOW });
  assert.equal(files['companies.json'].companies.length, 3);
  assert.equal(files['mentions.json'].mentions.length, 0);
  assert.equal(files['run.json'].mentionsInWindow, 0);
});

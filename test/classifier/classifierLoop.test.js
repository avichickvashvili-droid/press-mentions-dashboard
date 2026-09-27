// classifierLoop.test.js — the classifier loop end to end with a fake Ollama (classifierLoop.js)
// and the stop/crash clean-up (stopHandlers.js). Offline, temporary SQLite + data folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { makeTempDb } from '../helpers.js';
import { addCompanies, addQueueRows, addRun, makeFakeClient, makeLogger, queueRows, SECTION_NAMES } from './classifierHelpers.js';
import { createClassifier } from '../../src/classifier/classifierLoop.js';
import { installStopHandlers } from '../../src/classifier/stopHandlers.js';
import { claimBatch } from '../../src/classifier/queueStore.js';

const NOW = Date.parse('2026-09-27T10:00:00.000Z');

function setup(t, rows) {
  const { db, dir } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey', section: 1 }, { id: 'ukko', name: 'Ukko', section: 2 }]);
  const ids = addQueueRows(db, rows);
  return { db, ids, dataDir: path.join(dir, 'data') };
}

function makeClassifier(db, client, extra = {}) {
  const logger = makeLogger();
  const waits = [];
  const classifier = createClassifier({
    db, client, sectionNames: SECTION_NAMES, pid: 4242, concurrency: 2, claimBatchSize: 4, moveChunk: 1000,
    isAlive: () => true, sleep: async (ms) => { waits.push(ms); await new Promise((resolve) => setImmediate(resolve)); }, now: () => NOW, log: logger.log, warn: logger.warn, ...extra,
  });
  return { classifier, logger, waits };
}

// Decides by headline: "junk" → irrelevant, "bad" → invalid, "down" → Ollama down, else relevant/positive.
const byTitle = (article) => {
  if (article.title.startsWith('junk')) return { relevant: false };
  if (article.title.startsWith('bad')) return 'invalid';
  if (article.title.startsWith('down')) return 'down';
  return { relevant: true, sentiment: 'positive' };
};

test('a pass classifies a batch: junk deleted, relevant kept, prompt gets the full section name', async (t) => {
  const { db } = setup(t, [
    { companyId: 'harvey', guid: 'a', title: 'Harvey raises money - Example News' },
    { companyId: 'ukko', guid: 'b', title: 'junk about another Ukko' },
    { companyId: 'harvey', guid: 'c', title: 'Harvey hires' },
  ]);
  const client = makeFakeClient(byTitle);
  const { classifier } = makeClassifier(db, client);
  const pass = await classifier.runOnePass();
  assert.equal(pass.kind, 'worked');
  assert.deepEqual(queueRows(db).map((row) => [row.guid, row.status, row.sentiment, row.attempts]), [['a', 'relevant', 'positive', 1], ['c', 'relevant', 'positive', 1]]);
  assert.equal(client.asked.find((a) => a.companyName === 'Ukko').sectionName, 'Health (Healthcare & Biotechnology)');
  assert.ok(client.maxInFlight <= 2);
});

test('Ollama down: the articles go back unchanged (attempt undone) and the pass reports it', async (t) => {
  const { db } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'down 1' }, { companyId: 'harvey', guid: 'b', title: 'down 2' }]);
  const { classifier } = makeClassifier(db, makeFakeClient(byTitle));
  const pass = await classifier.runOnePass();
  assert.equal(pass.kind, 'ollama-down');
  assert.deepEqual(queueRows(db).map((row) => [row.status, row.attempts, row.claimed_at]), [['pending', 0, null], ['pending', 0, null]]);
});

test('an article with invalid answers fails for good after 3 attempts and then no longer blocks the run', async (t) => {
  const { db, dataDir } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'bad answer' }, { companyId: 'harvey', guid: 'b', title: 'Harvey wins' }]);
  const runId = addRun(db, { status: 'collected', companyIds: ['harvey'] });
  const { classifier } = makeClassifier(db, makeFakeClient(byTitle), { dataDir });
  await classifier.runOnePass();
  await classifier.runOnePass();
  await classifier.runOnePass();
  const failed = queueRows(db).find((row) => row.guid === 'a');
  assert.deepEqual([failed.status, failed.attempts], ['failed', 3]);

  const idle = await classifier.runOnePass(); // nothing claimable → finish the run
  assert.deepEqual(idle, { kind: 'idle', finished: true });
  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId);
  assert.equal(run.status, 'done');
  assert.deepEqual([run.classified_count, run.relevant_count, run.failed_count], [1, 1, 1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention').get().n, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'run.json'), 'utf8')).failedArticles.length, 1);
});

test('a run still being collected is not finished, and relevant rows below MOVE_CHUNK wait', async (t) => {
  const { db, dataDir } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'Harvey wins' }]);
  const runId = addRun(db, { status: 'running', ownerPid: 1 });
  const { classifier } = makeClassifier(db, makeFakeClient(byTitle), { dataDir });
  await classifier.runOnePass();
  assert.deepEqual(await classifier.runOnePass(), { kind: 'idle', finished: false });
  assert.equal(db.prepare('SELECT status FROM JobRun WHERE id = ?').get(runId).status, 'running');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention').get().n, 0);
  assert.equal(fs.existsSync(dataDir), false);
});

test('relevant rows move to Mention as soon as a full chunk is waiting', async (t) => {
  const rows = Array.from({ length: 4 }, (_, index) => ({ companyId: 'harvey', guid: `g${index}`, title: `Harvey news ${index}` }));
  const { db } = setup(t, rows);
  const { classifier } = makeClassifier(db, makeFakeClient(byTitle), { moveChunk: 3 });
  await classifier.runOnePass();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention').get().n, 3);
  assert.equal(queueRows(db).length, 1);
});

test('two classifier processes never get the same article', async (t) => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ companyId: 'harvey', guid: `g${index}`, title: `Harvey ${index}` }));
  const { db } = setup(t, rows);
  const a = claimBatch(db, { limit: 6, pid: 1, now: new Date(NOW).toISOString() });
  const b = claimBatch(db, { limit: 6, pid: 2, now: new Date(NOW).toISOString() });
  const idsA = new Set(a.map((row) => row.id));
  assert.equal(b.filter((row) => idsA.has(row.id)).length, 0);
  assert.equal(a.length + b.length, 10);
});

test('runForever waits with growing backoff while Ollama is unreachable, then works', async (t) => {
  const { db } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'Harvey wins' }]);
  let checks = 0;
  const client = makeFakeClient(byTitle);
  client.checkReady = async () => { checks += 1; if (checks < 4) throw new Error('down'); return { version: 'fake' }; };
  const { classifier, waits } = makeClassifier(db, client);
  let passes = 0;
  const run = classifier.runForever();
  // Stop once the article has been classified.
  while (queueRows(db)[0].status !== 'relevant' && passes++ < 1000) await new Promise((resolve) => setImmediate(resolve));
  classifier.stop();
  await run;
  assert.deepEqual(waits.slice(0, 3), [2000, 5000, 10000]);
  assert.equal(queueRows(db)[0].status, 'relevant');
});

test('stop request: articles in progress go back with the attempt undone, emergency heartbeat if a run is held, exit 143', (t) => {
  const { db } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'A' }]);
  const runId = addRun(db, { status: 'collected', ownerPid: 4242 });
  claimBatch(db, { limit: 5, pid: 4242, now: new Date(NOW).toISOString() });
  const proc = new EventEmitter();
  const exits = [];
  const classifier = { stop() { this.stopped = true; }, state: { heldRunId: runId } };
  installStopHandlers({ db, classifier, pid: 4242, log: () => {}, exit: (code) => exits.push(code), proc });
  proc.emit('SIGTERM');
  proc.emit('SIGINT'); // a second signal is ignored
  assert.deepEqual(exits, [143]);
  assert.equal(classifier.stopped, true);
  assert.deepEqual(queueRows(db).map((row) => [row.attempts, row.claimed_by_pid]), [[0, null]]);
  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId);
  assert.equal(run.owner_pid, null);
  assert.match(run.last_error, /SIGTERM/);
  assert.equal(run.status, 'collected');
});

test('crash: articles in progress go back but the attempt still counts (poison rule), exit 1', (t) => {
  const { db } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'A' }]);
  claimBatch(db, { limit: 5, pid: 4242, now: new Date(NOW).toISOString() });
  const proc = new EventEmitter();
  const exits = [];
  installStopHandlers({ db, classifier: { stop() {}, state: { heldRunId: null } }, pid: 4242, log: () => {}, exit: (code) => exits.push(code), proc });
  proc.emit('uncaughtException', new Error('boom'));
  assert.deepEqual(exits, [1]);
  assert.deepEqual(queueRows(db).map((row) => [row.attempts, row.claimed_by_pid]), [[1, null]]);
});

test('Ctrl+C exits with 130', (t) => {
  const { db } = setup(t, []);
  const proc = new EventEmitter();
  const exits = [];
  installStopHandlers({ db, classifier: { stop() {}, state: { heldRunId: null } }, pid: 4242, log: () => {}, exit: (code) => exits.push(code), proc });
  proc.emit('SIGINT');
  assert.deepEqual(exits, [130]);
});

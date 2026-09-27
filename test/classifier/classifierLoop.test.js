// classifierLoop.test.js — the classifier loop end to end with a fake Ollama (classifierLoop.js)
// and the stop/crash clean-up (stopHandlers.js): the poison-article rule across crashes (D59),
// suspect rows asked one at a time (D78), a single failed request while Ollama runs (D75), the
// wait after a failed pass, database errors that are not "busy" (D76), cleaned log lines, and two
// database connections claiming from the same file. Offline, temporary SQLite + data folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { makeTempDb } from '../helpers.js';
import { addCompanies, addQueueRows, addRun, makeFakeClient, makeLogger, queueRows, SECTION_NAMES, writeCompanyList } from './classifierHelpers.js';
import { createClassifier } from '../../src/classifier/classifierLoop.js';
import { installStopHandlers } from '../../src/classifier/stopHandlers.js';
import { claimBatch } from '../../src/classifier/queueStore.js';
import { config } from '../../src/config.js';

const NOW = Date.parse('2026-09-27T10:00:00.000Z');

// A temp database with Harvey and Ukko, the given queue rows, and a company list file with both
// names (the data/ export only includes listed companies, D79).
function setup(t, rows) {
  const { db, dir, openOther } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey', section: 1 }, { id: 'ukko', name: 'Ukko', section: 2 }]);
  const ids = addQueueRows(db, rows);
  const companyListFile = writeCompanyList(dir, ['Harvey', 'Ukko']);
  return { db, ids, openOther, dataDir: path.join(dir, 'data'), companyListFile };
}

// Waits (without real time passing) until `condition()` is true, or fails after many turns.
async function waitUntil(condition) {
  for (let turn = 0; turn < 10000; turn += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition never became true');
}

function makeClassifier(db, client, extra = {}) {
  const logger = makeLogger();
  const waits = [];
  const classifier = createClassifier({
    db, client, sectionNames: SECTION_NAMES, pid: 4242, concurrency: 2, claimBatchSize: 4, moveChunk: 1000, companyListFile: null,
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
  const { db, dataDir, companyListFile } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'bad answer' }, { companyId: 'harvey', guid: 'b', title: 'Harvey wins' }]);
  const runId = addRun(db, { status: 'collected', companyIds: ['harvey'] });
  const { classifier } = makeClassifier(db, makeFakeClient(byTitle), { dataDir, companyListFile });
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

test('two database connections (like two classifier processes) claiming in turns never get the same article', async (t) => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ companyId: 'harvey', guid: `g${index}`, title: `Harvey ${index}` }));
  const { db, openOther } = setup(t, rows);
  const other = openOther(); // a second, separate connection to the same file
  const nowText = new Date(NOW).toISOString();
  const claimed = [];
  for (let turn = 0; turn < 4; turn += 1) {
    claimed.push(...claimBatch(db, { limit: 2, pid: 1, now: nowText }).map((row) => ['a', row.id]));
    claimed.push(...claimBatch(other, { limit: 2, pid: 2, now: nowText }).map((row) => ['b', row.id]));
  }
  const ids = claimed.map(([, id]) => id);
  assert.equal(ids.length, 10, 'every article claimed');
  assert.equal(new Set(ids).size, 10, 'no article claimed twice');
  // Each connection sees the other's claims: pid 1 and 2 both hold rows, as recorded in the file.
  const owners = db.prepare('SELECT claimed_by_pid AS pid, COUNT(*) AS n FROM BufferQueue GROUP BY claimed_by_pid ORDER BY pid').all();
  assert.deepEqual(owners.map((row) => [row.pid, row.n]), [[1, claimed.filter(([who]) => who === 'a').length], [2, claimed.filter(([who]) => who === 'b').length]]);
});

test('poison article end to end: it crashes the classifier 3 times, ends failed for good, the other articles pass one at a time, and the run finishes (D59, D78)', async (t) => {
  const { db, dataDir, companyListFile } = setup(t, [
    { companyId: 'harvey', guid: 'poison', title: 'poison headline' },
    { companyId: 'harvey', guid: 'g1', title: 'Harvey one' },
    { companyId: 'ukko', guid: 'g2', title: 'Ukko two' },
    { companyId: 'harvey', guid: 'g3', title: 'Harvey three' },
  ]);
  const runId = addRun(db, { status: 'collected', companyIds: ['harvey', 'ukko'] });
  const pids = [5001, 5002, 5003, 5004];
  let livePid = null;
  const isAlive = (pid) => pid === livePid;

  // Starts one classifier "process". `crash` = what the poison headline does to it:
  // 'handler' = an uncaught error (the crash handler runs), 'kill' = a hard kill (nothing runs).
  function startProcess(pid, crash) {
    livePid = pid;
    const proc = new EventEmitter();
    const exits = [];
    const client = makeFakeClient((article) => {
      if (!article.title.startsWith('poison') || crash === null) return { relevant: true, sentiment: 'positive' };
      return () => {
        if (crash === 'handler') proc.emit('uncaughtException', new Error('native crash in the model runner'));
        return new Promise(() => {}); // this "process" never gets further
      };
    });
    const { classifier } = makeClassifier(db, client, { pid, isAlive, dataDir, companyListFile });
    installStopHandlers({ db, classifier, pid, log: () => {}, exit: (code) => exits.push(code), proc });
    return { classifier, client, exits };
  }

  // Process 1: takes the whole batch of 4 and crashes on the poison article (crash handler).
  const first = startProcess(pids[0], 'handler');
  first.classifier.runOnePass();
  await waitUntil(() => first.exits.length === 1);
  assert.deepEqual(first.exits, [1]);
  assert.deepEqual(queueRows(db).map((row) => [row.guid, row.attempts, row.suspect, row.claimed_at]), [
    ['poison', 1, 1, null], ['g1', 1, 1, null], ['g2', 1, 1, null], ['g3', 1, 1, null],
  ]);

  // Process 2: takes ONLY the oldest suspect row (the poison) and is killed hard (no clean-up).
  const second = startProcess(pids[1], 'kill');
  second.classifier.runOnePass();
  await waitUntil(() => second.client.asked.length === 1);
  assert.equal(queueRows(db)[0].claimed_by_pid, pids[1]);

  // Process 3: releases the dead worker's claim (attempt kept), takes the poison alone again, crashes.
  const third = startProcess(pids[2], 'handler');
  third.classifier.runOnePass();
  await waitUntil(() => third.exits.length === 1);
  const poison = queueRows(db).find((row) => row.guid === 'poison');
  assert.deepEqual([poison.status, poison.attempts, poison.claimed_at], ['failed', 3, null]);
  assert.deepEqual(queueRows(db).filter((row) => row.guid !== 'poison').map((row) => row.attempts), [1, 1, 1], 'the innocent articles lost only one attempt');

  // Process 4 (healthy): the three suspects pass one at a time, then the run finishes.
  const fourth = startProcess(pids[3], null);
  const passes = [];
  for (let pass = 0; pass < 6 && !passes.some((p) => p.finished); pass += 1) passes.push(await fourth.classifier.runOnePass());
  assert.deepEqual(passes.map((p) => p.kind), ['worked', 'worked', 'worked', 'idle']);
  assert.deepEqual(fourth.client.asked.map((a) => a.title), ['Harvey one', 'Ukko two', 'Harvey three'], 'never the poison again');
  assert.equal(passes[3].finished, true);

  const run = db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId);
  assert.equal(run.status, 'done');
  assert.deepEqual([run.classified_count, run.relevant_count, run.failed_count], [3, 3, 1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention').get().n, 3);
  const runFile = JSON.parse(fs.readFileSync(path.join(dataDir, 'run.json'), 'utf8'));
  assert.deepEqual(runFile.failedArticles.map((a) => [a.guid, a.attempts]), [['poison', 3]]);
});

test('one request that times out while Ollama is running counts as a failed attempt for that article only (D75)', async (t) => {
  const { db, dataDir, companyListFile } = setup(t, [{ companyId: 'harvey', guid: 'slow', title: 'slow headline' }, { companyId: 'harvey', guid: 'b', title: 'Harvey wins' }]);
  const runId = addRun(db, { status: 'collected', companyIds: ['harvey'] });
  const client = makeFakeClient((article) => (article.title.startsWith('slow') ? 'timeout' : { relevant: true, sentiment: 'positive' }));
  const { classifier, logger } = makeClassifier(db, client, { dataDir, companyListFile });

  const kinds = [];
  for (let pass = 0; pass < 3; pass += 1) kinds.push((await classifier.runOnePass()).kind);
  assert.deepEqual(kinds, ['worked', 'worked', 'worked'], 'not treated as "Ollama down"');
  assert.equal(client.reachableChecks, 3, 'each failed request is followed by the quick version check');
  const slow = queueRows(db).find((row) => row.guid === 'slow');
  assert.deepEqual([slow.status, slow.attempts], ['failed', 3]);
  assert.ok(logger.lines.warn.some((line) => /failed while Ollama is running, attempt 3\/3/.test(line)));

  assert.deepEqual(await classifier.runOnePass(), { kind: 'idle', finished: true });
  assert.equal(db.prepare('SELECT status FROM JobRun WHERE id = ?').get(runId).status, 'done');
});

test('a pass that fails for a reason other than Ollama waits with its own backoff and says so without mentioning Ollama', async (t) => {
  const { db, dataDir, companyListFile } = setup(t, []);
  const runId = addRun(db, { status: 'collected', companyIds: ['harvey'] });
  let renames = 0;
  const rename = (from, to) => {
    renames += 1;
    if (renames <= 2) throw Object.assign(new Error('EPERM: file is open in another program'), { code: 'EPERM' });
    fs.renameSync(from, to);
  };
  const { classifier, waits, logger } = makeClassifier(db, makeFakeClient(byTitle), {
    dataDir, companyListFile, exportWriteOptions: { rename, tries: 1 },
  });
  const run = classifier.runForever();
  await waitUntil(() => db.prepare('SELECT status FROM JobRun WHERE id = ?').get(runId).status === 'done');
  classifier.stop();
  await run;
  assert.deepEqual(waits.slice(0, 2), config.PASS_ERROR_BACKOFF_MS.slice(0, 2));
  const failures = logger.lines.warn.filter((line) => line.startsWith('Classifier pass failed'));
  assert.equal(failures.length, 2);
  assert.ok(failures.every((line) => !/ollama/i.test(line)));
  assert.equal(classifier.state.ollamaRetryIndex, 0, 'the Ollama backoff was not touched');
});

test('a database error that is not "busy" is not retried: the loop throws it so the service crashes and is restarted (D76)', async (t) => {
  const { db } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'Harvey wins' }]);
  // An answer the database refuses (sentiment outside the allowed values): a permanent error.
  const { classifier, waits } = makeClassifier(db, makeFakeClient(() => ({ relevant: true, sentiment: 'amazing' })));
  await assert.rejects(classifier.runForever(), /CHECK constraint failed/);
  assert.deepEqual(waits, [], 'no retry wait');
});

test('headlines in log lines have control characters removed and are cut to 150 characters', async (t) => {
  const evilTitle = `bad \u001b[2J\u001b[Hcleared${'x'.repeat(300)}`;
  const { db } = setup(t, [{ companyId: 'harvey', guid: 'a', title: evilTitle }]);
  const { classifier, logger } = makeClassifier(db, makeFakeClient(byTitle));
  await classifier.runOnePass();
  const line = logger.lines.warn.find((text) => text.startsWith('Invalid AI answer'));
  assert.ok(line);
  assert.equal(/[\u0000-\u001f\u007f-\u009f]/.test(line), false);
  assert.match(line, /"bad \[2J\[Hclearedx+…"/);
  assert.ok(line.length < 300);
  assert.equal(queueRows(db)[0].title, evilTitle, 'the stored title is unchanged');
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

// ---------- Log file and system log (D92, D93) ----------

// A log file that keeps its lines in memory.
function memoryFile() {
  const lines = [];
  return { lines, write: (text) => lines.push(text) };
}

test('D93: the log file gets the lines and warnings, but not the per-pass "Moved N" line; a finished run sends one system-log line', async (t) => {
  const rows = Array.from({ length: 3 }, (_, index) => ({ companyId: 'harvey', guid: `g${index}`, title: `Harvey news ${index}` }));
  rows.push({ companyId: 'harvey', guid: 'bad', title: 'bad answer' });
  const { db, dataDir, companyListFile } = setup(t, rows);
  const runId = addRun(db, { status: 'collected', companyIds: ['harvey'] });
  const file = memoryFile();
  const events = [];
  const { classifier, logger } = makeClassifier(db, makeFakeClient(byTitle), {
    moveChunk: 2, dataDir, companyListFile, logFile: file, event: (text) => events.push(text),
  });
  for (let pass = 0; pass < 10; pass += 1) {
    const result = await classifier.runOnePass();
    if (result.kind === 'idle' && result.finished) break;
  }
  assert.ok(logger.lines.log.some((line) => /^Moved 2 relevant articles to Mention\.$/.test(line)), 'still on the terminal');
  assert.ok(!file.lines.some((line) => /^Moved \d/.test(line)), 'not in the file');
  assert.ok(file.lines.some((line) => /^WARNING: Invalid AI answer for "bad answer"/.test(line)));
  assert.ok(file.lines.some((line) => new RegExp(`^Run ${runId} is done: `).test(line)));
  assert.deepEqual(events, [`Run ${runId} done, data/ written: 3 mentions`]);
});

test('D93: Ollama events: one "not ready" line per outage and one "back after" line; "ready" once on a normal start', async (t) => {
  const { db } = setup(t, [{ companyId: 'harvey', guid: 'a', title: 'Harvey wins' }]);
  let checks = 0;
  const client = makeFakeClient(byTitle);
  client.checkReady = async () => { checks += 1; if (checks < 3) throw new Error('Ollama is not reachable at http://fake (ECONNREFUSED)'); return { version: 'fake' }; };
  let clock = NOW;
  const events = [];
  const { classifier } = makeClassifier(db, client, {
    now: () => clock,
    sleep: async (ms) => { clock += ms; await new Promise((resolve) => setImmediate(resolve)); },
    event: (text) => events.push(text),
  });
  const run = classifier.runForever();
  while (queueRows(db)[0].status !== 'relevant') await new Promise((resolve) => setImmediate(resolve));
  classifier.stop();
  await run;
  assert.deepEqual(events, [
    'Ollama not ready (Ollama is not reachable at http://fake (ECONNREFUSED)) → classifier retrying',
    'Ollama back after 7 s (fake-model)', // waited 2 s + 5 s
  ]);

  const { db: db2 } = setup(t, []);
  const readyEvents = [];
  const second = makeClassifier(db2, makeFakeClient(byTitle), { event: (text) => readyEvents.push(text) });
  assert.equal(await second.classifier.checkOllama(), true);
  assert.equal(await second.classifier.checkOllama(), true);
  assert.deepEqual(readyEvents, ['Ollama ready (fake-model)']);
});

test('D93: the speed line is on the terminal every 30 s but in the log file only every 10 min', async (t) => {
  const { db } = setup(t, []);
  let clock = NOW;
  const file = memoryFile();
  const { classifier, logger } = makeClassifier(db, makeFakeClient(byTitle), {
    now: () => clock,
    sleep: async () => { clock += 60_000; await new Promise((resolve) => setImmediate(resolve)); }, // each idle wait = 1 min
    logFile: file,
    event: () => { throw new Error('a broken event sender never stops the classifier'); },
  });
  const run = classifier.runForever();
  const speedLines = (lines) => lines.filter((line) => line.startsWith('classifier · '));
  while (speedLines(logger.lines.log).length < 25) await new Promise((resolve) => setImmediate(resolve));
  classifier.stop();
  await run;
  const onTerminal = speedLines(logger.lines.log).length;
  const inFile = speedLines(file.lines).length;
  assert.ok(onTerminal >= 25);
  assert.ok(inFile >= 2 && inFile <= Math.ceil(onTerminal / 10) + 1, `${inFile} speed lines in the file for ${onTerminal} on the terminal`);
});

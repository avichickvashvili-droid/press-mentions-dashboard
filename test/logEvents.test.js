// logEvents.test.js — tests of the pieces behind the log files (D92) and the system log,
// orchestrator.log (D93): the duration text, the "one line when it starts, one when it ends"
// trackers of a group process, the messages a service sends to the orchestrator, the progress
// display's log file (lean: no progress line), the latest-run folder, and the orchestrator's
// log file and folder keeper. Offline; temporary folders and databases only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { describeDuration } from '../src/shared/text.js';
import { companyFailedEvent, createGoogleStreak, createQueueWaitEvents } from '../src/collector/groupEvents.js';
import { sendEvent, sendToSupervisor } from '../src/supervisor/serviceLink.js';
import { createProgress } from '../src/collector/progress.js';
import { createLogFile } from '../src/shared/logFile.js';
import { latestRunFolder, settleLogFolder } from '../src/shared/runLogs.js';
import { createSystemLog } from '../src/supervisor/systemLog.js';
import { createOrchestratorLog } from '../src/supervisor/logging.js';
import { makeTempDb, makeTempDir } from './helpers.js';

// A fixed local time for the log lines: 27 Sep 2026, 14:03:11.482.
const FIXED = () => new Date(2026, 8, 27, 14, 3, 11, 482);

// A writable stream that keeps what it gets.
function capture() {
  let text = '';
  return { write: (piece) => { text += piece; return true; }, text: () => text, isTTY: false };
}

// A log file that keeps its lines in memory (no disk), with a settable folder.
function memoryLogFile() {
  const lines = [];
  let folder = null;
  return {
    lines,
    write: (text) => lines.push(text),
    setFolder: (name) => { folder = name; },
    folder: () => folder,
  };
}

// Adds a JobRun row with the given id.
function addRun(db, id) {
  db.prepare("INSERT INTO JobRun (id, started_at, status, last_heartbeat) VALUES (?, '2026-09-27T08:00:00.000Z', 'done', '2026-09-27T08:00:00.000Z')").run(id);
}

test('describeDuration: seconds, minutes and seconds, hours and minutes', () => {
  assert.equal(describeDuration(0), '0 s');
  assert.equal(describeDuration(12_400), '12 s');
  assert.equal(describeDuration(72_000), '1 min 12 s');
  assert.equal(describeDuration(420_000), '7 min');
  assert.equal(describeDuration(7_500_000), '2 h 5 min');
  assert.equal(describeDuration(-5), '0 s');
});

test('Google streak: one line when the problems start, one when Google answers again; none without problems', () => {
  const lines = [];
  let clock = 0;
  const streak = createGoogleStreak({ event: (text) => lines.push(text), now: () => clock });
  streak.ok();
  assert.deepEqual(lines, []);
  streak.retry({ reason: 'Google is busy or limiting us (HTTP 429)', companyName: 'Harvey' });
  clock = 60_000;
  streak.retry({ reason: 'Google is busy or limiting us (HTTP 429)', companyName: 'Harvey' });
  streak.retry({ reason: 'Google unreachable (ENOTFOUND)', companyName: 'Acme' });
  clock = 420_000;
  streak.ok();
  streak.ok();
  assert.deepEqual(lines, [
    'Google problems started: Google is busy or limiting us (HTTP 429) at Harvey; retrying',
    'Google OK again after 7 min (3 retries)',
  ]);
  streak.retry({ reason: 'Google did not answer within 30 s' });
  streak.ok();
  assert.deepEqual(lines.slice(2), ['Google problems started: Google did not answer within 30 s; retrying', 'Google OK again after 0 s (1 retry)']);
});

test('queue waits: one line when the queue is full, one when it has room again', () => {
  const lines = [];
  let clock = 0;
  const queue = createQueueWaitEvents({ event: (text) => lines.push(text), now: () => clock });
  queue.resumed(100); // no wait going on: nothing
  queue.waiting(10000);
  queue.waiting(10000);
  clock = 720_000;
  queue.resumed(8000);
  assert.deepEqual(lines, [
    `Queue full (${Number(config.CAP).toLocaleString('en-US')}): collector waiting for the LLM`,
    'Queue has room again (8,000): collector resumed after 12 min',
  ]);
  assert.equal(companyFailedEvent('Acme Bio', 'Google rejected the search (HTTP 400), 3 tries 1 min apart'),
    'Company Acme Bio failed: Google rejected the search (HTTP 400), 3 tries 1 min apart');
});

test('sendEvent / sendToSupervisor: sent over the channel when there is one; nothing (and no error) when running alone', () => {
  const sent = [];
  const connected = { connected: true, send: (message, callback) => { sent.push(message); callback?.(); } };
  assert.equal(sendEvent('Run 1 started', { proc: connected }), true);
  assert.equal(sendToSupervisor({ type: 'run', runId: 1 }, { proc: connected }), true);
  assert.deepEqual(sent, [{ type: 'event', text: 'Run 1 started' }, { type: 'run', runId: 1 }]);
  assert.equal(sendEvent('x', { proc: { connected: false, send: () => {} } }), false);
  assert.equal(sendEvent('x', { proc: {} }), false, 'no channel: running alone');
  assert.equal(sendEvent('x', { proc: { connected: true, send: () => { throw new Error('closed'); } } }), false);
});

test('progress display with a log file: messages, warnings and errors go to the file; the progress line never does; record() is file only', () => {
  const out = capture();
  const err = capture();
  const file = memoryLogFile();
  const progress = createProgress({ out, err, logFile: file });
  progress.update({ groupNumber: 1, groupTotal: 3, companyNumber: 1, companyTotal: 2, companyName: 'Alpha', phase: 'fetching' });
  progress.info('Started run 1 (3 groups).');
  progress.warn('Google error for Alpha: HTTP 429');
  progress.error('Alpha: Google rejected the search');
  progress.record('Company 1/2 Alpha: finished · 1 window · 2 new, 0 duplicates · 3 s');
  assert.deepEqual(file.lines, [
    'Started run 1 (3 groups).',
    'WARNING: Google error for Alpha: HTTP 429',
    'ERROR: Alpha: Google rejected the search',
    'Company 1/2 Alpha: finished · 1 window · 2 new, 0 duplicates · 3 s',
  ]);
  assert.doesNotMatch(out.text() + err.text(), /Company 1\/2 Alpha: finished/, 'record() is not on the terminal');
  assert.match(out.text(), /group 1\/3 · company 1\/2 · Alpha · fetching/, 'the terminal is as before');
  // A broken log file never stops the display.
  const broken = createProgress({ out, err, logFile: { write: () => { throw new Error('disk full'); } } });
  assert.doesNotThrow(() => { broken.info('x'); broken.record('y'); });
});

test('latestRunFolder: the highest JobRun id; no-run when there is no run or no database; null when it cannot be read', (t) => {
  const { db, dbPath, dir } = makeTempDb(t);
  assert.equal(latestRunFolder({ db }), config.LOG_NO_RUN_FOLDER);
  addRun(db, 3);
  addRun(db, 4);
  assert.equal(latestRunFolder({ db }), 'run-4');
  assert.equal(latestRunFolder({ dbPath }), 'run-4', 'read-only open of the file');
  assert.equal(latestRunFolder({ dbPath: path.join(dir, 'missing.sqlite') }), config.LOG_NO_RUN_FOLDER);
  assert.equal(latestRunFolder({ db: { prepare: () => { throw new Error('locked'); } } }), null);

  const file = memoryLogFile();
  settleLogFolder(file, { db });
  assert.equal(file.folder(), 'run-4');
  settleLogFolder(file, { dbPath: path.join(dir, 'missing.sqlite') });
  assert.equal(file.folder(), 'run-4', 'a folder that is already known is kept');
  const unreadable = memoryLogFile();
  settleLogFolder(unreadable, { db: { prepare: () => { throw new Error('locked'); } } });
  assert.equal(unreadable.folder(), config.LOG_NO_RUN_FOLDER);
});

test('orchestrator logger with a log file: its own lines go to the file without label or clock; event() goes to the file only', () => {
  const out = capture();
  const err = capture();
  const file = memoryLogFile();
  const log = createOrchestratorLog({ out, err, now: () => new Date(2026, 8, 27, 10, 15, 3), file });
  log.info('Starting collector.');
  log.error('classifier gave up');
  log.event('Group 2 done (26/26 finished) → starting group 3 of 10 (companies 53–78)');
  assert.deepEqual(file.lines, [
    'Starting collector.',
    'ERROR: classifier gave up',
    'Group 2 done (26/26 finished) → starting group 3 of 10 (companies 53–78)',
  ]);
  assert.equal(out.text(), '[orchestrator] 10:15:03 Starting collector.\n', 'the terminal is as before; events are not on it');
  assert.equal(err.text(), '[orchestrator] 10:15:03 ERROR: classifier gave up\n');
  const noFile = createOrchestratorLog({ out, err });
  assert.doesNotThrow(() => noFile.event('nowhere'));
});

test('system log folder: held until the collector names its run; events are written; settle() uses the latest run or no-run', (t) => {
  const logsDir = makeTempDir(t);
  const logFile = createLogFile('orchestrator.log', { logsDir, now: FIXED });
  const log = createOrchestratorLog({ out: capture(), err: capture(), file: logFile });
  const systemLog = createSystemLog({ logFile, log, findLatestFolder: () => 'run-1' });
  log.info('Orchestrator started.');
  systemLog.onServiceMessage({ type: 'event', text: 'Run 2 started: 6 companies in 3 groups' });
  assert.equal(fs.readdirSync(logsDir).length, 0, 'held: the run is not known yet');
  for (const bad of [null, 'text', { type: 'run', runId: 'x' }, { type: 'run', runId: 0 }, { type: 'event', text: 5 }, { type: 'other' }]) {
    systemLog.onServiceMessage(bad);
  }
  systemLog.onServiceMessage({ type: 'run', runId: 2 });
  systemLog.settle(); // already known: nothing changes
  log.info('collector finished normally');
  const text = fs.readFileSync(path.join(logsDir, 'run-2', 'orchestrator.log'), 'utf8');
  assert.equal(text, [
    '2026-09-27 14:03:11.482 Orchestrator started.',
    '2026-09-27 14:03:11.482 Run 2 started: 6 companies in 3 groups',
    '2026-09-27 14:03:11.482 collector finished normally',
    '',
  ].join('\n'));

  const other = memoryLogFile();
  createSystemLog({ logFile: other, log, findLatestFolder: () => 'run-7' }).settle();
  assert.equal(other.folder(), 'run-7');
  const none = memoryLogFile();
  createSystemLog({ logFile: none, log, findLatestFolder: () => null }).settle();
  assert.equal(none.folder(), config.LOG_NO_RUN_FOLDER);
  const throwing = memoryLogFile();
  createSystemLog({ logFile: throwing, log, findLatestFolder: () => { throw new Error('db'); } }).settle();
  assert.equal(throwing.folder(), config.LOG_NO_RUN_FOLDER);
});

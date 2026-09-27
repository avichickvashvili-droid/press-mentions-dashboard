// logFile.test.js — tests for the log file writer (src/shared/logFile.js, D92).
//
// Each test writes into a temporary logs folder (deleted after the test) with a fixed clock.
// No real logs folder is touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from './helpers.js';
import { createLogFile, formatLogTime, runFolderName } from '../src/shared/logFile.js';

// A fixed local time: 27 Sep 2026, 14:03:11.482.
const FIXED = new Date(2026, 8, 27, 14, 3, 11, 482);

// Collects what would be written to the terminal.
function fakeTerminal() {
  const written = [];
  return { write: (text) => { written.push(text); return true; }, written };
}

test('formatLogTime gives the local date and time with milliseconds', () => {
  assert.equal(formatLogTime(FIXED), '2026-09-27 14:03:11.482');
  assert.equal(formatLogTime(new Date(2026, 0, 2, 3, 4, 5, 6)), '2026-01-02 03:04:05.006');
});

test('runFolderName gives run-<id>', () => {
  assert.equal(runFolderName(7), 'run-7');
});

test('lines get the date and time and go to logs/<folder>/<file>', (t) => {
  const logsDir = makeTempDir(t);
  const log = createLogFile('collector.log', { logsDir, now: () => FIXED });
  log.setFolder(runFolderName(3));
  log.write('Started run 3 (10 groups).');
  log.write('two\nlines\n');
  const file = path.join(logsDir, 'run-3', 'collector.log');
  assert.equal(log.filePath(), file);
  assert.equal(fs.readFileSync(file, 'utf8'),
    '2026-09-27 14:03:11.482 Started run 3 (10 groups).\n2026-09-27 14:03:11.482 two\n2026-09-27 14:03:11.482 lines\n');
});

test('lines are held until the folder is known, then written with the time they were written', (t) => {
  const logsDir = makeTempDir(t);
  let clock = new Date(2026, 8, 27, 9, 0, 0, 0);
  const log = createLogFile('orchestrator.log', { logsDir, now: () => clock });
  log.write('early line');
  assert.equal(log.folder(), null);
  assert.equal(log.filePath(), null);
  assert.equal(fs.readdirSync(logsDir).length, 0, 'nothing written yet');
  clock = new Date(2026, 8, 27, 9, 0, 5, 0);
  log.setFolder('run-1');
  log.write('later line');
  assert.equal(fs.readFileSync(path.join(logsDir, 'run-1', 'orchestrator.log'), 'utf8'),
    '2026-09-27 09:00:00.000 early line\n2026-09-27 09:00:05.000 later line\n');
});

test('only the last held lines are kept, with a note about the dropped ones', (t) => {
  const logsDir = makeTempDir(t);
  const log = createLogFile('collector.log', { logsDir, now: () => FIXED, heldLinesMax: 2 });
  for (const text of ['a', 'b', 'c', 'd']) log.write(text);
  log.setFolder('no-run');
  const lines = fs.readFileSync(path.join(logsDir, 'no-run', 'collector.log'), 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /2 earlier line\(s\) were dropped/);
  assert.deepEqual(lines.slice(1), ['2026-09-27 14:03:11.482 c', '2026-09-27 14:03:11.482 d']);
});

test('the folder can change: later lines go to the new folder', (t) => {
  const logsDir = makeTempDir(t);
  const log = createLogFile('classifier.log', { logsDir, now: () => FIXED });
  log.setFolder('run-1');
  log.write('in run 1');
  log.setFolder('run-2');
  log.write('in run 2');
  assert.match(fs.readFileSync(path.join(logsDir, 'run-1', 'classifier.log'), 'utf8'), /in run 1\n$/);
  assert.match(fs.readFileSync(path.join(logsDir, 'run-2', 'classifier.log'), 'utf8'), /^[^\n]*in run 2\n$/);
});

test('a folder removed while running is created again on the next line', (t) => {
  const logsDir = makeTempDir(t);
  const log = createLogFile('group-2.log', { logsDir, now: () => FIXED });
  log.setFolder('run-1');
  log.write('one');
  fs.rmSync(path.join(logsDir, 'run-1'), { recursive: true, force: true });
  log.write('two');
  assert.equal(fs.readFileSync(path.join(logsDir, 'run-1', 'group-2.log'), 'utf8'), '2026-09-27 14:03:11.482 two\n');
});

test('terminal escape codes, control characters and empty lines are left out', (t) => {
  const logsDir = makeTempDir(t);
  const log = createLogFile('group-1.log', { logsDir, now: () => FIXED });
  log.setFolder('run-1');
  log.write('\r\x1b[Kgroup 1/10 · company 2/26\u0007\tok  ');
  log.write('');
  log.write('\n\n');
  assert.equal(fs.readFileSync(path.join(logsDir, 'run-1', 'group-1.log'), 'utf8'),
    '2026-09-27 14:03:11.482 group 1/10 · company 2/26\tok\n');
});

test('a failed write warns once on the terminal and never throws', (t) => {
  const logsDir = makeTempDir(t);
  const terminal = fakeTerminal();
  let calls = 0;
  const brokenFs = {
    mkdirSync: () => {},
    appendFileSync: () => { calls += 1; throw new Error('disk full'); },
  };
  const log = createLogFile('collector.log', { logsDir, now: () => FIXED, warnOut: terminal, fileSystem: brokenFs });
  log.setFolder('run-1');
  assert.doesNotThrow(() => log.write('one'));
  assert.doesNotThrow(() => log.write('two'));
  assert.equal(calls, 2, 'later lines are still tried');
  assert.equal(terminal.written.length, 1);
  assert.match(terminal.written[0], /^WARNING: the log file collector\.log could not be written \(disk full\)/);
});

test('a broken terminal and a broken clock do not throw either', (t) => {
  const logsDir = makeTempDir(t);
  const brokenTerminal = { write: () => { throw new Error('gone'); } };
  const brokenFs = { mkdirSync: () => { throw new Error('no access'); }, appendFileSync: () => {} };
  const log = createLogFile('x.log', { logsDir, now: () => { throw new Error('clock'); }, warnOut: brokenTerminal, fileSystem: brokenFs });
  assert.doesNotThrow(() => { log.write('held'); log.setFolder('run-1'); log.write('line'); });
});

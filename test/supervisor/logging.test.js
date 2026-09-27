// logging.test.js — tests the output labels: service output is cut into whole lines, and the
// orchestrator's own lines carry "[orchestrator]" and the time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineSplitter, createOrchestratorLog } from '../../src/supervisor/logging.js';
import { createCaptureStream } from './testTools.js';

test('pieces are joined into whole lines; Windows line ends are removed; the rest is flushed', () => {
  const lines = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  splitter.push(Buffer.from('one\ntw'));
  splitter.push(Buffer.from('o\r\nthr'));
  assert.deepEqual(lines, ['one', 'two']);
  splitter.flush();
  assert.deepEqual(lines, ['one', 'two', 'thr']);
});

test('a character split across two pieces is not broken', () => {
  const lines = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  const bytes = Buffer.from('café\n');
  splitter.push(bytes.subarray(0, 4)); // cuts the "é" in half
  splitter.push(bytes.subarray(4));
  assert.deepEqual(lines, ['café']);
});

test('orchestrator lines are labelled, errors go to the error output', () => {
  const out = createCaptureStream();
  const err = createCaptureStream();
  const log = createOrchestratorLog({ out, err, now: () => new Date(2026, 8, 27, 10, 15, 3) });
  log.info('classifier crashed (exit 1), restart #2 in 5 s');
  log.error('gave up');
  assert.equal(out.text(), '[orchestrator] 10:15:03 classifier crashed (exit 1), restart #2 in 5 s\n');
  assert.equal(err.text(), '[orchestrator] 10:15:03 ERROR: gave up\n');
});

test('a broken terminal never crashes the logger', () => {
  const broken = { write() { throw new Error('EPIPE'); } };
  const log = createOrchestratorLog({ out: broken, err: broken });
  assert.doesNotThrow(() => { log.info('x'); log.error('y'); });
});

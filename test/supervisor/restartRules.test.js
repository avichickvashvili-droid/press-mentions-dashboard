// restartRules.test.js — tests the orchestrator's pure rules: what an exit code means, the
// growing waits, and when to give up (D68, D69). No processes, no timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyExit, describeExit, formatWait, isStopCode, recordCrash, restartWait, tooManyCrashes,
} from '../../src/supervisor/restartRules.js';
import { config } from '../../src/config.js';

test('exit codes are sorted as agreed (D68)', () => {
  assert.equal(classifyExit({ code: 0, policy: 'once', stopAsked: false }), 'finished');
  assert.equal(classifyExit({ code: 0, policy: 'always', stopAsked: false }), 'crash', 'always-on service ending is unexpected');
  assert.equal(classifyExit({ code: 3, policy: 'once', stopAsked: false }), 'refused');
  assert.equal(classifyExit({ code: 3, policy: 'always', stopAsked: false }), 'refused');
  assert.equal(classifyExit({ code: 1, policy: 'once', stopAsked: false }), 'crash');
  assert.equal(classifyExit({ code: 130, policy: 'always', stopAsked: false }), 'crash', 'Ctrl+C code nobody asked for');
  assert.equal(classifyExit({ code: 143, policy: 'once', stopAsked: false }), 'crash', 'stop code nobody asked for');
  assert.equal(classifyExit({ code: null, policy: 'once', stopAsked: false }), 'crash', 'killed by the system');
  assert.equal(classifyExit({ code: 143, policy: 'always', stopAsked: true }), 'stopped');
  assert.equal(classifyExit({ code: 1, policy: 'always', stopAsked: true }), 'stopped', 'nothing is restarted while stopping');
});

test('only 130 and 143 are stop codes', () => {
  assert.equal(isStopCode(130), true);
  assert.equal(isStopCode(143), true);
  assert.equal(isStopCode(1), false);
  assert.equal(isStopCode(null), false);
});

test('restart waits are 1, 2, 5, 10, 30, 60 s, then 60 s again (D69)', () => {
  const steps = config.RESTART_BACKOFF_MS;
  const waits = [0, 1, 2, 3, 4, 5, 6, 20].map((index) => restartWait(index, steps));
  assert.deepEqual(waits, [1000, 2000, 5000, 10000, 30000, 60000, 60000, 60000]);
});

test('give up only on MORE than 5 crashes within 10 minutes (D69)', () => {
  const window = config.CRASH_WINDOW_MS;
  let crashes = [];
  for (let i = 0; i < 5; i += 1) crashes = recordCrash(crashes, i * 1000, window);
  assert.equal(tooManyCrashes(crashes, config.MAX_CRASHES), false, '5 crashes: keep trying');
  crashes = recordCrash(crashes, 6000, window);
  assert.equal(tooManyCrashes(crashes, config.MAX_CRASHES), true, '6th crash: give up');
});

test('crashes older than the window are forgotten', () => {
  const window = 10 * 60 * 1000;
  let crashes = [];
  for (let i = 0; i < 5; i += 1) crashes = recordCrash(crashes, i, window);
  crashes = recordCrash(crashes, window + 100, window);
  assert.deepEqual(crashes, [window + 100]);
});

test('exits and waits are described in plain words', () => {
  assert.equal(describeExit({ code: 1, signal: null }), 'exit 1');
  assert.equal(describeExit({ code: null, signal: 'SIGKILL' }), 'killed by SIGKILL');
  assert.equal(describeExit({ code: null, signal: null, error: new Error('spawn ENOENT') }), 'could not start: spawn ENOENT');
  assert.equal(formatWait(5000), '5 s');
  assert.equal(formatWait(60000), '1 min');
});

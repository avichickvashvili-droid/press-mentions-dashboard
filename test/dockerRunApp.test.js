// dockerRunApp.test.js — the Docker app container's starter (src/docker/runApp.js, D116): the
// dashboard starts, the daily job once the dashboard answers; when one ends the other is asked to
// stop and the container exits with the first one's code (so Docker restarts both); a stop request
// reaches both; a program that won't stop is killed after the grace time; a program that can't
// start stops the rest. Fake child processes and a fake "dashboard answers" check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { APP_PROGRAMS, runPrograms, waitForDashboard } from '../src/docker/runApp.js';

// Lets waiting promises and timers of 0 ms run.
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A fake child process: remembers the signals it got; `endsOn` = the signals that end it.
function fakeChild(name, { endsOn = ['SIGTERM', 'SIGKILL'] } = {}) {
  const child = new EventEmitter();
  child.name = name;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (endsOn.includes(signal)) setImmediate(() => child.emit('exit', null, signal));
    return true;
  };
  return child;
}

// Starts runPrograms with fakes (the daily job waits for `waitForReady`, by default it answers at
// once); returns the children by name and the handle.
async function start(options = {}) {
  const children = {};
  const lines = [];
  const handle = runPrograms({
    programs: [{ name: 'dashboard', entry: 'a.js' }, { name: 'daily', entry: 'b.js', waitForReady: true }],
    spawnImpl: (exe, [entry]) => {
      const name = entry === 'a.js' ? 'dashboard' : 'daily';
      children[name] = fakeChild(name, options.childOptions?.[name]);
      return children[name];
    },
    log: (text) => lines.push(text),
    graceMs: 50,
    waitForReady: async () => true,
    ...options.run,
  });
  await tick();
  return { children, lines, handle };
}

test('the container runs the dashboard and, after it, the daily job', () => {
  assert.deepEqual(APP_PROGRAMS.map((p) => p.entry), ['src/api/runApi.js', 'src/daily/runDaily.js']);
  assert.deepEqual(APP_PROGRAMS.map((p) => Boolean(p.waitForReady)), [false, true]);
});

test('the daily job starts only after the dashboard answers', async () => {
  let answer;
  const { children, handle } = await start({ run: { waitForReady: () => new Promise((resolve) => { answer = resolve; }) } });
  assert.ok(children.dashboard);
  assert.equal(children.daily, undefined, 'not yet');
  answer(true);
  await tick();
  assert.ok(children.daily, 'started once the dashboard answered');
  handle.stop();
  assert.equal(await handle.done, 143);
});

test('a stop before the dashboard answers: the daily job is never started', async () => {
  let answer;
  const { children, handle } = await start({ run: { waitForReady: () => new Promise((resolve) => { answer = resolve; }) } });
  handle.stop();
  answer(false);
  await handle.done;
  await tick();
  assert.equal(children.daily, undefined);
});

test('no answer in time: the daily job starts anyway, with a note', async () => {
  const { children, lines, handle } = await start({ run: { waitForReady: async () => false } });
  assert.ok(children.daily);
  assert.ok(lines.some((line) => /did not answer in time/.test(line)));
  handle.stop();
  await handle.done;
});

test('one program crashes: the other is asked to stop and the container exits with the crash code', async () => {
  const { children, lines, handle } = await start();
  children.daily.emit('exit', 1, null);
  assert.equal(await handle.done, 1);
  assert.deepEqual(children.dashboard.signals, ['SIGTERM']);
  assert.match(lines[0], /daily ended \(exit 1\)/);
});

test('a stop request reaches both; the code is the stop code (143)', async () => {
  const { children, handle } = await start();
  handle.stop();
  assert.equal(await handle.done, 143);
  assert.deepEqual(children.dashboard.signals, ['SIGTERM']);
  assert.deepEqual(children.daily.signals, ['SIGTERM']);
});

test('a program that does not stop is killed after the grace time', async () => {
  const { children, lines, handle } = await start({ childOptions: { daily: { endsOn: ['SIGKILL'] } } });
  handle.stop();
  await handle.done;
  assert.deepEqual(children.daily.signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(lines.some((line) => /daily did not stop/.test(line)));
});

test('a program that cannot start: the other is stopped and the code is "crashed"', async () => {
  const { children, handle } = await start();
  children.dashboard.emit('error', new Error('spawn failed'));
  assert.equal(await handle.done, 1);
  assert.deepEqual(children.daily.signals, ['SIGTERM']);
});

test('waitForDashboard: true once the list loads, false after the time limit', async () => {
  let calls = 0;
  const upOnThird = async () => { calls += 1; if (calls < 3) throw new Error('refused'); return { ok: true }; };
  assert.equal(await waitForDashboard({ fetchImpl: upOnThird, checkMs: 1, timeoutMs: 1000 }), true);
  assert.equal(calls, 3);
  assert.equal(await waitForDashboard({ fetchImpl: async () => ({ ok: false }), checkMs: 1, timeoutMs: 20 }), false);
});

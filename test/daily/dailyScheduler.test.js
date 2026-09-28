// dailyScheduler.test.js — WHEN a daily run starts (src/daily/dailyScheduler.js, D102, Prompt 272):
// the 03:00 schedule, a missed run at start-up, the hourly missed-run check (a computer asleep at
// 03:00), retries after "blocked" and "failed", a database error inside a timer, and never two
// runs at once. Offline: a fake cron, fake timers and a fake clock.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyScheduler } from '../../src/daily/dailyScheduler.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-29T00:00:00.000Z');

// Builds a scheduler with fakes. `results` = what each runOnce call returns, in order.
function setup({ results = [{ status: 'done' }], lastDone = null } = {}) {
  const state = { lastDone, now: NOW, runs: [], timers: [], lines: [], scheduled: null, readError: null };
  const cronLib = {
    validate: (expression) => expression === '0 3 * * *',
    schedule: (expression, fn, options) => { state.scheduled = { expression, fn, options }; return { stop: () => { state.scheduled.stopped = true; } }; },
  };
  const scheduler = createDailyScheduler({
    runOnce: async (reason) => {
      state.runs.push(reason);
      const result = results[Math.min(state.runs.length - 1, results.length - 1)];
      if (result.status === 'done') state.lastDone = new Date(state.now).toISOString();
      return result;
    },
    readLastDoneStartedAt: () => { if (state.readError) throw state.readError; return state.lastDone; },
    now: () => state.now,
    cronLib,
    cronExpression: '0 3 * * *',
    timeZone: 'Asia/Jerusalem',
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; state.timers.push(timer); return timer; },
    clearTimer: (timer) => { timer.cleared = true; },
    log: (text) => state.lines.push(text),
    missedAfterMs: 24 * HOUR,
    missedCheckMs: HOUR,
    blockedRetryMs: 15 * 60 * 1000,
    failedRetryMs: 30 * 60 * 1000,
    failedRetries: 3,
  });
  // The retry timers that are still waiting (the hourly missed-run check is left out).
  state.waitingRetries = () => state.timers.filter((t) => !t.cleared && !t.fired && t.ms !== HOUR);
  // Fires the newest retry timer that is still waiting.
  state.fireTimer = async () => {
    const timer = state.waitingRetries().at(-1);
    timer.fired = true;
    await timer.fn();
  };
  // Fires the waiting hourly missed-run check.
  state.fireCheck = async () => {
    const timer = state.timers.filter((t) => !t.cleared && !t.fired && t.ms === HOUR).at(-1);
    timer.fired = true;
    await timer.fn();
  };
  return { scheduler, state };
}

test('the schedule: 03:00 every day in Israel time', async () => {
  const { scheduler, state } = setup({ lastDone: new Date(NOW - HOUR).toISOString() });
  assert.equal(scheduler.start(), null); // a recent run: nothing missed
  assert.equal(state.scheduled.expression, '0 3 * * *');
  assert.deepEqual(state.scheduled.options, { timezone: 'Asia/Jerusalem' });
  await state.scheduled.fn();
  assert.deepEqual(state.runs, ['scheduled']);
});

test('start-up with no daily run yet: runs right away', async () => {
  const { scheduler, state } = setup();
  await scheduler.start();
  assert.deepEqual(state.runs, ['missed']);
});

test('start-up when the last run is more than a day old (the computer was off): runs right away', async () => {
  const { scheduler, state } = setup({ lastDone: new Date(NOW - 25 * HOUR).toISOString() });
  await scheduler.start();
  assert.deepEqual(state.runs, ['missed']);
});

test('blocked (the 90-day collection is going on): tried again in 15 min until it runs', async () => {
  const { scheduler, state } = setup({ results: [{ status: 'blocked', reason: 'busy' }, { status: 'blocked', reason: 'busy' }, { status: 'done' }] });
  await scheduler.start();
  assert.equal(state.timers.at(-1).ms, 15 * 60 * 1000);
  await state.fireTimer();
  await state.fireTimer();
  assert.deepEqual(state.runs, ['missed', 'retry', 'retry']);
  assert.equal(state.waitingRetries().length, 0); // done: no more retries
});

test('failed: tried again every 30 min, at most 3 times, then waits for the next 03:00', async () => {
  const { scheduler, state } = setup({ results: [{ status: 'failed', error: 'boom' }] });
  await scheduler.start();
  for (let i = 0; i < 3; i += 1) {
    assert.equal(state.timers.at(-1).ms, 30 * 60 * 1000);
    await state.fireTimer();
  }
  assert.deepEqual(state.runs, ['missed', 'retry', 'retry', 'retry']);
  assert.equal(state.waitingRetries().length, 0);
  assert.ok(state.lines.some((line) => /failed 4 times in a row; the next try is the next scheduled run/.test(line)));
  // The next 03:00 starts a fresh count.
  await state.scheduled.fn();
  assert.equal(state.runs.at(-1), 'scheduled');
  assert.equal(state.waitingRetries().length, 1);
});

test('a retry is dropped when a successful run has started since', async () => {
  const { scheduler, state } = setup({ results: [{ status: 'blocked', reason: 'busy' }, { status: 'done' }] });
  await scheduler.start();
  state.now += 60 * 1000;
  state.lastDone = new Date(state.now).toISOString(); // e.g. the 03:00 run succeeded meanwhile
  await state.fireTimer();
  assert.deepEqual(state.runs, ['missed']);
});

test('only one run at a time: a start while a run is going on is skipped', async () => {
  let finish;
  const { state } = setup();
  const scheduler = createDailyScheduler({
    runOnce: (reason) => { state.runs.push(reason); return new Promise((resolve) => { finish = resolve; }); },
    readLastDoneStartedAt: () => null,
    cronLib: { validate: () => true, schedule: () => ({ stop() {} }) },
    log: (text) => state.lines.push(text),
    setTimer: () => ({}),
    clearTimer: () => {},
  });
  const first = scheduler.trigger('scheduled');
  assert.equal(scheduler.isBusy(), true);
  assert.equal(await scheduler.trigger('scheduled'), null);
  assert.match(state.lines.at(-1), /still going on/);
  finish({ status: 'done' });
  await first;
  assert.equal(scheduler.isBusy(), false);
  assert.deepEqual(state.runs, ['scheduled']);
});

test('a run that throws counts as failed (the scheduler keeps going)', async () => {
  const { state } = setup();
  const scheduler = createDailyScheduler({
    runOnce: async () => { throw new Error('unexpected'); },
    readLastDoneStartedAt: () => null,
    cronLib: { validate: () => true, schedule: () => ({ stop() {} }) },
    log: (text) => state.lines.push(text),
    setTimer: (fn, ms) => { state.timers.push({ fn, ms }); return {}; },
    clearTimer: () => {},
  });
  const result = await scheduler.trigger('scheduled');
  assert.deepEqual(result, { status: 'failed', error: 'unexpected' });
  assert.equal(state.timers.filter((timer) => timer.ms === 30 * 60 * 1000).length, 1); // one retry (the other timer is the 3 h watch)
});

test('an invalid cron time is refused at start', () => {
  const scheduler = createDailyScheduler({
    runOnce: async () => ({ status: 'done' }),
    readLastDoneStartedAt: () => null,
    cronExpression: 'not a time',
    cronLib: { validate: () => false, schedule: () => ({ stop() {} }) },
  });
  assert.throws(() => scheduler.start(), /DAILY_CRON "not a time" is not a valid cron time/);
});

test('stop: the schedule and a planned retry are stopped', async () => {
  const { scheduler, state } = setup({ results: [{ status: 'blocked', reason: 'busy' }] });
  await scheduler.start();
  scheduler.stop();
  assert.equal(state.scheduled.stopped, true);
  assert.equal(state.timers.at(-1).cleared, true);
  assert.ok(state.timers.filter((t) => t.ms === HOUR).every((t) => t.cleared)); // the hourly check too
});

test('asleep at 03:00: the hourly check runs the missed run after the computer wakes up', async () => {
  const { scheduler, state } = setup({ lastDone: new Date(NOW - HOUR).toISOString() });
  assert.equal(scheduler.start(), null);
  await state.fireCheck(); // an hour later: the last run is recent, nothing to do
  assert.deepEqual(state.runs, []);
  state.now += 26 * HOUR; // asleep over 03:00: node-cron skipped the start
  await state.fireCheck();
  assert.deepEqual(state.runs, ['missed']);
  assert.match(state.lines.at(-1), /more than 24 h ago .*asleep.*running now/);
  await state.fireCheck(); // the run is done now: no second run
  assert.deepEqual(state.runs, ['missed']);
});

test('the hourly check never starts a run while a retry is planned, or after the retries gave up', async () => {
  const blocked = setup({ results: [{ status: 'blocked', reason: 'busy' }] });
  await blocked.scheduler.start();
  blocked.state.now += 2 * HOUR;
  await blocked.state.fireCheck();
  assert.deepEqual(blocked.state.runs, ['missed']); // the planned retry does it

  const failing = setup({ results: [{ status: 'failed', error: 'boom' }] });
  await failing.scheduler.start();
  for (let i = 0; i < 3; i += 1) await failing.state.fireTimer();
  assert.equal(failing.state.runs.length, 4);
  await failing.state.fireCheck();
  assert.equal(failing.state.runs.length, 4); // gave up: waits for the next 03:00
  await failing.state.scheduled.fn();
  assert.equal(failing.state.runs.at(-1), 'scheduled');
});

test('a database error in a timer is logged and the timer is planned again (no crash)', async () => {
  const { scheduler, state } = setup({ results: [{ status: 'blocked', reason: 'busy' }, { status: 'done' }] });
  await scheduler.start();
  state.readError = new Error('database is locked');
  await state.fireTimer(); // the retry can't read the database
  assert.match(state.lines.at(-1), /retry could not read the database \(database is locked\)\. Trying again in 15 min/);
  assert.equal(state.waitingRetries().length, 1);
  state.readError = null;
  await state.fireTimer();
  assert.deepEqual(state.runs, ['missed', 'retry']);

  state.readError = new Error('disk I/O error');
  await state.fireCheck(); // the hourly check can't read it either
  assert.match(state.lines.at(-1), /missed-run check could not read the database \(disk I\/O error\)/);
  assert.equal(state.timers.filter((t) => !t.cleared && !t.fired && t.ms === HOUR).length, 1);
});

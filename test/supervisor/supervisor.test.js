// supervisor.test.js — tests the orchestrator's core with fake processes and a fake clock:
// restart with growing waits, give up after repeated crashes, exit codes 0 / 3 / 130 / 143,
// the start checks, and the clean stop (D66–D70). Nothing real is started and nothing waits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupervisor } from '../../src/supervisor/supervisor.js';
import { supervisorConfig } from '../../src/supervisor/supervisorConfig.js';
import { createFakeClock, createFakeLauncher, createFakeLog } from './testTools.js';

const COLLECTOR = { name: 'collector', entry: 'collector.js', npmScript: 'collect', policy: 'once' };
const CLASSIFIER = { name: 'classifier', entry: 'classifier.js', npmScript: 'classifier', policy: 'always' };

// Builds an orchestrator with fakes; returns everything a test needs to drive and check it.
async function setUp({ services = [COLLECTOR, CLASSIFIER], entryExists = () => true } = {}) {
  const clock = createFakeClock();
  const launcher = createFakeLauncher();
  const log = createFakeLog();
  const finished = [];
  const supervisor = createSupervisor({
    services,
    startProcess: launcher.startProcess,
    log,
    clock,
    entryExists,
    onFinished: (code) => finished.push(code),
  });
  await supervisor.start();
  return { clock, launcher, log, finished, supervisor };
}

test('starts every service as its own process', async () => {
  const { launcher, supervisor } = await setUp();
  assert.deepEqual(launcher.started.map((s) => s.service), ['collector', 'classifier']);
  assert.deepEqual(supervisor.statuses(), { collector: 'running', classifier: 'running' });
});

test('collector exit 0 = finished, not restarted; the classifier keeps running (D68, Q8e)', async () => {
  const { clock, launcher, log, supervisor, finished } = await setUp();
  launcher.latest('collector').end(0);
  clock.advance(10 * 60 * 1000);
  assert.equal(launcher.started.length, 2, 'nothing restarted');
  assert.deepEqual(supervisor.statuses(), { collector: 'finished', classifier: 'running' });
  assert.match(log.text(), /collector finished normally \(exit 0\)/);
  assert.deepEqual(finished, [], 'orchestrator keeps running for the classifier');
});

test('exit 3 = refused, nothing wrong: logged, not restarted (D68)', async () => {
  const { clock, launcher, log, supervisor } = await setUp();
  launcher.latest('collector').end(3);
  clock.advance(60000);
  assert.equal(supervisor.statuses().collector, 'refused');
  assert.equal(launcher.started.length, 2);
  assert.match(log.text(), /collector did not start: it refused, nothing is wrong \(exit 3/);
  assert.doesNotMatch(log.text(), /ERROR/);
});

test('a crash is restarted after 1 s, 2 s, 5 s ... and every restart is logged (D69)', async () => {
  const { clock, launcher, log } = await setUp();
  const expectedWaits = [1000, 2000, 5000, 10000];
  for (const [index, wait] of expectedWaits.entries()) {
    const before = launcher.started.length;
    launcher.latest('classifier').end(1);
    assert.equal(launcher.started.length, before, 'not restarted at once');
    clock.advance(wait - 1);
    assert.equal(launcher.started.length, before, 'not restarted before the wait is over');
    clock.advance(1);
    assert.equal(launcher.started.length, before + 1, `restart #${index + 1} after ${wait} ms`);
  }
  assert.match(log.text(), /INFO classifier crashed \(exit 1\), restart #1 in 1 s/);
  assert.match(log.text(), /INFO classifier crashed \(exit 1\), restart #2 in 2 s/);
  assert.match(log.text(), /INFO classifier crashed \(exit 1\), restart #3 in 5 s/);
  assert.match(log.text(), /INFO classifier crashed \(exit 1\), restart #4 in 10 s/);
});

test('the wait goes back to 1 s after the service stayed up 5 minutes', async () => {
  const { clock, launcher, log } = await setUp();
  launcher.latest('classifier').end(1);
  clock.advance(1000);
  launcher.latest('classifier').end(1);
  clock.advance(2000);
  clock.advance(supervisorConfig.STABLE_UPTIME_MS); // healthy for 5 minutes
  launcher.latest('classifier').end(1);
  assert.match(log.lines.at(-1), /restart #3 in 1 s/);
});

test('always-on service ending with 0 is unexpected = a crash, restarted (Q3c)', async () => {
  const { clock, launcher, log } = await setUp();
  launcher.latest('classifier').end(0);
  assert.match(log.text(), /classifier crashed \(exit 0\), restart #1 in 1 s/);
  clock.advance(1000);
  assert.equal(launcher.started.filter((s) => s.service === 'classifier').length, 2);
});

test('130 / 143 nobody asked for = a crash, judged after a short grace (D68)', async () => {
  const { clock, launcher, log, supervisor } = await setUp();
  launcher.latest('classifier').end(143);
  assert.equal(supervisor.statuses().classifier, 'ending');
  clock.advance(supervisorConfig.STOP_SIGNAL_GRACE_MS);
  assert.match(log.text(), /classifier crashed \(exit 143\), restart #1/);
});

test('130 followed by our own Ctrl+C within the grace = a normal stop, no restart line', async () => {
  const { clock, launcher, log, supervisor, finished } = await setUp();
  launcher.latest('classifier').end(130); // Windows told the service first
  supervisor.stop(130); // ...then the orchestrator
  launcher.latest('collector').end(143);
  clock.advance(60000);
  assert.doesNotMatch(log.text(), /crashed/);
  assert.deepEqual(supervisor.statuses(), { collector: 'stopped', classifier: 'stopped' });
  assert.deepEqual(finished, [130]);
});

test('more than 5 crashes in 10 minutes: gives up on that service only, with a clear error (I18)', async () => {
  const { clock, launcher, log, supervisor } = await setUp();
  for (let crash = 1; crash <= 5; crash += 1) {
    launcher.latest('classifier').end(1);
    clock.advance(60000);
  }
  assert.equal(launcher.started.filter((s) => s.service === 'classifier').length, 6);
  launcher.latest('classifier').end(1); // the 6th crash within 10 minutes
  clock.advance(10 * 60 * 1000);
  assert.equal(launcher.started.filter((s) => s.service === 'classifier').length, 6, 'no more restarts');
  assert.equal(supervisor.statuses().classifier, 'gave-up');
  assert.equal(supervisor.statuses().collector, 'running', 'the other service keeps running');
  const text = log.text();
  assert.match(text, /ERROR classifier crashed 6 times within 10 minutes \(last: exit 1\)\. It is NOT restarted any more/);
  assert.match(text, /ERROR {3}Error: boom/, 'shows its last error lines');
  assert.match(text, /npm run classifier/);
});

test('ends by itself when nothing is left: 1 if a service was given up, 0 if all finished (Q3d)', async () => {
  const onlyCollector = await setUp({ services: [COLLECTOR] });
  onlyCollector.launcher.latest('collector').end(0);
  assert.deepEqual(onlyCollector.finished, [0]);

  const gaveUp = await setUp({ services: [COLLECTOR] });
  for (let crash = 1; crash <= 6; crash += 1) {
    gaveUp.launcher.latest('collector').end(1);
    gaveUp.clock.advance(60000);
  }
  assert.deepEqual(gaveUp.finished, [1]);
});

test('a missing service file is reported once and not started; the others run', async () => {
  const { launcher, log, supervisor } = await setUp({ entryExists: (entry) => entry !== 'classifier.js' });
  assert.deepEqual(launcher.started.map((s) => s.service), ['collector']);
  assert.equal(supervisor.statuses().classifier, 'missing');
  assert.match(log.text(), /ERROR classifier cannot start: its file classifier\.js does not exist/);
});

test('start check says no: the service is skipped and the reason is logged (D67)', async () => {
  const collector = { ...COLLECTOR, checkBeforeStart: () => ({ start: false, reason: 'Last collection finished at X.' }) };
  const { launcher, log, supervisor } = await setUp({ services: [collector, CLASSIFIER] });
  assert.deepEqual(launcher.started.map((s) => s.service), ['classifier']);
  assert.equal(supervisor.statuses().collector, 'skipped');
  assert.match(log.text(), /INFO collector: Last collection finished at X\./);
});

test('start check fails: the service is not started (safe choice) and the error is logged', async () => {
  const collector = { ...COLLECTOR, checkBeforeStart: () => { throw new Error('database is locked'); } };
  const { launcher, log, supervisor } = await setUp({ services: [collector, CLASSIFIER] });
  assert.deepEqual(launcher.started.map((s) => s.service), ['classifier']);
  assert.equal(supervisor.statuses().collector, 'skipped');
  assert.match(log.text(), /ERROR collector is not started: the start check failed \(database is locked\)/);
});

test('stop: every running service is asked to stop, waiting restarts are cancelled (D70)', async () => {
  const { clock, launcher, log, supervisor, finished } = await setUp();
  launcher.latest('collector').end(1); // waiting 1 s to restart
  supervisor.stop(130);
  assert.equal(launcher.latest('classifier').stopRequests, 1);
  clock.advance(60000 * 5);
  assert.equal(launcher.started.filter((s) => s.service === 'collector').length, 1, 'no restart after stop');
  // (the classifier's stop is still pending here; the 10 s force-kill already fired)
  assert.match(log.text(), /collector was waiting to restart; it is not restarted/);
  launcher.latest('classifier').end(null, 'SIGKILL');
  assert.deepEqual(finished, [130]);
});

test('stop: a service that ends within 10 s is not force-killed', async () => {
  const { clock, launcher, log, finished, supervisor } = await setUp();
  supervisor.stop(130);
  clock.advance(3000);
  launcher.latest('collector').end(143);
  launcher.latest('classifier').end(143);
  clock.advance(60000);
  assert.equal(launcher.latest('collector').killed, false);
  assert.equal(launcher.latest('classifier').killed, false);
  assert.doesNotMatch(log.text(), /forced kill/);
  assert.deepEqual(finished, [130]);
});

test('stop: a service still running after 10 s is force-killed, and the log says what that means', async () => {
  const { clock, launcher, log, supervisor } = await setUp();
  supervisor.stop(130);
  launcher.latest('collector').end(143);
  clock.advance(supervisorConfig.STOP_TIMEOUT_MS - 1);
  assert.equal(launcher.latest('classifier').killed, false);
  clock.advance(1);
  assert.equal(launcher.latest('classifier').killed, true);
  assert.match(log.text(), /ERROR classifier: forced kill \(still running after 10 s\), no emergency heartbeat written; the owner_pid check will release the run\./);
});

test('second Ctrl+C: force-kills at once', async () => {
  const { launcher, log, supervisor } = await setUp();
  supervisor.stop(130);
  supervisor.forceStop();
  assert.equal(launcher.latest('collector').killed, true);
  assert.equal(launcher.latest('classifier').killed, true);
  assert.match(log.text(), /forced kill \(second Ctrl\+C\)/);
});

test('a stop before a service was started keeps it from starting', async () => {
  const clock = createFakeClock();
  const launcher = createFakeLauncher();
  let supervisor;
  const collector = {
    ...COLLECTOR,
    checkBeforeStart: () => { supervisor.stop(130); return { start: true, reason: 'resume' }; },
  };
  supervisor = createSupervisor({
    services: [collector, CLASSIFIER], startProcess: launcher.startProcess, log: createFakeLog(), clock, entryExists: () => true,
  });
  await supervisor.start();
  assert.equal(launcher.started.length, 0);
  assert.deepEqual(supervisor.statuses(), { collector: 'stopped', classifier: 'stopped' });
});

// groupRunner.test.js — tests of the group runner (src/collector/groupRunner.js, D83, D84, D86,
// D90) with FAKE group processes: each fake is a small script the test writes (mark companies
// done in the database, send "still alive", exit with a code, or hang until it is killed).
// Checks: order and one-at-a-time, the crash count (progress resets it, 5 in a row = failed),
// restart waits, the stuck check, exit 3, Ctrl+C / stop codes, stopping, and the end log.
// Offline, temporary SQLite files, real timers with tiny waits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { LostOwnershipError, acquireRun } from '../src/collector/jobLock.js';
import {
  GroupRefusedError, buildCollectionDoneEvent, buildEndLog, createGroupRunner, describeGroupProgress, findNextGroup, formatGroupNumbers,
} from '../src/collector/groupRunner.js';
import { finishCollection } from '../src/collector/companyLoop.js';
import { TEST_NOW, makeTempDb } from './helpers.js';

const RUNNER_PID = 1;

// Tiny waits so the tests run fast; the real values are checked through `clock.asked`.
const SETTINGS = {
  ...config,
  GROUP_RESTART_WAITS_MS: [1, 2, 3, 4, 5],
  STOP_SIGNAL_GRACE_MS: 5,
  STOP_TIMEOUT_MS: 50,
  GROUP_STUCK_AFTER_MS: 60 * 60 * 1000, // tests that check "stuck" set their own value
};

// A real clock that remembers every wait asked for (restart waits, grace, stuck checks).
function makeRecordingClock() {
  const asked = [];
  return {
    asked,
    now: () => Date.now(),
    setTimeout: (callback, ms) => { asked.push(ms); return setTimeout(callback, ms); },
    clearTimeout: (timer) => clearTimeout(timer),
  };
}

// Adds `count` companies c1, c2, ... and starts a run owned by RUNNER_PID with groups of about
// `groupSize`. Returns the database and the run id.
function setUpRun(t, { count = 6, groupSize = 2 } = {}) {
  const { db } = makeTempDb(t);
  const ids = Array.from({ length: count }, (_, index) => `c${index + 1}`);
  for (const id of ids) db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES (?, ?, 1, 'q')").run(id, id.toUpperCase());
  const { runId } = acquireRun(db, ids, { now: TEST_NOW, pid: RUNNER_PID, groupSize });
  return { db, runId };
}

// Marks the next `count` not-yet-done companies of a group with `status` ('finished' or 'failed').
function markCompanies(db, runId, groupNumber, count = Infinity, status = 'finished') {
  const rows = db.prepare(`SELECT company_id FROM JobRunCompany WHERE run_id = ? AND group_number = ?
                           AND status NOT IN ('finished', 'failed') ORDER BY rowid`).all(runId, groupNumber);
  for (const row of rows.slice(0, count)) {
    db.prepare('UPDATE JobRunCompany SET status = ?, error = ? WHERE run_id = ? AND company_id = ?')
      .run(status, status === 'failed' ? 'Google rejected the search (HTTP 400), 3 tries 1 min apart' : null, runId, row.company_id);
  }
}

// A fake "start a group process". `script(ctx)` runs for every start and decides what the fake
// process does; ctx = { groupNumber, start (1, 2, ... for this group), exit(code, signal),
// send(message), onStop(callback), onKill(callback), setErrorLine(text) }.
// Records every start in `launcher.starts` and the most processes alive at once in `launcher.maxAlive`.
function makeLauncher(script) {
  const launcher = { starts: [], maxAlive: 0, alive: 0 };
  const startsPerGroup = new Map();
  launcher.startGroup = ({ groupNumber, runnerPid }) => {
    assert.equal(runnerPid, RUNNER_PID, 'the group process gets the runner\'s pid');
    const start = (startsPerGroup.get(groupNumber) ?? 0) + 1;
    startsPerGroup.set(groupNumber, start);
    launcher.starts.push(groupNumber);
    launcher.alive += 1;
    launcher.maxAlive = Math.max(launcher.maxAlive, launcher.alive);
    let exitCallback = null;
    let ended = false;
    let errorLine = null;
    const messageCallbacks = [];
    const stopCallbacks = [];
    const killCallbacks = [];
    const exit = (code, signal = null) => {
      if (ended) return;
      ended = true;
      launcher.alive -= 1;
      setImmediate(() => exitCallback?.({ code, signal }));
    };
    const handle = {
      pid: 5000 + launcher.starts.length,
      onMessage: (callback) => messageCallbacks.push(callback),
      onExit: (callback) => { exitCallback = callback; },
      requestStop: () => { for (const callback of stopCallbacks) callback(); return true; },
      forceKill: () => { for (const callback of killCallbacks) callback(); exit(null, 'SIGKILL'); },
      lastErrorLine: () => errorLine,
    };
    setImmediate(() => script({
      groupNumber, start, exit,
      send: (message) => { for (const callback of messageCallbacks) callback(message); },
      onStop: (callback) => stopCallbacks.push(callback),
      onKill: (callback) => killCallbacks.push(callback),
      setErrorLine: (text) => { errorLine = text; },
    }));
    return handle;
  };
  return launcher;
}

// Creates a runner over the test run, with the fake launcher, silent logs kept in `logs` and the
// system-log lines (D93) kept in `events`.
function makeRunner(db, runId, launcher, { settings = SETTINGS, clock = makeRecordingClock() } = {}) {
  const logs = [];
  const events = [];
  const runner = createGroupRunner({
    db, runId, pid: RUNNER_PID, startGroup: launcher.startGroup, clock, settings,
    log: (text) => logs.push(`INFO ${text}`), warn: (text) => logs.push(`WARN ${text}`), sleep: async () => {},
    event: (text) => events.push(text),
  });
  return { runner, logs, events, clock };
}

// The JobRunGroup rows as plain objects, by group number.
function groupRows(db, runId) {
  return db.prepare('SELECT * FROM JobRunGroup WHERE run_id = ? ORDER BY group_number').all(runId).map((row) => ({ ...row }));
}

test('formatGroupNumbers joins runs of numbers', () => {
  assert.equal(formatGroupNumbers([1, 3, 4, 5, 6, 7, 8, 9, 10]), '1, 3–10');
  assert.equal(formatGroupNumbers([2]), '2');
  assert.equal(formatGroupNumbers([5, 1, 2]), '1–2, 5');
  assert.equal(formatGroupNumbers([]), 'none');
});

test('the progress line says which group runs and which companies it has', (t) => {
  const { db, runId } = setUpRun(t, { count: 258, groupSize: 25 });
  markCompanies(db, runId, 2, 12);
  assert.equal(describeGroupProgress(db, runId, 2), 'Group 2 of 10 (companies 27–52): 12/26 done');
  assert.equal(describeGroupProgress(db, runId, 10), 'Group 10 of 10 (companies 234–258): 0/25 done');
});

test('groups run one after another, never two at once: an in_progress group first, then pending ones by number; complete/failed are skipped', async (t) => {
  const { db, runId } = setUpRun(t, { count: 8, groupSize: 2 }); // 4 groups of 2
  db.prepare("UPDATE JobRunGroup SET status = 'in_progress' WHERE run_id = ? AND group_number = 3").run(runId);
  db.prepare("UPDATE JobRunGroup SET status = 'complete' WHERE run_id = ? AND group_number = 1").run(runId);
  const launcher = makeLauncher(({ groupNumber, exit, send }) => {
    send({ type: 'alive', state: 'fetching' });
    markCompanies(db, runId, groupNumber);
    setTimeout(() => exit(0), 5);
  });
  const { runner } = makeRunner(db, runId, launcher);
  assert.equal(await runner.run(), 'done');
  assert.deepEqual(launcher.starts, [3, 2, 4]);
  assert.equal(launcher.maxAlive, 1, 'never two group processes at once');
  const rows = groupRows(db, runId);
  assert.ok(rows.every((row) => row.status === 'complete' && row.crashes_in_a_row === 0));
  assert.ok(rows.slice(1).every((row) => row.started_at && row.finished_at));
  assert.equal(findNextGroup(db, runId), undefined);
});

test('D84: a crash with no progress adds 1; after 5 in a row the group is failed and the next group runs; restart waits 1-2-5-10 s', async (t) => {
  const { db, runId } = setUpRun(t, { count: 4, groupSize: 2 }); // 2 groups
  const launcher = makeLauncher(({ groupNumber, exit, setErrorLine }) => {
    if (groupNumber === 1) {
      setErrorLine('ERROR: Group process crashed: Error: boom');
      exit(1);
    } else {
      markCompanies(db, runId, groupNumber);
      exit(0);
    }
  });
  const { runner, logs, clock } = makeRunner(db, runId, launcher, { settings: { ...SETTINGS, GROUP_RESTART_WAITS_MS: config.GROUP_RESTART_WAITS_MS.map((ms) => ms / 1000) } });
  assert.equal(await runner.run(), 'done');
  assert.deepEqual(launcher.starts, [1, 1, 1, 1, 1, 2]);
  const [group1, group2] = groupRows(db, runId);
  assert.deepEqual([group1.status, group1.crashes_in_a_row], ['failed', 5]);
  assert.ok(group1.finished_at);
  assert.equal(group1.last_error, 'exit 1: ERROR: Group process crashed: Error: boom');
  assert.equal(group2.status, 'complete');
  const restartWaits = clock.asked.filter((ms) => ms < 1000);
  assert.deepEqual(restartWaits, [1, 2, 5, 10], 'the waits of GROUP_RESTART_WAITS_MS (scaled down 1000x here), in order');
  assert.ok(logs.some((line) => /Group 1 FAILED: its process crashed 5 times in a row/.test(line) && /npm start -- --groups 1/.test(line)));
});

for (const doneStatus of ['finished', 'failed']) {
  test(`D84/D90: progress (a company ${doneStatus}) resets the count, so that crash counts as 1`, async (t) => {
    const { db, runId } = setUpRun(t, { count: 3, groupSize: 3 }); // 1 group of 3
    const countsBeforeStart = [];
    const launcher = makeLauncher(({ groupNumber, start, exit }) => {
      countsBeforeStart.push(groupRows(db, runId)[0].crashes_in_a_row);
      if (start === 5) markCompanies(db, runId, groupNumber, 1, doneStatus); // progress, then this crash
      if (start === 9) {
        markCompanies(db, runId, groupNumber);
        exit(0);
        return;
      }
      exit(1);
    });
    const { runner } = makeRunner(db, runId, launcher);
    assert.equal(await runner.run(), 'done');
    // Without the reset, the 5th crash would have failed the group. With it: 1..4, then 1..4 again.
    assert.deepEqual(countsBeforeStart, [0, 1, 2, 3, 4, 1, 2, 3, 4]);
    const [group] = groupRows(db, runId);
    assert.deepEqual([group.status, group.crashes_in_a_row], ['complete', 0]);
  });
}

test('D90: a group process that sends no "still alive" message for GROUP_STUCK_AFTER_MS is killed and counted as a crash', async (t) => {
  const { db, runId } = setUpRun(t, { count: 2, groupSize: 2 });
  const launcher = makeLauncher(({ groupNumber, start, exit, send }) => {
    if (start === 1) {
      // Works for a while (a message every 10 ms), then hangs without a word until it is killed.
      let sent = 0;
      const timer = setInterval(() => {
        send({ type: 'alive', state: sent % 2 ? 'waiting' : 'fetching' });
        sent += 1;
        if (sent === 5) clearInterval(timer);
      }, 10);
      return;
    }
    markCompanies(db, runId, groupNumber);
    exit(0);
  });
  const started = Date.now();
  const { runner, logs } = makeRunner(db, runId, launcher, { settings: { ...SETTINGS, GROUP_STUCK_AFTER_MS: 80 } });
  assert.equal(await runner.run(), 'done');
  assert.ok(Date.now() - started >= 80 + 40, 'the messages kept it alive past the first 80 ms');
  const [group] = groupRows(db, runId);
  assert.equal(group.status, 'complete');
  assert.match(group.last_error, /^stuck: no "still alive" signal for .*, killed$/);
  assert.ok(logs.some((line) => /Group 1: no "still alive" signal .* is killed/.test(line)));
  assert.deepEqual(launcher.starts, [1, 1]);
});

test('exit 3 from a group process: LostOwnershipError when another process owns the run, GroupRefusedError otherwise', async (t) => {
  const { db, runId } = setUpRun(t, { count: 2, groupSize: 2 });
  const refusing = makeLauncher(({ exit }) => exit(3));
  await assert.rejects(makeRunner(db, runId, refusing).runner.run(), GroupRefusedError);
  db.prepare('UPDATE JobRun SET owner_pid = 999 WHERE id = ?').run(runId);
  await assert.rejects(makeRunner(db, runId, makeLauncher(({ exit }) => exit(3))).runner.run(), LostOwnershipError);
});

test('a runner that does not own the run writes nothing and starts no group process (D71)', async (t) => {
  const { db, runId } = setUpRun(t, { count: 2, groupSize: 2 });
  db.prepare('UPDATE JobRun SET owner_pid = 999 WHERE id = ?').run(runId);
  const launcher = makeLauncher(({ exit }) => exit(0));
  await assert.rejects(makeRunner(db, runId, launcher).runner.run(), LostOwnershipError);
  assert.deepEqual(launcher.starts, []);
  assert.equal(groupRows(db, runId)[0].status, 'pending');
});

test('D90: exit 130/143 while the runner is NOT stopping is a crash (after the short Ctrl+C wait)', async (t) => {
  const { db, runId } = setUpRun(t, { count: 2, groupSize: 2 });
  const launcher = makeLauncher(({ groupNumber, start, exit }) => {
    if (start === 1) return exit(130);
    markCompanies(db, runId, groupNumber);
    return exit(0);
  });
  const { runner, clock } = makeRunner(db, runId, launcher);
  assert.equal(await runner.run(), 'done');
  assert.ok(clock.asked.includes(SETTINGS.STOP_SIGNAL_GRACE_MS));
  assert.equal(groupRows(db, runId)[0].last_error, 'exit 130');
});

test('stop: the group process is asked to stop; its 143 is a stop, not a crash; nothing is recorded; no new group starts', async (t) => {
  const { db, runId } = setUpRun(t, { count: 4, groupSize: 2 });
  let stopsAsked = 0;
  const launcher = makeLauncher(({ exit, onStop }) => {
    onStop(() => { stopsAsked += 1; exit(143); });
  });
  const { runner } = makeRunner(db, runId, launcher);
  const running = runner.run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await runner.stop();
  assert.equal(await running, 'stopped');
  assert.equal(stopsAsked, 1);
  assert.deepEqual(launcher.starts, [1]);
  const [group1, group2] = groupRows(db, runId);
  assert.deepEqual([group1.status, group1.crashes_in_a_row, group1.last_error], ['in_progress', 0, null]);
  assert.equal(group2.status, 'pending');
});

test('stop: a group process that ignores the stop request is force-killed after STOP_TIMEOUT_MS', async (t) => {
  const { db, runId } = setUpRun(t, { count: 2, groupSize: 2 });
  let killed = false;
  const launcher = makeLauncher(({ onKill }) => { onKill(() => { killed = true; }); });
  const { runner, logs } = makeRunner(db, runId, launcher);
  const running = runner.run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await runner.stop();
  assert.equal(await running, 'stopped');
  assert.equal(killed, true);
  assert.ok(logs.some((line) => /still running after .*; it is force-killed/.test(line)));
});

test('stop during a restart wait: the same group is not started again', async (t) => {
  const { db, runId } = setUpRun(t, { count: 2, groupSize: 2 });
  const launcher = makeLauncher(({ exit }) => exit(1));
  const { runner } = makeRunner(db, runId, launcher, { settings: { ...SETTINGS, GROUP_RESTART_WAITS_MS: [60 * 60 * 1000] } });
  const running = runner.run();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await runner.stop();
  assert.equal(await running, 'stopped');
  assert.deepEqual(launcher.starts, [1]);
});

test('D86: the end log lists complete and failed groups (with why) and the failed companies', async (t) => {
  const { db, runId } = setUpRun(t, { count: 6, groupSize: 2 }); // 3 groups
  const launcher = makeLauncher(({ groupNumber, start, exit, setErrorLine }) => {
    if (groupNumber === 2) {
      if (start === 1) markCompanies(db, runId, 2, 1, 'failed'); // C3 failed (Google 400), then it
      setErrorLine('ERROR: boom');                               // crashes, again and again
      exit(1);
      return;
    }
    markCompanies(db, runId, groupNumber);
    exit(0);
  });
  const { runner } = makeRunner(db, runId, launcher);
  assert.equal(await runner.run(), 'done');
  await finishCollection(db, runId, { pid: RUNNER_PID });
  const endLog = buildEndLog(db, runId);
  assert.match(endLog, /^Run \d+ collected\./);
  assert.match(endLog, /Companies: 4 finished, 1 failed \(of 6\)\./);
  assert.match(endLog, /Groups: complete 1, 3 · failed 2/);
  assert.match(endLog, /group 2: 1 of 2 companies not collected; last error: exit 1: ERROR: boom/);
  assert.match(endLog, /Companies failed: \[C3\]/);
  assert.match(endLog, /C3 — Google rejected the search \(HTTP 400\), 3 tries 1 min apart/);
  assert.equal(db.prepare('SELECT status FROM JobRun WHERE id = ?').get(runId).status, 'collected');
});

test('D93: the runner tells the system log the story of the run, and passes on the event lines of its group processes', async (t) => {
  const { db, runId } = setUpRun(t, { count: 6, groupSize: 2 }); // 3 groups
  const launcher = makeLauncher(({ groupNumber, start, exit, send, setErrorLine }) => {
    if (groupNumber === 2) {
      if (start === 1) markCompanies(db, runId, 2, 1, 'failed'); // progress first, then crashes
      setErrorLine('ERROR: boom');
      exit(1);
      return;
    }
    if (groupNumber === 3) send({ type: 'event', text: 'Queue full (10,000): collector waiting for the LLM' });
    send({ type: 'event', text: 42 }); // not text: ignored
    markCompanies(db, runId, groupNumber);
    exit(0);
  });
  const { runner, events } = makeRunner(db, runId, launcher);
  assert.equal(await runner.run(), 'done');
  const crashLines = events.filter((line) => line.startsWith('Group 2 crashed'));
  assert.equal(crashLines.length, 4, 'one line per restart, none for the 5th crash (the group fails)');
  assert.match(crashLines[0], /^Group 2 crashed \(exit 1: ERROR: boom\), 1 in a row → restarting in /);
  assert.deepEqual(events.filter((line) => !line.startsWith('Group 2 crashed')), [
    'Starting group 1 of 3 (companies 1–2)',
    'Group 1 done (2/2 finished) → starting group 2 of 3 (companies 3–4)',
    'Group 2 failed after 5 crashes in a row (last: exit 1: ERROR: boom), skipped → starting group 3 of 3 (companies 5–6)',
    'Queue full (10,000): collector waiting for the LLM',
    'Group 3 done (2/2 finished)',
  ]);
  await finishCollection(db, runId, { pid: RUNNER_PID });
  assert.equal(buildCollectionDoneEvent(db, runId),
    'Collection done: groups complete 1, 3 · failed 2; companies 4 finished, 1 failed → classifier finishing');
});

test('D93: a failing event sender never stops the runner', async (t) => {
  const { db, runId } = setUpRun(t, { count: 2, groupSize: 2 });
  const launcher = makeLauncher(({ groupNumber, exit }) => { markCompanies(db, runId, groupNumber); exit(0); });
  const runner = createGroupRunner({
    db, runId, pid: RUNNER_PID, startGroup: launcher.startGroup, clock: makeRecordingClock(), settings: SETTINGS,
    log: () => {}, warn: () => {}, sleep: async () => {}, event: () => { throw new Error('channel gone'); },
  });
  assert.equal(await runner.run(), 'done');
});

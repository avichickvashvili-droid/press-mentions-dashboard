// serviceProcess.test.js — tests with REAL child processes (tiny fake services in fixtures/):
// labelled output, exit codes, the clean stop through serviceLink.js (the emergency heartbeat
// is written, D48a/D70), "the orchestrator died" (no orphans, Q5), and the force-kill fallback.
// Also runs the whole orchestrator on fake services: crash, restart, finish, and stop.
// Offline: no Google, no Ollama. Writes only temporary SQLite files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServiceProcess } from '../../src/supervisor/serviceProcess.js';
import { createSupervisor } from '../../src/supervisor/supervisor.js';
import { supervisorConfig } from '../../src/supervisor/supervisorConfig.js';
import { openDatabase } from '../../src/db/database.js';
import {
  FIXTURES_DIR, createCaptureStream, createFakeLog, waitForExit,
} from './testTools.js';

// Starts a fake service from fixtures/ with captured output.
function startFake(file, name = 'fake') {
  const out = createCaptureStream();
  const err = createCaptureStream();
  const handle = startServiceProcess({ name, entry: file }, { projectRoot: FIXTURES_DIR, out, err });
  return { handle, out, err };
}

// A temporary folder removed after the test (retried: Windows may hold a file for a moment).
function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'press-supervisor-test-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      // left in the temp folder
    }
  });
  return dir;
}

// Sets environment variables for the child processes of one test, restored afterwards.
function withEnv(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// Reads the JobRun row of a temporary database.
function readRun(dbPath, runId) {
  const db = openDatabase(dbPath);
  try {
    return db.prepare('SELECT * FROM JobRun WHERE id = ?').get(runId);
  } finally {
    db.close();
  }
}

test('output is shown line by line with the service label; errors stay on the error output', async () => {
  const { handle, out, err } = startFake('print-lines.mjs', 'collector');
  const result = await waitForExit(handle);
  assert.equal(result.code, 0);
  assert.deepEqual(out.lines(), ['[collector] first line', '[collector] second line', '[collector] last line without end']);
  // Node itself may add ".env not found. Continuing without it." (no .env in the fixtures folder).
  const withoutEnvNote = (lines) => lines.filter((line) => !line.includes('.env not found'));
  assert.deepEqual(withoutEnvNote(err.lines()), ['[collector] an error line']);
  assert.deepEqual(withoutEnvNote(handle.recentErrorLines()), ['an error line']);
});

test('exit codes reach the orchestrator unchanged: 0, 3, crash = 1', async () => {
  assert.equal((await waitForExit(startFake('exit-0.mjs').handle)).code, 0);
  assert.equal((await waitForExit(startFake('exit-3.mjs').handle)).code, 3);
  const crash = startFake('crash.mjs');
  assert.equal((await waitForExit(crash.handle)).code, 1);
  assert.match(crash.handle.recentErrorLines().join('\n'), /fake service crashed on purpose/);
});

test('a missing start file is a crash (exit 1), not an orchestrator error', async () => {
  const { handle } = startFake('does-not-exist.mjs');
  const result = await waitForExit(handle);
  assert.equal(result.code, 1);
});

test('stop request: the service runs its own stop and WRITES THE EMERGENCY HEARTBEAT (D48a, D70)', async (t) => {
  const dbPath = path.join(makeTempDir(t), 'test.sqlite');
  withEnv(t, { FAKE_DB_PATH: dbPath });
  const { handle, out } = startFake('link-emergency.mjs', 'collector');
  const [, runId, pid] = await out.waitFor(/READY run (\d+) pid (\d+)/);
  assert.equal(readRun(dbPath, Number(runId)).owner_pid, Number(pid), 'the fake collector holds the lock');

  assert.equal(handle.requestStop(), true);
  const result = await waitForExit(handle);

  assert.equal(result.code, 143, 'stopped on request');
  const run = readRun(dbPath, Number(runId));
  assert.equal(run.owner_pid, null, 'lock released');
  assert.equal(run.status, 'running', 'run stays running, so the next start resumes it');
  assert.equal(run.last_error, 'stopped by SIGTERM');
  assert.ok(run.crashed_at, 'crashed_at written');
});

test('the orchestrator dies (channel disconnects): the service stops itself and writes the emergency heartbeat (Q5)', async (t) => {
  const dbPath = path.join(makeTempDir(t), 'test.sqlite');
  withEnv(t, { FAKE_DB_PATH: dbPath });
  const out = createCaptureStream();
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [path.join(FIXTURES_DIR, 'link-emergency.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout.on('data', (piece) => out.write(piece.toString()));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const [, runId] = await out.waitFor(/READY run (\d+)/);

  child.disconnect(); // what the service sees when the orchestrator is gone

  assert.equal(await exited, 143);
  const run = readRun(dbPath, Number(runId));
  assert.equal(run.owner_pid, null);
  assert.ok(run.crashed_at);
});

test('stop request to a service with no stop handler yet: it exits with 143', async () => {
  const { handle, out } = startFake('link-no-handler.mjs');
  await out.waitFor(/READY/);
  handle.requestStop();
  assert.equal((await waitForExit(handle)).code, 143);
});

test('a connected one-shot job still exits by itself (the channel does not keep it alive)', async () => {
  const { handle, out } = startFake('link-one-shot.mjs');
  const result = await waitForExit(handle);
  assert.equal(result.code, 0);
  assert.match(out.text(), /done \(connected: true\)/);
});

test('a hung service that ignores the stop request is ended by the force-kill', async () => {
  const { handle, out } = startFake('ignore-stop.mjs');
  await out.waitFor(/READY/);
  handle.requestStop(); // ignored (not connected to the orchestrator)
  handle.forceKill();
  const result = await waitForExit(handle);
  assert.notEqual(result.code, 0);
});

test('whole orchestrator with real processes: crashes twice, restarted with waits, then finishes', async (t) => {
  const counterFile = path.join(makeTempDir(t), 'starts.txt');
  withEnv(t, { FAKE_COUNTER_FILE: counterFile, FAKE_CRASHES: '2' });
  const out = createCaptureStream();
  const log = createFakeLog();
  const finished = new Promise((resolve) => {
    const supervisor = createSupervisor({
      services: [{ name: 'collector', entry: 'crash-until.mjs', npmScript: 'collect', policy: 'once' }],
      startProcess: (service) => startServiceProcess(service, { projectRoot: FIXTURES_DIR, out, err: out }),
      log,
      settings: { ...supervisorConfig, RESTART_BACKOFF_MS: [20, 40] }, // short waits for the test
      entryExists: () => true,
      onFinished: resolve,
    });
    supervisor.start();
  });
  assert.equal(await finished, 0);
  assert.equal(fs.readFileSync(counterFile, 'utf8'), '3');
  assert.match(log.text(), /collector crashed \(exit 1\), restart #1 in 0 s/);
  assert.match(log.text(), /collector crashed \(exit 1\), restart #2 in 0 s/);
  assert.match(log.text(), /collector finished normally \(exit 0\)/);
  assert.match(out.text(), /\[collector\] start 3: finished/);
});

test('whole orchestrator with real processes: stop writes the emergency heartbeat before it ends', async (t) => {
  const dbPath = path.join(makeTempDir(t), 'test.sqlite');
  withEnv(t, { FAKE_DB_PATH: dbPath });
  const out = createCaptureStream();
  const log = createFakeLog();
  let supervisor;
  const finished = new Promise((resolve) => {
    supervisor = createSupervisor({
      services: [{ name: 'collector', entry: 'link-emergency.mjs', npmScript: 'collect', policy: 'once' }],
      startProcess: (service) => startServiceProcess(service, { projectRoot: FIXTURES_DIR, out, err: out }),
      log,
      entryExists: () => true,
      onFinished: resolve,
    });
  });
  await supervisor.start();
  const [, runId] = await out.waitFor(/READY run (\d+)/);

  supervisor.stop(130);

  assert.equal(await finished, 130);
  assert.match(log.text(), /collector stopped \(exit 143\)/);
  assert.doesNotMatch(log.text(), /forced kill/);
  const run = readRun(dbPath, Number(runId));
  assert.equal(run.owner_pid, null, 'emergency heartbeat released the lock');
  assert.equal(run.last_error, 'stopped by SIGTERM');
});

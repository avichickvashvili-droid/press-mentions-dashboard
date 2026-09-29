// runApp.js — the starter of the Docker "app" container (D116): runs the dashboard (api + page)
// and the daily job side by side, as two Node processes.
//
// Where it sits: the container's command in docker-compose.yml. Outside Docker it is not used
// (there the owner starts `npm run api` / `npm run dashboard` and `npm run daily` himself).
// Why one container for both: they must see each other like programs on one computer. The daily
// job's "new data" signal goes to the api on 127.0.0.1 (D106), and the lock checks ("is that
// process still alive?") only work inside one process list. The backfill runs in this same
// container too (`docker compose exec app npm start`), for the same reason.
// Reads/writes: nothing itself; each program's output goes straight to the container log.
//
// The daily job starts only once the dashboard answers (at most APP_READY_TIMEOUT_MS, then it
// starts anyway): on an empty database the api first loads data/, and a daily run before that
// would fail with "no companies yet" (found in the Docker test, Prompt 352).
//
// When one of the two ends (a crash, or it gave up), the other is asked to stop (SIGTERM) and
// this starter exits with the ended one's code: Docker then restarts the container, so both run
// again (restart: unless-stopped). A stop request for the container (SIGTERM / Ctrl+C) is passed
// on to both, and the starter exits once both have ended. A program that does not end within
// APP_STOP_GRACE_MS is killed.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { EXIT_CODES } from '../shared/exitCodes.js';

// How long a program gets to stop cleanly before it is killed (the daily job puts articles back
// in the queue and marks its run; Docker itself waits 10 s by default before killing everything).
export const APP_STOP_GRACE_MS = 8000;

// How long the daily job waits for the dashboard to answer, and how often it asks.
export const APP_READY_TIMEOUT_MS = 60000;
export const APP_READY_CHECK_MS = 1000;

// The two programs of the container: the same entry files as `npm run api` and `npm run daily`.
// `waitForReady`: start only once the dashboard answers.
export const APP_PROGRAMS = Object.freeze([
  { name: 'dashboard', entry: 'src/api/runApi.js' },
  { name: 'daily', entry: 'src/daily/runDaily.js', waitForReady: true },
]);

// Resolves true once the dashboard answers on 127.0.0.1 (the company list loads), or false after
// `timeoutMs`. `isStopping()` ends the wait early (the container is being stopped).
export async function waitForDashboard({
  url = `http://${config.API_HOST}:${config.API_PORT}/api/companies`,
  timeoutMs = APP_READY_TIMEOUT_MS,
  checkMs = APP_READY_CHECK_MS,
  fetchImpl = globalThis.fetch,
  isStopping = () => false,
} = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !isStopping()) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(checkMs * 5) });
      if (response.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, checkMs));
  }
  return false;
}

// The exit code for a program that ended: its own code, or the usual code for the signal that
// ended it (143 for SIGTERM, 130 for SIGINT, else "crashed").
function exitCodeOf(code, signal) {
  if (Number.isInteger(code)) return code;
  if (signal === 'SIGTERM') return EXIT_CODES.STOPPED_BY_REQUEST;
  if (signal === 'SIGINT') return EXIT_CODES.STOPPED_BY_CTRL_C;
  return EXIT_CODES.CRASHED;
}

// Starts every program and watches them. Returns a promise of the exit code for the container,
// and `stop()` to ask all of them to stop (used for the container's own stop signals).
// `spawnImpl`, `programs`, `graceMs`, `log`, `waitForReady` can be replaced in the tests.
export function runPrograms({
  programs = APP_PROGRAMS,
  spawnImpl = spawn,
  graceMs = APP_STOP_GRACE_MS,
  log = (text) => console.log(`[app] ${text}`),
  waitForReady = waitForDashboard,
} = {}) {
  const running = new Map(); // name → child process still running
  let firstExitCode = null;
  let stopping = false;
  let killTimer = null;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });

  // Asks every program still running to stop, and kills those still running after graceMs.
  function stopAll() {
    if (stopping) return;
    stopping = true;
    for (const child of running.values()) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
    killTimer = setTimeout(() => {
      for (const [name, child] of running) {
        log(`${name} did not stop within ${graceMs / 1000} s: killing it.`);
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    }, graceMs);
    killTimer.unref?.();
  }

  // Called once per program when it has ended.
  function onEnded(name, code, signal) {
    if (!running.has(name)) return;
    running.delete(name);
    const exitCode = exitCodeOf(code, signal);
    if (firstExitCode === null) firstExitCode = exitCode;
    if (!stopping) {
      log(`${name} ended (exit ${exitCode}): stopping the other program so the container restarts both.`);
      stopAll();
    }
    if (running.size === 0) {
      clearTimeout(killTimer);
      finish(firstExitCode);
    }
  }

  // Starts one program (unless the container is already stopping).
  function startProgram({ name, entry }) {
    if (stopping) return;
    let child;
    try {
      child = spawnImpl(process.execPath, [entry], { cwd: config.PROJECT_ROOT, stdio: 'inherit' });
    } catch (error) {
      log(`${name} could not be started (${error?.message ?? error}).`);
      if (firstExitCode === null) firstExitCode = EXIT_CODES.CRASHED;
      stopAll();
      return;
    }
    running.set(name, child);
    child.once('error', (error) => {
      log(`${name} could not be started (${error?.message ?? error}).`);
      onEnded(name, EXIT_CODES.CRASHED, null);
    });
    child.once('exit', (code, signal) => onEnded(name, code, signal));
  }

  const later = programs.filter((program) => program.waitForReady);
  for (const program of programs.filter((p) => !p.waitForReady)) startProgram(program);
  if (running.size === 0) {
    finish(firstExitCode ?? EXIT_CODES.CRASHED);
  } else if (later.length > 0) {
    Promise.resolve(waitForReady({ isStopping: () => stopping }))
      .catch(() => false)
      .then((ready) => {
        if (stopping) return;
        if (!ready) log('the dashboard did not answer in time: starting the rest anyway.');
        for (const program of later) startProgram(program);
      });
  }

  return { done, stop: stopAll };
}

// The container command: start both, pass the container's stop signals on, exit with the code.
function main() {
  const { done, stop } = runPrograms();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  done.then((code) => { process.exitCode = code; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

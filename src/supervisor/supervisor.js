// supervisor.js — the orchestrator's core: keeps the services running (D38, D66–D70).
//
// Where it sits: created by runSupervisor.js (`npm start`). It starts each service in
// services.js as its own process, watches it, restarts it when it crashes (with growing waits),
// gives up on a service that keeps crashing, and stops everything cleanly on Ctrl+C.
// The services never talk to each other or to the orchestrator about work: they share only the
// SQLite file, and after a restart each one resumes from the database by itself (D39).
// Reads/writes: nothing itself. Processes are started through `startProcess`
// (serviceProcess.js in real use, a fake in tests); time comes from `clock` (fake in tests).
//
// Exit codes of a service and what happens (full table in src/shared/exitCodes.js):
//   0   finished normally  -> not restarted (for an always-on service: unexpected = crash)
//   3   refused, nothing wrong (e.g. lock held by another run) -> logged, not restarted
//   1   crashed            -> restarted after 1 s, 2 s, 5 s, 10 s, 30 s, 60 s, 60 s ...
//   130 / 143 Ctrl+C / stop request -> expected while stopping; otherwise = crash
// More than 5 crashes within 10 minutes -> that service is given up (clear error), the others
// keep running (I18). A service that stayed up 5 minutes starts again from the 1 s wait.
//
// Stopping (Ctrl+C): no more restarts; each running service gets a { type: 'stop' } message and
// runs its own stop (emergency heartbeat, D48a); after 10 s any service still running is
// force-killed as a last resort. A second Ctrl+C force-kills at once.
//
// The orchestrator ends by itself when nothing is left to supervise:
//   0 = every service finished normally (or was not needed), 1 = a service was given up or its
//   file is missing, or the stop code (130 / 143) when it was stopped.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import {
  classifyExit, describeExit, formatWait, isStopCode, recordCrash, restartWait, tooManyCrashes,
} from './restartRules.js';

// The states in which a service needs nothing more from the orchestrator.
const FINAL_STATES = new Set(['finished', 'refused', 'gave-up', 'skipped', 'missing', 'stopped']);

// The real clock (tests pass a fake one they can move forward by hand).
const realClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

// Creates the orchestrator. Call start() once; stop(code) on Ctrl+C; forceStop() on a second
// Ctrl+C. onFinished(exitCode) is called once when nothing is left to supervise.
export function createSupervisor({
  services,
  startProcess,
  log,
  settings = config,
  clock = realClock,
  entryExists = (entry) => fs.existsSync(path.resolve(config.PROJECT_ROOT, entry)),
  onFinished = () => {},
}) {
  const states = services.map((service) => ({
    service,
    status: 'not-started', // then: running / ending / waiting / one of FINAL_STATES
    handle: null,
    startedAt: 0,
    backoffIndex: 0,
    restartCount: 0,
    crashTimes: [],
    timer: null,
    lastErrorLines: [],
  }));
  let stopping = false;
  let stopExitCode = 0;
  let forceTimer = null;
  let finishedReported = false;

  // Starts (or restarts) one service's process and listens for its end.
  function launch(state) {
    state.status = 'running';
    state.startedAt = clock.now();
    let handle;
    try {
      handle = startProcess(state.service);
    } catch (error) {
      state.handle = null;
      handleExit(state, { code: null, signal: null, error });
      return;
    }
    state.handle = handle;
    handle.onExit((result) => onProcessEnded(state, handle, result));
  }

  // A process ended. The Ctrl+C / stop codes are judged a moment later (the orchestrator may be
  // about to hear its own Ctrl+C; see STOP_SIGNAL_GRACE_MS). Everything else is judged at once.
  function onProcessEnded(state, handle, result) {
    if (state.handle !== handle) return; // an old process; already handled
    state.lastErrorLines = handle.recentErrorLines?.() ?? []; // kept for a give-up message
    state.handle = null;
    if (!stopping && isStopCode(result.code)) {
      state.status = 'ending';
      state.timer = clock.setTimeout(() => {
        state.timer = null;
        handleExit(state, result);
      }, settings.STOP_SIGNAL_GRACE_MS);
      return;
    }
    handleExit(state, result);
  }

  // Decides what a process end means and acts on it (see the table at the top).
  function handleExit(state, result) {
    const { name, policy } = state.service;
    const kind = classifyExit({ code: result.code, stopAsked: stopping, policy });
    const how = describeExit(result);

    if (kind === 'stopped') {
      state.status = 'stopped';
      log.info(`${name} stopped (${how}).`);
    } else if (kind === 'finished') {
      state.status = 'finished';
      log.info(`${name} finished normally (${how}); it is not restarted.`);
    } else if (kind === 'refused') {
      state.status = 'refused';
      log.info(`${name} did not start: it refused, nothing is wrong (${how}; see its message above). It is not restarted.`);
    } else {
      handleCrash(state, how);
    }
    checkAllDone();
  }

  // A crash: restart after the next wait, or give up if it keeps crashing.
  function handleCrash(state, how) {
    const { name, npmScript } = state.service;
    const now = clock.now();
    if (now - state.startedAt >= settings.STABLE_UPTIME_MS) state.backoffIndex = 0;
    state.crashTimes = recordCrash(state.crashTimes, now, settings.CRASH_WINDOW_MS);

    if (tooManyCrashes(state.crashTimes, settings.MAX_CRASHES)) {
      state.status = 'gave-up';
      const minutes = Math.round(settings.CRASH_WINDOW_MS / 60000);
      const lastErrors = state.lastErrorLines ?? [];
      const lines = [
        `${name} crashed ${state.crashTimes.length} times within ${minutes} minutes (last: ${how}). ` +
          'It is NOT restarted any more; the other services keep running.',
        ...(lastErrors.length ? ['Its last error lines:', ...lastErrors.map((line) => `  ${line}`)] : []),
        `To see the problem, run it alone: npm run ${npmScript}`,
      ];
      for (const line of lines) log.error(line);
      return;
    }

    const wait = restartWait(state.backoffIndex, settings.RESTART_BACKOFF_MS);
    state.backoffIndex += 1;
    state.restartCount += 1;
    state.status = 'waiting';
    log.info(`${name} crashed (${how}), restart #${state.restartCount} in ${formatWait(wait)}`);
    state.timer = clock.setTimeout(() => {
      state.timer = null;
      if (!stopping) launch(state);
    }, wait);
  }

  // When no service needs anything more, reports the orchestrator's exit code once.
  function checkAllDone() {
    if (finishedReported) return;
    if (!states.every((state) => FINAL_STATES.has(state.status))) return;
    finishedReported = true;
    if (forceTimer) clock.clearTimeout(forceTimer);
    forceTimer = null;
    let exitCode = 0;
    if (stopping) {
      exitCode = stopExitCode;
      log.info('All services are stopped. Orchestrator ends.');
    } else if (states.some((state) => state.status === 'gave-up' || state.status === 'missing')) {
      exitCode = 1;
      log.error('Nothing left to supervise, but at least one service could not run (see above). Orchestrator ends.');
    } else {
      log.info('Nothing left to supervise. Orchestrator ends.');
    }
    onFinished(exitCode);
  }

  return {
    // Starts every service in the list (or explains why one is not started).
    async start() {
      log.info(`Orchestrator started (process ${process.pid}). Services: ${services.map((s) => s.name).join(', ')}.`);
      for (const state of states) {
        if (stopping) {
          state.status = 'stopped';
          continue;
        }
        const { name, entry, checkBeforeStart } = state.service;
        if (!entryExists(entry)) {
          state.status = 'missing';
          log.error(`${name} cannot start: its file ${entry} does not exist. The other services keep running.`);
          continue;
        }
        if (checkBeforeStart) {
          let decision;
          try {
            decision = await checkBeforeStart();
          } catch (error) {
            // Not starting is the safe choice: a wrong start could begin a whole new collection.
            state.status = 'skipped';
            log.error(`${name} is not started: the start check failed (${error.message}). Run it alone if needed: npm run ${state.service.npmScript}`);
            continue;
          }
          log.info(`${name}: ${decision.reason}`);
          if (!decision.start) {
            state.status = 'skipped';
            continue;
          }
          if (stopping) {
            state.status = 'stopped';
            continue;
          }
        }
        log.info(`Starting ${name}.`);
        launch(state);
      }
      checkAllDone();
    },

    stop,
    forceStop,

    // Current status of every service (used by tests and for troubleshooting).
    statuses() {
      return Object.fromEntries(states.map((state) => [state.service.name, state.status]));
    },
  };

  // Clean stop of everything (Ctrl+C / SIGTERM / the orchestrator's own error).
  function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    stopExitCode = exitCode;
    log.info('Stopping: asking every service to stop cleanly (each saves its progress first).');
    for (const state of states) {
      if (state.timer) {
        clock.clearTimeout(state.timer);
        state.timer = null;
        if (state.status === 'waiting') {
          state.status = 'stopped';
          log.info(`${state.service.name} was waiting to restart; it is not restarted.`);
        }
      }
      if (state.status === 'ending') {
        state.status = 'stopped';
        log.info(`${state.service.name} stopped.`);
      }
      if (state.status === 'running' && state.handle) {
        if (!state.handle.requestStop()) {
          log.info(`${state.service.name} could not be asked to stop (no message channel); waiting for it to end.`);
        }
      }
    }
    if (states.some((state) => state.status === 'running')) {
      forceTimer = clock.setTimeout(() => {
        forceTimer = null;
        forceKillRunning(`still running after ${formatWait(settings.STOP_TIMEOUT_MS)}`);
      }, settings.STOP_TIMEOUT_MS);
    }
    checkAllDone();
  }

  // Second Ctrl+C: force-kill whatever is still running, now.
  function forceStop() {
    if (!stopping) stop(130);
    if (forceTimer) clock.clearTimeout(forceTimer);
    forceTimer = null;
    forceKillRunning('second Ctrl+C');
  }

  // Force-kills every service still running and says clearly what that means.
  function forceKillRunning(why) {
    for (const state of states) {
      if (state.status === 'running' && state.handle) {
        log.error(`${state.service.name}: forced kill (${why}), no emergency heartbeat written; ` +
          'the owner_pid check will release the run.');
        state.handle.forceKill();
      }
    }
  }
}

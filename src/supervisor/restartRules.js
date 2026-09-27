// restartRules.js — the orchestrator's rules for "a service ended: what now?" (D68, D69).
//
// Where it sits: used by supervisor.js each time a service process ends. Pure functions only
// (no processes, no timers), so every rule can be tested on its own.
// Reads/writes: nothing.
//
// Exit codes (full table in exitCodes.js):
//   0 finished (restart only if the service should always run) · 3 refused, nothing wrong ·
//   1 crash · 130 Ctrl+C · 143 stop request (130/143 without a stop request = crash).

import { EXIT_CODES } from './exitCodes.js';

// Sorts one process end into: 'stopped' | 'finished' | 'refused' | 'crash'.
//   stopAsked = the orchestrator asked this service to stop (or is stopping everything):
//               then any end is an expected stop and nothing is restarted.
//   policy    = 'once' (one-shot job) or 'always' (always-on service).
export function classifyExit({ code, stopAsked, policy }) {
  if (stopAsked) return 'stopped';
  if (code === EXIT_CODES.REFUSED) return 'refused';
  if (code === EXIT_CODES.FINISHED && policy === 'once') return 'finished';
  return 'crash';
}

// True for the Ctrl+C / stop-request codes (130, 143). The orchestrator waits a moment before
// judging these, in case it is about to hear its own Ctrl+C.
export function isStopCode(code) {
  return code === EXIT_CODES.STOPPED_BY_CTRL_C || code === EXIT_CODES.STOPPED_BY_REQUEST;
}

// Short text for the log: "exit 1", "killed by SIGKILL", or "could not start: ...".
export function describeExit({ code, signal, error }) {
  if (error) return `could not start: ${error.message ?? error}`;
  if (code !== null && code !== undefined) return `exit ${code}`;
  if (signal) return `killed by ${signal}`;
  return 'ended for an unknown reason';
}

// The wait before restart number `backoffIndex` (0 = first). After the last step, the last
// (longest) wait is used again.
export function restartWait(backoffIndex, steps) {
  return steps[Math.min(backoffIndex, steps.length - 1)];
}

// Adds a crash time and keeps only the crashes inside the window. Returns a new list.
export function recordCrash(crashTimes, now, windowMs) {
  return [...crashTimes, now].filter((time) => now - time <= windowMs);
}

// True when the service crashed MORE than `maxCrashes` times inside the window: give up.
export function tooManyCrashes(crashTimes, maxCrashes) {
  return crashTimes.length > maxCrashes;
}

// "5 s", "1 min", "1.5 min": a wait in words for the log.
export function formatWait(ms) {
  if (ms < 60000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6000) / 10} min`;
}

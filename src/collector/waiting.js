// waiting.js — small helpers for waiting and retrying, shared by the collector.
//
// Where it sits: used by the Google News client (waits between requests and retries),
// the BufferQueue writer (the "queue full" pause) and the company loop (retrying a
// database write that failed, e.g. because the database was busy).
// Reads/writes: nothing by itself; retryDbWrite runs the database work it is given.

import { config } from '../config.js';

// Waits the given number of milliseconds. Tests pass their own fake version so they run instantly.
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The wait before retry number `retryIndex` (0 = first retry) after a temporary error:
// 5 s, 10 s, 30 s, 1 min, 2 min, 5 min, 10 min, then 10 min every time after that.
export function backoffDelay(retryIndex) {
  const steps = config.RETRY_BACKOFF_MS;
  return steps[Math.min(retryIndex, steps.length - 1)];
}

// Writes a wait in words for the progress line, e.g. 5000 -> "5 s", 120000 -> "2 min".
export function describeWait(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60000)} min`;
}

// Runs a database write and, if it fails (e.g. "database is busy"), logs the problem and
// tries again with the growing waits, until it works. The write itself must be one
// transaction, so a failed attempt has already been fully rolled back.
// Why: a database hiccup must never mark a company as failed or crash the collector (D37).
export async function retryDbWrite(work, { label, warn = console.warn, wait = sleep } = {}) {
  for (let retryIndex = 0; ; retryIndex += 1) {
    try {
      return work();
    } catch (error) {
      const delay = backoffDelay(retryIndex);
      warn(`Database write failed (${label}): ${error.message}. Nothing was saved; retrying in ${describeWait(delay)}.`);
      await wait(delay);
    }
  }
}

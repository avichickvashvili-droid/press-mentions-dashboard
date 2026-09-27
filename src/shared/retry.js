// retry.js — small helpers for waiting and retrying, shared by the collector and the classifier.
//
// Where it sits: used by the Google News client (waits between requests and retries), the
// BufferQueue writer (the "queue full" pause), the company loop and the classifier loop
// (retrying a database write that failed because the database was busy), and the data/ export
// (the short wait between rename tries).
// Reads/writes: nothing by itself; retryDbWrite runs the database work it is given.
//
// Which database errors are retried (D76): ONLY "database is busy / locked" (another service is
// writing right now; it passes by itself). Any other database error (a broken rule, disk full,
// read-only or damaged file) can't fix itself by waiting, so it is thrown on: the service then
// crashes on purpose, writes its emergency heartbeat, and the orchestrator restarts it and shows
// the error, instead of the problem hiding behind an endless "retrying" loop.

import { config } from '../config.js';
import { isDatabaseBusyError } from '../db/database.js';

// Waits the given number of milliseconds. Tests pass their own fake version so they run instantly.
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The wait before retry number `retryIndex` (0 = first retry) after a temporary error:
// 5 s, 10 s, 30 s, 1 min, 2 min, 5 min, 10 min, then 10 min every time after that.
export function backoffDelay(retryIndex, steps = config.RETRY_BACKOFF_MS) {
  return steps[Math.min(retryIndex, steps.length - 1)];
}

// Writes a wait in words for the progress line, e.g. 5000 -> "5 s", 120000 -> "2 min".
export function describeWait(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60000)} min`;
}

// Runs a database write and, if the database is busy, logs it and tries again with the growing
// waits, until it works. The write itself must be one transaction, so a failed attempt has
// already been fully rolled back. Any other error is thrown on at once (D76, see the top).
// Why: a busy database must never mark a company as failed or crash a service (D37), but a
// permanent database problem must not be hidden either.
export async function retryDbWrite(work, { label, warn = console.warn, wait = sleep } = {}) {
  for (let retryIndex = 0; ; retryIndex += 1) {
    try {
      return work();
    } catch (error) {
      if (!isDatabaseBusyError(error)) throw error;
      const delay = backoffDelay(retryIndex);
      warn(`Database busy (${label}): ${error.message}. Nothing was saved; retrying in ${describeWait(delay)}.`);
      await wait(delay);
    }
  }
}

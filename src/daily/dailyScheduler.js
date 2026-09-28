// dailyScheduler.js — decides WHEN a daily run starts (D102, Prompt 272).
//
// Where it sits: inside `npm run daily` (runDaily.js), which stays up. It calls `runOnce()`
// (one daily run, dailyJob.js) at these times:
//   - every day at DAILY_CRON (03:00) in DAILY_TIMEZONE (Israel), with node-cron;
//   - right away at start-up when a run was missed: the last successful run started more than
//     DAILY_MISSED_AFTER_MS (24 h) ago, or there has never been one ("run when possible");
//   - the same missed-run check every DAILY_MISSED_CHECK_MS (1 h) while the program stays open:
//     node-cron does not run a 03:00 start that passed while the computer was asleep, so this
//     check runs it after the computer wakes up. It starts nothing while a run is going on or a
//     retry is planned, and nothing after the failed retries gave up (that waits for the next 03:00);
//   - again after DAILY_BLOCKED_RETRY_MS (15 min) when the run had to wait (the 90-day
//     collection is still going, or another daily run holds the lock);
//   - again after DAILY_FAILED_RETRY_MS (30 min) when the run failed, at most
//     DAILY_FAILED_RETRIES times in a row; then it waits for the next 03:00.
// A retry is dropped when a successful run has started since the time it is retrying for.
// Problems go to Discord too (owner decision B, Prompt 298), ONCE per need (a day's run and its
// retries), through `onProblem(text, { keepsTrying })`:
//   - the run has been waiting (blocked) for DAILY_PROBLEM_AFTER_MS (3 h) since it was due;
//   - a run has been going on for DAILY_PROBLEM_AFTER_MS without finishing (e.g. Ollama or Google
//     is down; the text includes `describeState()`, the last warning);
//   - the failed retries are used up (it waits for the next 03:00).
// A database error inside a timer is logged and the timer is planned again: it never crashes
// the program.
// Only one run at a time: a start while a run is going on is skipped (with a line).
// Reads: the last successful run's start (through `readLastDoneStartedAt`). Writes: nothing itself.

import cron from 'node-cron';
import { config } from '../config.js';
import { describeDuration } from '../shared/text.js';

// Creates the scheduler. Everything it uses can be replaced in tests (a fake cron, fake timers).
// `runOnce(reason)` must resolve to { status: 'done' | 'failed' | 'blocked', ... }.
// `onProblem(text, { keepsTrying })` sends the problem message; `describeState()` = the last warning.
// Returns { start, stop, trigger, isBusy }.
export function createDailyScheduler({
  runOnce,
  readLastDoneStartedAt,
  now = () => Date.now(),
  cronLib = cron,
  cronExpression = config.DAILY_CRON,
  timeZone = config.DAILY_TIMEZONE,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer),
  log = console.log,
  missedAfterMs = config.DAILY_MISSED_AFTER_MS,
  missedCheckMs = config.DAILY_MISSED_CHECK_MS,
  blockedRetryMs = config.DAILY_BLOCKED_RETRY_MS,
  failedRetryMs = config.DAILY_FAILED_RETRY_MS,
  failedRetries = config.DAILY_FAILED_RETRIES,
  problemAfterMs = config.DAILY_PROBLEM_AFTER_MS,
  onProblem = () => {},
  describeState = () => null,
}) {
  let task = null;
  let retryTimer = null;
  let checkTimer = null;
  let busy = false;
  let failuresInARow = 0;
  let gaveUp = false; // the failed retries are used up: only the next 03:00 starts a run again
  let problemSentFor = null; // the "need" (sinceMs) a problem message was already sent for

  // Sends one problem message for the need that started at `sinceMs` (never twice). Never throws.
  function reportProblem(sinceMs, text, keepsTrying) {
    if (problemSentFor === sinceMs) return;
    problemSentFor = sinceMs;
    log(`Daily job problem (sent to Discord): ${text}`);
    try {
      Promise.resolve(onProblem(text, { keepsTrying })).catch((error) => log(`The problem message could not be sent: ${error?.message ?? error}`));
    } catch (error) {
      log(`The problem message could not be sent: ${error?.message ?? error}`);
    }
  }

  // True if a successful run has started at or after `sinceMs`.
  function doneSince(sinceMs) {
    const last = readLastDoneStartedAt();
    return last !== null && last !== undefined && Date.parse(last) >= sinceMs;
  }

  // True if the last successful run started more than `missedAfterMs` ago, or there is none.
  function isMissed() {
    const last = readLastDoneStartedAt();
    return last === null || last === undefined || now() - Date.parse(last) > missedAfterMs;
  }

  // Plans one retry after `waitMs`, for the need that started at `sinceMs`. If the database can't
  // be read at that moment, the error is logged and the retry is planned again.
  function planRetry(waitMs, sinceMs) {
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = setTimer(() => {
      retryTimer = null;
      let alreadyDone;
      try {
        alreadyDone = doneSince(sinceMs);
      } catch (error) {
        log(`The daily run retry could not read the database (${error?.message ?? error}). Trying again in ${describeDuration(waitMs)}.`);
        planRetry(waitMs, sinceMs);
        return;
      }
      if (alreadyDone) return undefined;
      return trigger('retry', sinceMs); // returned for the tests (the real timer ignores it)
    }, waitMs);
  }

  // Plans the next missed-run check (see the top). Its errors are logged; the next check is always planned.
  function planMissedCheck() {
    checkTimer = setTimer(() => {
      checkTimer = null;
      if (task !== null) planMissedCheck();
      try {
        if (!busy && retryTimer === null && !gaveUp && isMissed()) {
          log(`The last daily run was more than ${describeDuration(missedAfterMs)} ago (the computer was probably asleep at the planned time): running now.`);
          return trigger('missed'); // returned for the tests (the real timer ignores it)
        }
      } catch (error) {
        log(`The missed-run check could not read the database (${error?.message ?? error}). Checking again in ${describeDuration(missedCheckMs)}.`);
      }
      return undefined;
    }, missedCheckMs);
  }

  // Starts one run now (unless one is going on) and plans a retry if it had to wait or failed.
  // `reason` = 'scheduled' | 'missed' | 'retry'. Resolves when the run is over.
  async function trigger(reason, sinceMs = now()) {
    if (busy) {
      log(`A daily run is still going on; the ${reason} start is skipped.`);
      return null;
    }
    busy = true;
    // A run still going after DAILY_PROBLEM_AFTER_MS: one problem message (it keeps trying).
    const watchdog = setTimer(() => {
      if (!busy) return;
      const state = describeState();
      reportProblem(sinceMs, `The daily run started ${describeDuration(problemAfterMs)} ago and is not done yet.${state ? ` Last problem: ${state}` : ''}`, true);
    }, problemAfterMs);
    if (reason !== 'retry') failuresInARow = 0; // a new day (or a missed run) starts a fresh count
    if (reason === 'scheduled') gaveUp = false;
    if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null; }
    let result;
    try {
      result = await runOnce(reason);
    } catch (error) {
      result = { status: 'failed', error: error?.message ?? String(error) };
    } finally {
      busy = false;
      clearTimer(watchdog);
    }

    if (result.status === 'done') {
      failuresInARow = 0;
      gaveUp = false;
    } else if (result.status === 'blocked') {
      log(`The daily run waits: ${result.reason}. Trying again in ${describeDuration(blockedRetryMs)}.`);
      planRetry(blockedRetryMs, sinceMs);
      if (now() - sinceMs >= problemAfterMs) {
        reportProblem(sinceMs, `The daily run has been waiting for ${describeDuration(now() - sinceMs)}: ${result.reason}.`, true);
      }
    } else {
      failuresInARow += 1;
      if (failuresInARow <= failedRetries) {
        log(`The daily run failed: ${result.error}. Trying again in ${describeDuration(failedRetryMs)} (retry ${failuresInARow} of ${failedRetries}).`);
        planRetry(failedRetryMs, sinceMs);
      } else {
        gaveUp = true;
        log(`The daily run failed: ${result.error}. It failed ${failuresInARow} times in a row; the next try is the next scheduled run.`);
        problemSentFor = null; // giving up always gets its own message
        reportProblem(sinceMs, `The daily run failed ${failuresInARow} times in a row. Last error: ${result.error}`, false);
      }
    }
    return result;
  }

  // Starts the daily schedule, and a run right away if one was missed. Returns the missed run's
  // promise (or null), so the caller (and the tests) can wait for it.
  function start() {
    if (!cronLib.validate(cronExpression)) throw new Error(`DAILY_CRON "${cronExpression}" is not a valid cron time (config.js)`);
    task = cronLib.schedule(cronExpression, () => { trigger('scheduled'); }, { timezone: timeZone });
    planMissedCheck();
    const last = readLastDoneStartedAt();
    if (isMissed()) {
      log(last ? `The last daily run was more than ${describeDuration(missedAfterMs)} ago: running now.` : 'No daily run yet: running now.');
      return trigger('missed');
    }
    return null;
  }

  // Stops the schedule, the missed-run check and any planned retry (a run that is going on is
  // not interrupted here).
  function stop() {
    try { task?.stop(); } catch { /* already stopped */ }
    task = null;
    if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null; }
    if (checkTimer !== null) { clearTimer(checkTimer); checkTimer = null; }
  }

  return { start, stop, trigger, isBusy: () => busy };
}

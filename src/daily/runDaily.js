// runDaily.js — the `npm run daily` command: the daily job (Step 6, D102, D105, D106).
//
// Where it sits: its own process, its own flow (like the dashboard): `npm start` does not start
// it. It stays up; node-cron starts one daily run every day at 03:00 Israel time, and it runs
// right away when a run was missed (dailyScheduler.js). One run = dailyJob.js.
// It shares only the SQLite file with the other programs, and talks to the api over one local
// HTTP call (the "new data" signal).
// Reads/writes: the database, Google News, Ollama, the api, Discord, data/ (see dailyJob.js), and
// the lock file daily.lock next to the database (processLock.js).
// Log: the terminal and <logs folder>/daily/daily.log (with the date and time of every line).
//
// Needs: Ollama running (only when there are new articles to classify), DISCORD_WEBHOOK_URL in
// .env (without it everything works except the Discord message). The dashboard api does not have
// to be running.
//
// Only one `npm run daily` at a time (the lock file daily.lock, processLock.js): a second one
// says which process is already open and exits with 3 (refused), so no day gets two runs and two
// Discord messages.
//
// Problems also go to Discord, once per day's run: "⚠️ Daily job problem" when a run has waited or
// been going on for 3 hours, or gave up after its retries (owner decision B, dailyScheduler.js).
//
// Stopping: Ctrl+C (exit 130), a stop request (SIGTERM, 143) or closing the console window
// (SIGHUP on Windows, 143): the articles being classified go back to the queue unchanged, a run
// in progress is marked 'failed' ("stopped"), the next start runs it again (the missed-run
// check), and the lock file is removed. A crash
// (exit 1): the same, but the articles' attempt still counts (poison-article rule, D59).

import { config } from '../config.js';
import { openDatabase } from '../db/database.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { createLogFile, formatLogTime } from '../shared/logFile.js';
import { describeError } from '../shared/text.js';
import { readCompanyNames } from '../shared/companyList.js';
import { createGoogleNewsClient, describeGoogleRetry } from '../collector/googleNews.js';
import { createOllamaClient } from '../classifier/ollamaClient.js';
import { createClassifier } from '../classifier/classifierLoop.js';
import { loadSectionNames } from '../classifier/prompt.js';
import { giveBackClaims, releaseOwnClaimsAfterCrash } from '../classifier/queueStore.js';
import { runDailyJob } from './dailyJob.js';
import { createDailyScheduler } from './dailyScheduler.js';
import { findLastDoneDailyRun, finishDailyRun } from './dailyStore.js';
import { lockFilePath, releaseProcessLock, takeProcessLock } from './processLock.js';
import { buildProblemMessage, describeCronTime } from './digest.js';
import { sendDiscordMessage } from './discord.js';

// The folder of daily.log inside the logs folder.
const LOG_FOLDER = 'daily';

const logFile = createLogFile('daily.log');
logFile.setFolder(LOG_FOLDER);

let db = null;
let scheduler = null;
let currentRunId = null;
let lastWarning = null; // the last warning line, for the "Daily job problem" message
let lockTaken = false; // true once this process holds daily.lock (processLock.js)
let stopping = false;

// A normal line: on the terminal (with the time, since this program runs for days) and in daily.log.
function log(text) {
  console.log(`${formatLogTime(new Date()).slice(0, 19)}  ${text}`);
  logFile.write(text);
}

// A warning: on the terminal and in daily.log, with "WARNING:" in front.
function warn(text) {
  lastWarning = text;
  console.warn(`${formatLogTime(new Date()).slice(0, 19)}  WARNING: ${text}`);
  logFile.write(`WARNING: ${text}`);
}

// An error: on the terminal and in daily.log, with "ERROR:" in front.
function logError(text) {
  console.error(`${formatLogTime(new Date()).slice(0, 19)}  ERROR: ${text}`);
  logFile.write(`ERROR: ${text}`);
}

// The last clean-up, then exit (runs once): stop the schedule, give back the articles being
// classified, mark a run in progress as failed, give back the process lock, close the database.
// `crashed` = true keeps the attempt counted on the given-back articles (D59).
function stopWith(reason, exitCode, crashed = false) {
  if (stopping) return;
  stopping = true;
  try { scheduler?.stop(); } catch { /* already stopped */ }
  if (db) {
    try {
      const count = crashed ? releaseOwnClaimsAfterCrash(db, { pid: process.pid }) : giveBackClaims(db, null, { pid: process.pid });
      if (count) log(`${count} articles being classified were given back to the queue.`);
    } catch (error) {
      warn(`Could not give the articles being classified back (${describeError(error)}); they are released after ${config.CLAIM_TIMEOUT_MS / 60000} min.`);
    }
    if (currentRunId !== null) {
      try {
        finishDailyRun(db, currentRunId, { status: 'failed', error: `stopped in the middle: ${reason}` });
        log(`Daily run ${currentRunId} was stopped in the middle; the next start runs it again.`);
      } catch { /* the next start marks the cut-off run as failed */ }
    }
    try { db.close(); } catch { /* already closed */ }
  }
  if (lockTaken) releaseProcessLock({ file: lockFilePath(config.DB_PATH), pid: process.pid });
  if (exitCode === EXIT_CODES.CRASHED) logError(`Daily job stopped: ${reason}.`);
  else log(`Daily job stopped: ${reason}.`);
  process.exit(exitCode);
}

process.on('SIGINT', () => stopWith('stopped by Ctrl+C', EXIT_CODES.STOPPED_BY_CTRL_C));
process.on('SIGTERM', () => stopWith('stopped by SIGTERM', EXIT_CODES.STOPPED_BY_REQUEST));
// Closing the console window on Windows sends SIGHUP; Windows gives about 10 s, enough for the clean-up.
process.on('SIGHUP', () => stopWith('the window was closed', EXIT_CODES.STOPPED_BY_REQUEST));
process.on('uncaughtException', (error) => {
  logError(error?.stack ?? String(error));
  stopWith(`crashed: ${describeError(error)}`, EXIT_CODES.CRASHED, true);
});
process.on('unhandledRejection', (error) => {
  logError(error?.stack ?? String(error));
  stopWith(`crashed (unhandled promise): ${describeError(error)}`, EXIT_CODES.CRASHED, true);
});

// One daily run with everything real (Google, Ollama, the api, Discord). The company list is read
// again for every run, so a changed list is used from the next run on.
async function runOnce({ googleClient, classifier }, reason) {
  let companyNames;
  try {
    companyNames = readCompanyNames(config.COMPANY_LIST_FILE);
  } catch (error) {
    return { status: 'failed', error: `the company list could not be read: ${describeError(error)}` };
  }
  log(`Daily run starting (${reason === 'scheduled' ? 'the daily schedule' : reason === 'missed' ? 'a missed run' : 'a retry'}).`);
  const result = await runDailyJob({
    db, googleClient, classifier, companyNames, log, warn,
    shouldStop: () => stopping,
    onRunStarted: (runId) => { currentRunId = runId; },
  });
  currentRunId = null;
  if (result.status === 'done') {
    log(`Daily run ${result.runId} done: ${result.newMentions} new mentions, Discord ${result.alertSent ? 'sent' : 'NOT sent (see the warning above)'}.`);
  } else if (result.status === 'failed') {
    logError(`Daily run${result.runId ? ` ${result.runId}` : ''} failed: ${result.error}`);
  }
  return result;
}

// Opens everything, takes the process lock and starts the schedule. Returns an exit code only
// when it can't start (3 = another daily job is already open).
function main() {
  try {
    db = openDatabase(config.DB_PATH);
  } catch (error) {
    logError(`Cannot open the database ${config.DB_PATH}: ${describeError(error)}`);
    return EXIT_CODES.CRASHED;
  }
  let lock;
  try {
    lock = takeProcessLock({ file: lockFilePath(config.DB_PATH), pid: process.pid });
  } catch (error) {
    logError(`Cannot check whether another daily job is open (${lockFilePath(config.DB_PATH)}): ${describeError(error)}`);
    return EXIT_CODES.CRASHED;
  }
  if (!lock.ok) {
    warn(`Another daily job is already open (process ${lock.holder.pid}, started ${lock.holder.startedAt}). ` +
      'Only one may run at a time, or every day would get two runs and two Discord messages. ' +
      'Use the window that is already open, or close it first and then start this one again.');
    return EXIT_CODES.REFUSED;
  }
  lockTaken = true;
  let sectionNames;
  try {
    sectionNames = loadSectionNames();
  } catch (error) {
    logError(describeError(error));
    return EXIT_CODES.CRASHED;
  }
  if (!config.DISCORD_WEBHOOK_URL) {
    warn('DISCORD_WEBHOOK_URL is not set in .env: the daily job runs, but no Discord message is sent.');
  }

  // The daily job's own, slower pace (5 s per search, D108): 1 s got it blocked by Google.
  const googleClient = createGoogleNewsClient({
    onRetry: (info) => warn(describeGoogleRetry(info)),
    requestIntervalMs: config.DAILY_REQUEST_INTERVAL_MS,
  });
  const classifier = createClassifier({ db, client: createOllamaClient(), sectionNames, log, warn });
  scheduler = createDailyScheduler({
    runOnce: (reason) => runOnce({ googleClient, classifier }, reason),
    readLastDoneStartedAt: () => findLastDoneDailyRun(db)?.started_at ?? null,
    log,
    // A problem also goes to Discord (owner decision B): the webhook address is never in the text.
    onProblem: async (text, { keepsTrying }) => {
      const result = await sendDiscordMessage(buildProblemMessage({ problem: text, keepsTrying }), { log: warn });
      if (!result.ok) warn(`The problem message was not sent to Discord: ${result.error}`);
    },
    describeState: () => lastWarning,
  });

  const time = describeCronTime(config.DAILY_CRON) ?? config.DAILY_CRON;
  log(`Daily job started (process ${process.pid}, database ${config.DB_PATH}). It runs every day at ${time} (${config.DAILY_TIMEZONE}). Stop with Ctrl+C.`);
  try {
    scheduler.start();
  } catch (error) {
    logError(describeError(error));
    return EXIT_CODES.CRASHED;
  }
  return null;
}

const exitCode = main();
if (exitCode === EXIT_CODES.REFUSED) stopWith('another daily job is already open', exitCode, false);
else if (exitCode !== null) stopWith('it could not start', exitCode, false);

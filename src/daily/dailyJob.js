// dailyJob.js — ONE daily run, from the search to the Discord message (D102, D105, D106).
//
// Where it sits: started by the scheduler (dailyScheduler.js) of `npm run daily` (runDaily.js):
// every day at 03:00 Israel time, and right away when a run was missed.
// Reads/writes: the database (DailyRun, BufferQueue, Mention; through the modules below), Google
// News, Ollama, the api (one signal), Discord, and data/.
//
// The steps, in order:
//   0. Wait if the 90-day collection (`npm start`) is not finished yet ("blocked": tried again later).
//   1. Start the run (the DailyRun row = the lock). The first run ever first marks every mention
//      that is already there as alerted, so the old mentions never reach Discord (D102).
//   2. Search every company for yesterday + today (dailyCollect.js), and at the same time
//      classify the new articles (dailyClassify.js). Duplicates are skipped as in the 90-day run.
//      The search goes back further when the last search is older (see dailyCollect.js); in a
//      database filled from data/ (no collection, no daily run yet) it starts from when the
//      newest mention was first seen.
//   3. New mentions = Mention rows with an empty alerted_at, counted per company.
//   4. If there are new mentions: tell the api (notifyApi.js), which makes the open dashboard
//      pages reload their data (the new mentions appear, anything older than 90 days drops out).
//   5. Send the Discord message(s) (digest.js, discord.js), also on a quiet day. After Discord
//      accepts a message, exactly the mentions it listed are marked as alerted. A message that
//      fails leaves its mentions "new", so they go out with the next run.
//   6. If there were new mentions: merge them into data/ (dailyExport.js).
//   7. End the run: 'done' (with the new-mention count, when the alert went out, and any problem
//      of steps 4–6 in last_error) or 'failed' (an unexpected error, e.g. the database).
// Problems in steps 4–6 never undo the new mentions: they are already saved in the database.
// The DailyRun and "alerted" writes (steps 1, 5, 7) are retried while the database is busy
// (retryDbWrite, D76): a busy moment right after Discord accepted a message must not fail the
// run, or the retry would send the same mentions again.

import { cleanForLog, formatCount } from '../shared/text.js';
import { retryDbWrite, sleep as realSleep } from '../shared/retry.js';
import { isProcessAlive } from '../shared/runLock.js';
import {
  DailyRunBusyError, describeOpenCollection, findLastCollectionStart, findLastDoneDailyRun, findNewestMentionSeen,
  findOpenCollection, finishDailyRun, markAlerted, readNewMentions, startDailyRun, summarizeByCompany,
} from './dailyStore.js';
import { collectDaily, dailySearchRange, describeRange } from './dailyCollect.js';
import { classifyDaily } from './dailyClassify.js';
import { buildDigestMessages } from './digest.js';
import { sendDiscordMessage } from './discord.js';
import { notifyApi } from './notifyApi.js';
import { writeDailyExport } from './dailyExport.js';
import { formatDay } from '../collector/dateWindows.js';

// The later of two ISO times (either may be null).
function laterOf(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

// Runs one daily run. Everything it talks to can be replaced in tests.
//   db             an open (read-write) database connection
//   googleClient   the Google News client (src/collector/googleNews.js)
//   classifier     the classifier (createClassifier in src/classifier/classifierLoop.js)
//   companyNames   the names in the company list now
//   notify, send   the api signal and the Discord sender
//   writeExport    writes data/ (dailyExport.js)
//   onRunStarted   told the DailyRun id once the run has started (for the Ctrl+C handler)
//   sleep          the waits (classifying, and a busy database); isAlive = the process check
// Returns { status: 'done' | 'failed' | 'blocked', runId?, newMentions?, alertSent?, error?, reason? }.
export async function runDailyJob({
  db,
  googleClient,
  classifier,
  companyNames,
  now = () => Date.now(),
  pid = process.pid,
  log = console.log,
  warn = console.warn,
  notify = () => notifyApi(),
  send = (body) => sendDiscordMessage(body, { log: warn }),
  writeExport = (options) => writeDailyExport(db, options),
  shouldStop = () => false,
  onRunStarted = () => {},
  sleep,
  isAlive = isProcessAlive,
}) {
  // A database write, retried while the database is busy (see the top).
  const write = (label, work) => retryDbWrite(work, { label, warn, wait: sleep ?? realSleep });

  // Step 0: the 90-day collection must be finished first.
  const openCollection = findOpenCollection(db);
  if (openCollection) {
    return { status: 'blocked', reason: describeOpenCollection(openCollection, { now: now(), isAlive }) };
  }
  const companyCount = db.prepare('SELECT COUNT(*) AS n FROM Company').get().n;
  if (companyCount === 0) {
    return { status: 'failed', error: 'the database has no companies yet. Start the dashboard once ("npm run dashboard" loads data/) or run "npm start", then the daily job again' };
  }

  // Step 1: start the run (the lock), and the first-run marking.
  const lastSearchStartedAt = laterOf(findLastDoneDailyRun(db)?.started_at ?? null, findLastCollectionStart(db))
    ?? findNewestMentionSeen(db); // a database filled from data/: from that snapshot on
  const startedAtMs = now();
  let started;
  try {
    started = await write('start the daily run', () => startDailyRun(db, { pid, now: new Date(startedAtMs).toISOString(), isAlive }));
  } catch (error) {
    if (error instanceof DailyRunBusyError) return { status: 'blocked', reason: error.message };
    throw error;
  }
  const { runId } = started;
  onRunStarted(runId);
  if (started.baselineMarked > 0) {
    log(`First daily run: the ${formatCount(started.baselineMarked)} mentions already in the database are marked as alerted (they are not sent to Discord).`);
  }

  try {
    // Step 2: search and classify at the same time.
    const range = dailySearchRange(startedAtMs, lastSearchStartedAt);
    log(`Daily run ${runId}: searching ${formatCount(companyNames.length)} companies for ${describeRange(range)} (UTC) ...`);
    let searchDone = false;
    let classifyError = null;
    const classifying = classifyDaily({
      db, classifier, isSearchDone: () => searchDone, shouldStop, pid, warn, now, isAlive, ...(sleep ? { sleep } : {}),
    }).catch((error) => { classifyError = error; });
    let collected;
    try {
      collected = await collectDaily({
        db, client: googleClient, range, companyNames, log, warn, shouldStop: () => shouldStop() || classifyError !== null,
      });
    } finally {
      searchDone = true;
      await classifying;
    }
    if (classifyError) throw classifyError;
    log(`Search done: ${formatCount(collected.stats.inserted)} new articles, ${formatCount(collected.stats.duplicates)} already known` +
      `${collected.failed.length ? `, ${collected.failed.length} companies could not be searched` : ''}. Classifying done.`);

    // Step 3: the new mentions.
    const newMentions = readNewMentions(db);
    const byCompany = summarizeByCompany(newMentions);
    log(`New mentions: ${formatCount(newMentions.length)} (${formatCount(byCompany.length)} companies).`);
    const problems = [];

    // Step 4: tell the api, so open dashboard pages reload.
    if (newMentions.length > 0) {
      const signal = await notify();
      if (signal.ok) log(`Dashboard told about the new data${signal.pages === null ? '' : ` (${signal.pages} open ${signal.pages === 1 ? 'page' : 'pages'})`}.`);
      else log(`The dashboard was not told (${signal.error}); it shows the new data when it is opened or refreshed.`);
    }

    // Step 5: Discord, message by message; mark each message's mentions after it was accepted.
    const messages = buildDigestMessages({ companies: byCompany, companiesInList: collected.companies, sentAt: new Date(now()) });
    let sent = 0;
    for (const message of messages) {
      const result = await send(message.payload);
      if (!result.ok) {
        problems.push(`Discord: ${result.error}`);
        warn(`The Discord message was not sent: ${result.error}. Its mentions stay "new" and go out with the next run.`);
        break;
      }
      await write('mark the sent mentions as alerted', () => markAlerted(db, message.mentionIds, { now: new Date(now()).toISOString() }));
      sent += 1;
    }
    const alertSentAt = sent === messages.length ? new Date(now()).toISOString() : null;
    if (alertSentAt) log(`Discord message sent${messages.length > 1 ? ` (${messages.length} messages)` : ''}.`);

    // Step 6: merge the new mentions into data/.
    if (newMentions.length > 0) {
      try {
        await writeExport({
          now: now(),
          companyNames,
          lastDailyRun: {
            dailyRunId: runId,
            startedAt: new Date(startedAtMs).toISOString(),
            searchedDays: { from: formatDay(range.start), to: formatDay(range.end) },
            newMentions: newMentions.length,
            companiesWithNewMentions: byCompany.length,
            alertSentAt,
            companiesNotSearched: collected.failed.map((company) => company.name),
          },
        });
        log('data/ updated with the new mentions.');
      } catch (error) {
        problems.push(`data/: ${cleanForLog(error?.message ?? error)}`);
        warn(`data/ could not be written (${cleanForLog(error?.message ?? error)}). The database has everything; the next run with new mentions writes data/ again.`);
      }
    }

    // Step 7: the run is done.
    if (collected.failed.length) problems.push(`not searched: ${collected.failed.map((company) => company.name).join(', ')}`);
    await write('finish the daily run', () => finishDailyRun(db, runId, {
      status: 'done', newMentions: newMentions.length, alertSentAt, error: problems.length ? problems.join(' | ') : null,
      now: new Date(now()).toISOString(),
    }));
    return { status: 'done', runId, newMentions: newMentions.length, alertSent: alertSentAt !== null };
  } catch (error) {
    const message = cleanForLog(error?.message ?? error, 500);
    try {
      await write('mark the daily run as failed', () => finishDailyRun(db, runId, { status: 'failed', error: message, now: new Date(now()).toISOString() }));
    } catch { /* the next start marks the cut-off run as failed */ }
    return { status: 'failed', runId, error: message };
  }
}


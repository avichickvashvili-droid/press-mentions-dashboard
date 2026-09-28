// config.js — every setting of the project in one place (D80): the data collection (collector
// and seed), the classifier (the AI step and the data/ export), the api + dashboard and the
// orchestrator (`npm start`).
//
// Where it sits: read by every other file (database, seed loader, Google News client, queue
// writer, lock, company loop, classifier, api, orchestrator). Nothing else holds a "magic number".
// Reads: the DB_PATH, LOGS_DIR, OLLAMA_URL, OLLAMA_MODEL, LLM_CONCURRENCY and API_PORT environment
// variables (all optional, from .env if present).
// Writes: nothing.
//
// To change how the program behaves, change a value here. Each value has a plain-language
// comment that says what it controls. The values are grouped by the part that uses them.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project's root folder (one level above src/). Used to find the data files.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Reads a whole number from an environment variable, or returns the default when it is
// missing or not a positive whole number.
function positiveIntegerFromEnv(name, defaultValue) {
  const text = process.env[name];
  if (text === undefined || text === '') return defaultValue;
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : defaultValue;
}

// How many articles are sent to Ollama at the same time (D45). Can be changed with LLM_CONCURRENCY in .env.
// Owner decision D74: 4, after the parallel-throughput test (research/parallel-test/results.md).
// The Ollama server must run with OLLAMA_NUM_PARALLEL set to the same number.
const LLM_CONCURRENCY = positiveIntegerFromEnv('LLM_CONCURRENCY', 4);

// The SQLite database file (see DB_PATH in the list). Worked out here because LOGS_DIR's default
// is built from it too.
const DB_PATH = process.env.DB_PATH
  ? path.resolve(PROJECT_ROOT, process.env.DB_PATH)
  : path.join(PROJECT_ROOT, 'db', 'press-mentions.sqlite');

// How many days back the collection covers (a rolling 90 days, ending on the run's start day, D1).
// Also the window of the data/ export.
const COLLECTION_DAYS = 90;

export const config = {
  // =====================================================================================
  // Shared: files, database, lock
  // =====================================================================================

  // ---------- Files ----------

  // Project root folder. Other paths below are built from it.
  PROJECT_ROOT,

  // The SQLite database file. Can be changed with the DB_PATH setting in .env.
  // The file (and its folder) is created on first use. It is never committed to git.
  DB_PATH,

  // The company list, sorted into sections ("## N. Name" headers). Read by the seed loader, and
  // by the data/ export, which only includes the companies that are in this list (D79).
  COMPANY_LIST_FILE: path.join(PROJECT_ROOT, 'filtered_ourcrowd_companies.txt'),

  // Search hints for hard company names. Read by the seed loader only.
  COMPANY_HINTS_FILE: path.join(PROJECT_ROOT, 'company_hints.json'),

  // The extra context words added to every company's search, per section. Read by the seed
  // loader; the classifier reads the full section names from it for the prompt (D58).
  SECTION_KEYWORDS_FILE: path.join(PROJECT_ROOT, 'section_keywords.json'),

  // ---------- Log files (D92) ----------

  // The folder for the log files. Inside it: one folder per run (run-5/), with one file per
  // process: orchestrator.log, collector.log, classifier.log, group-1.log, group-2.log, ...
  // By default it sits NEXT TO THE DATABASE: <folder of DB_PATH>/logs (the real database
  // db/press-mentions.sqlite -> db/logs/run-1/). So a throwaway test database (DB_PATH=...) gets
  // its own logs and never touches the real run's logs (D95, review G5).
  // Can be changed with the LOGS_DIR setting in .env (relative to the project folder). It is never
  // committed to git.
  LOGS_DIR: process.env.LOGS_DIR
    ? path.resolve(PROJECT_ROOT, process.env.LOGS_DIR)
    : path.join(path.dirname(DB_PATH), 'logs'),

  // The folder (inside LOGS_DIR) for lines written while no run exists yet at all (a fresh
  // database), e.g. logs/no-run/classifier.log.
  LOG_NO_RUN_FOLDER: 'no-run',

  // Lines written before a process knows its run folder are held in memory and written once it
  // knows it. At most this many are held; older ones are dropped (with a note in the file).
  LOG_HELD_LINES_MAX: 1000,

  // ---------- Database ----------

  // If the database is busy (another service is writing), wait up to this long before giving up.
  DB_BUSY_TIMEOUT_MS: 5000,

  // ---------- Lock + heartbeat ----------

  // How often the running collector writes "I'm alive" (JobRun.last_heartbeat): every 5 minutes.
  HEARTBEAT_MS: 300000,

  // A running job whose last heartbeat is older than this (15 minutes = 3 missed beats)
  // is treated as crashed, and a new start takes it over.
  STALE_AFTER_MS: 900000,

  // ---------- Logs ----------

  // Headlines and publisher names come from the internet. When they are printed in a log line,
  // control characters are removed and the text is cut to this many characters, so a strange
  // headline can't mess up the terminal (the stored text is not changed).
  LOG_TEXT_MAX_CHARS: 150,

  // =====================================================================================
  // Collector (the 90-day data collection) and seed
  // =====================================================================================

  // ---------- Search query ----------

  // If a built search (without the date part) has more words than this, the seed loader prints a
  // warning: Google News silently drops the last words of long searches (issue I28).
  MAX_QUERY_WORDS: 30,

  // ---------- Buffer queue ----------

  // The most articles allowed to wait in the BufferQueue table for the AI step.
  // The collector waits before adding a search result that would push the queue above this.
  CAP: 10000,

  // Once the queue is full, the collector pauses and only starts adding again when the queue
  // has gone down to this many rows (so it doesn't restart for every few rows the AI finishes).
  QUEUE_RESUME_AT: 8000,

  // While the collector is paused because the queue is full, how often it re-counts the queue.
  CAP_POLL_MS: 5000,

  // How many times the AI step may try one article (D59). A row that has been tried this many
  // times and still has no valid answer has failed for good: its status is 'failed', it is not
  // asked again, it is listed in data/run.json, it doesn't stop the run from finishing, and it no
  // longer counts toward the queue limit above (D72).
  MAX_ATTEMPTS: 3,

  // How many relevant articles are gathered before they are moved to the Mention table (D51).
  // Used by the classifier.
  MOVE_CHUNK: 1000,

  // ---------- Google News ----------

  // The Google News RSS search address. The search text and language settings are added to it.
  GOOGLE_NEWS_URL: 'https://news.google.com/rss/search',

  // Language / country settings sent with every search (English, United States).
  GOOGLE_NEWS_LANGUAGE_PARAMS: 'hl=en-US&gl=US&ceid=US:en',

  // The browser name we send to Google with each request.
  USER_AGENT: 'Mozilla/5.0',

  // The fixed pace: at most one Google request per this many milliseconds (1 per second).
  REQUEST_INTERVAL_MS: 1000,

  // A small random extra wait (0 up to this many ms) added to each pause, so requests
  // don't tick like a clock.
  REQUEST_JITTER_MS: 300,

  // How long to wait for Google to answer one request before treating it as a timeout
  // (a temporary error, retried).
  FETCH_TIMEOUT_MS: 30000,

  // Waits between retries after a temporary error (no internet, 429, 5xx, timeout, CAPTCHA page).
  // The first retry waits 5 s, the next 10 s, and so on; after the last step it keeps waiting 10 min.
  RETRY_BACKOFF_MS: [5000, 10000, 30000, 60000, 120000, 300000, 600000],

  // When Google answers "403 Forbidden" (blocked), the first FORBIDDEN_FIXED_RETRIES 403s in a
  // row each wait this fixed time (5 s) and try again (D54, D77).
  FORBIDDEN_RETRY_MS: 5000,

  // After this many 403s in a row, further 403s use the growing waits of RETRY_BACKOFF_MS
  // (5 s, 10 s, 30 s ... 10 min), so a real block is not hammered every 5 s (D77).
  // Any successful answer from Google starts the count again from 0.
  FORBIDDEN_FIXED_RETRIES: 3,

  // When Google answers "400 Bad Request" for a company's search, the same search is tried this
  // many times in total, BAD_REQUEST_WAIT_MS apart. After the last 400 the company is marked
  // 'failed' with the reason, and its group goes on with the next company (D85).
  BAD_REQUEST_RETRIES: 3,

  // The wait before trying a search again after a "400 Bad Request": 1 minute (D85).
  BAD_REQUEST_WAIT_MS: 60000,

  // ---------- Groups (D83, D84) ----------

  // About how many companies go in one group when a run starts (D83). The number of groups is
  // the number of companies divided by this, rounded to the nearest whole number, and at least 1;
  // the groups are then made as equal as possible, in list order (the first groups get one extra
  // company when it doesn't divide evenly). 258 companies -> 10 groups (8 of 26, 2 of 25);
  // 40 -> 2 groups of 20; fewer than 38 -> 1 group. Groups run one after another, each in its
  // own process.
  GROUP_TARGET_SIZE: 25,

  // A group process that crashes this many times in a row, with no company finished or failed in
  // between, is given up: the group is marked 'failed' and the next group starts (D84).
  GROUP_MAX_CRASHES_IN_A_ROW: 5,

  // A group that has failed (GROUP_MAX_CRASHES_IN_A_ROW crashes in a row with no progress) is
  // tried again this many more times, each time with a fresh count of crashes, before it stays
  // 'failed' and the runner moves on to the next group (D97, replaces D95's "3 failed groups in a
  // row stop the runner"). 3 -> the group can fail 4 times in all.
  GROUP_FAILED_RETRIES: 3,

  // A company that was being fetched when its group process crashed or was killed as stuck this
  // many times is marked 'failed' ("crashed the group process 3 times") and the group goes on with
  // its next company (D97). One bad feed can then no longer fail the rest of its group. Marking it
  // 'failed' this way does NOT count as progress for the group's crash count.
  COMPANY_MAX_GROUP_CRASHES: 3,

  // Waits before the group runner starts a crashed group process again: 1 s, 2 s, 5 s, 10 s,
  // 30 s, then every 30 s (D84). The wait grows so a broken group doesn't restart in a tight loop.
  GROUP_RESTART_WAITS_MS: [1000, 2000, 5000, 10000, 30000],

  // A group process tells the runner "still alive" whenever it works: before each Google request,
  // on every queue check while the queue is full, and every 30 s while it waits to retry Google.
  // If the runner hears nothing for this long (5 minutes), the group process is stuck: the runner
  // kills it and counts a crash (D90). Waiting for the queue or for Google is never "stuck".
  GROUP_STUCK_AFTER_MS: 300000,

  // While a group process waits to try Google again (one wait can last up to 10 min), it tells
  // the runner "still fetching" this often: every 30 s (D90).
  GROUP_ALIVE_EVERY_MS: 30000,

  // On a stop, the group runner asks its group process to stop and waits at most this long (6 s)
  // before it force-kills it. It must be SHORTER than the orchestrator's STOP_TIMEOUT_MS (10 s,
  // below), so the runner always has time to kill its group process and write its emergency
  // heartbeat before the orchestrator force-kills the runner (review G6). On Windows a force-kill
  // of the runner does not kill its group process, which would be left running on its own.
  GROUP_STOP_TIMEOUT_MS: 6000,

  // ---------- Date windows ----------

  // How many days back the collection covers (see COLLECTION_DAYS above the list).
  COLLECTION_DAYS,

  // A search that returns at least this many articles probably hit Google's ~100 limit.
  SPLIT_THRESHOLD: 95,

  // The smallest date window, in days.
  MIN_WINDOW_DAYS: 1,

  // =====================================================================================
  // Classifier (the AI step) and the data/ export
  // =====================================================================================

  // ---------- Ollama ----------

  // Where the local Ollama server listens.
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',

  // The model that answers "is this headline about the company, and what is its tone?" (D49).
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen3:4b',

  // How long Ollama keeps the model in GPU memory after the last request.
  OLLAMA_KEEP_ALIVE: '30m',

  // How long to wait for one answer (covers a cold model load). If it takes longer, that one
  // request has failed (see D75 below for what happens then).
  OLLAMA_TIMEOUT_MS: 120000,

  // The most words ("tokens") the model may write for one answer (D75). A valid answer is under
  // 20 tokens, so an answer that rambles on is cut short and becomes a quick invalid answer
  // instead of running until the timeout.
  OLLAMA_NUM_PREDICT: 64,

  // When one request fails (timeout or HTTP error), the classifier asks Ollama for its version to
  // tell "Ollama is down" from "this one request failed" (D75). This is how long that quick check
  // may take.
  OLLAMA_REACHABLE_CHECK_TIMEOUT_MS: 5000,

  // Waits between retries while Ollama is down (not reachable) or its start-up check fails:
  // 2 s, 5 s, 10 s, 30 s, 60 s, then every 60 s. The classifier never gives up or exits over this.
  OLLAMA_BACKOFF_MS: [2000, 5000, 10000, 30000, 60000],

  // Waits before trying again after a classifier pass failed for a reason that is not Ollama
  // (e.g. the data/ files could not be written): 2 s, 5 s, 10 s, 30 s, 60 s, then every 60 s.
  // Kept apart from the Ollama waits so the two problems don't share one counter.
  PASS_ERROR_BACKOFF_MS: [2000, 5000, 10000, 30000, 60000],

  // If the data/ export after a group fails (e.g. a data/ file stays locked by OneDrive or an
  // antivirus), that group's export is tried again only after this long: 5 minutes. The failure
  // is one warning, and the classifier keeps classifying meanwhile; the end of the run writes
  // data/ anyway (review G2).
  GROUP_EXPORT_RETRY_MS: 5 * 60 * 1000,

  // ---------- Answers and retries (D27, D59) ----------

  LLM_CONCURRENCY,

  // How many times one article is asked in one attempt before the attempt counts as failed
  // (1 try + 1 retry on an invalid answer, as in the model test).
  LLM_TRIES_PER_ATTEMPT: 2,

  // ---------- Claiming rows (D45, D78) ----------

  // How many BufferQueue rows are taken in one go (4 per parallel request). The answers of one
  // batch are saved together in one transaction. Rows marked "suspect" after a crash are always
  // taken one at a time instead (D78).
  CLAIM_BATCH: 4 * LLM_CONCURRENCY,

  // A claim older than this (10 minutes) is treated as abandoned and the row is given back.
  CLAIM_TIMEOUT_MS: 10 * 60 * 1000,

  // When there is nothing to do, how long to wait before looking at the queue again.
  CLASSIFIER_POLL_MS: 5000,

  // How often the classifier prints its progress line.
  PROGRESS_EVERY_MS: 30000,

  // How often that progress line (the speed line) is also written to classifier.log (D93): the
  // terminal shows it every 30 s, the log file only every 10 min, to keep the file short.
  CLASSIFIER_FILE_STATUS_EVERY_MS: 10 * 60 * 1000,

  // ---------- Section names for the prompt (D58) ----------

  // Section 13 has no entry in section_keywords.json; this is its name from the company list file.
  UNSORTED_SECTION_NAME: 'Unsorted (line of business not confirmed)',

  // ---------- data/ export (D20, D41, D64) ----------

  // The folder the end-of-run snapshot is written to (committed to git).
  DATA_DIR: path.join(PROJECT_ROOT, 'data'),

  // The rolling window the export covers, in days (the "last quarter", D1): the collection's 90 days.
  EXPORT_WINDOW_DAYS: COLLECTION_DAYS,

  // Renaming a finished ".tmp" file over the old data/ file can fail for a moment on Windows when
  // another program (antivirus, OneDrive, an editor) has the file open. The rename is tried this
  // many times, EXPORT_RENAME_RETRY_MS apart, before the export counts as failed.
  EXPORT_RENAME_TRIES: 5,
  EXPORT_RENAME_RETRY_MS: 200,

  // =====================================================================================
  // API + dashboard (Step 5, `src/api/`)
  // =====================================================================================

  // The port the api (and the dashboard page) listens on: http://localhost:3000.
  // Can be changed with the API_PORT setting in .env (e.g. when port 3000 is taken).
  API_PORT: positiveIntegerFromEnv('API_PORT', 3000),

  // The rolling window the dashboard shows, in days (the "last quarter", D1): the same 90 days as
  // the collection and the data/ export. Worked out again on every request (D13, NFR5).
  DASHBOARD_WINDOW_DAYS: COLLECTION_DAYS,

  // The built dashboard page (made by the Vite build) that the api serves.
  WEB_DIST_DIR: path.join(PROJECT_ROOT, 'web', 'dist'),

  // =====================================================================================
  // Orchestrator (`npm start`, the supervisor). These values are fixed here on purpose; they
  // are not read from .env (D69).
  // =====================================================================================

  // Waits before restarting a crashed service: 1 s, 2 s, 5 s, 10 s, 30 s, 60 s,
  // then every 60 s (D69). The wait grows so a broken service doesn't restart in a tight loop.
  RESTART_BACKOFF_MS: [1000, 2000, 5000, 10000, 30000, 60000],

  // A service that stayed up this long before crashing starts again from the first (shortest)
  // wait: 5 minutes. A crash after a long healthy run is treated as a fresh, one-off crash.
  STABLE_UPTIME_MS: 5 * 60 * 1000,

  // Give up on a service after MORE than this many crashes inside CRASH_WINDOW_MS (D69, I18):
  // the 6th crash within 10 minutes stops the restarts for that service only.
  MAX_CRASHES: 5,
  CRASH_WINDOW_MS: 10 * 60 * 1000,

  // When a service ends with the Ctrl+C / stop code (130 / 143), wait this long before deciding
  // what it means. On Ctrl+C, Windows (and a terminal) tells every process at the same time, so a
  // service can end a moment before the orchestrator hears its own Ctrl+C. Waiting briefly
  // avoids a wrong "crashed, restarting" line during a normal stop.
  STOP_SIGNAL_GRACE_MS: 1000,

  // On Ctrl+C / stop, each service is asked to stop cleanly (it writes its emergency heartbeat,
  // D48a, D70). A service still running after this long is force-killed as a last resort: 10 s.
  STOP_TIMEOUT_MS: 10000,

  // How many of a service's last error lines are shown when the orchestrator gives up on it.
  ERROR_LINES_KEPT: 5,
};

// config.js — every setting of the project in one place (D80): the data collection (collector
// and seed), the classifier (the AI step and the data/ export) and the orchestrator (`npm start`).
//
// Where it sits: read by every other file (database, seed loader, Google News client, queue
// writer, lock, company loop, classifier, orchestrator). Nothing else holds a "magic number".
// Reads: the DB_PATH, OLLAMA_URL, OLLAMA_MODEL and LLM_CONCURRENCY environment variables
// (all optional, from .env if present).
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
  DB_PATH: process.env.DB_PATH
    ? path.resolve(PROJECT_ROOT, process.env.DB_PATH)
    : path.join(PROJECT_ROOT, 'db', 'press-mentions.sqlite'),

  // The company list, sorted into sections ("## N. Name" headers). Read by the seed loader, and
  // by the data/ export, which only includes the companies that are in this list (D79).
  COMPANY_LIST_FILE: path.join(PROJECT_ROOT, 'filtered_ourcrowd_companies.txt'),

  // Search hints for hard company names. Read by the seed loader only.
  COMPANY_HINTS_FILE: path.join(PROJECT_ROOT, 'company_hints.json'),

  // The extra context words added to every company's search, per section. Read by the seed
  // loader; the classifier reads the full section names from it for the prompt (D58).
  SECTION_KEYWORDS_FILE: path.join(PROJECT_ROOT, 'section_keywords.json'),

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

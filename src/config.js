// config.js — every setting of the data collection (DC) in one place.
//
// Where it sits: read by every other file (database, seed loader, Google News
// client, queue writer, lock, company loop). Nothing else holds a "magic number".
// Reads: the DB_PATH environment variable (optional, from .env if present).
// Writes: nothing.
//
// To change how the collector behaves, change a value here. Each value has a
// plain-language comment that says what it controls.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project's root folder (one level above src/). Used to find the data files.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  // ---------- Files ----------

  // Project root folder. Other paths below are built from it.
  PROJECT_ROOT,

  // The SQLite database file. Can be changed with the DB_PATH setting in .env.
  // The file (and its folder) is created on first use. It is never committed to git.
  DB_PATH: process.env.DB_PATH
    ? path.resolve(PROJECT_ROOT, process.env.DB_PATH)
    : path.join(PROJECT_ROOT, 'db', 'press-mentions.sqlite'),

  // The company list, sorted into sections ("## N. Name" headers). Read by the seed loader only.
  COMPANY_LIST_FILE: path.join(PROJECT_ROOT, 'filtered_ourcrowd_companies.txt'),

  // Search hints for hard company names. Read by the seed loader only.
  COMPANY_HINTS_FILE: path.join(PROJECT_ROOT, 'company_hints.json'),

  // The extra context words added to every company's search, per section. Read by the seed loader only.
  SECTION_KEYWORDS_FILE: path.join(PROJECT_ROOT, 'section_keywords.json'),

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

  // How many times the AI step may try one article. A row with status 'failed' that has been
  // tried this many times has failed for good: it stays in BufferQueue but no longer counts
  // toward the queue limit above (D72). The classifier reads this value from here too.
  MAX_ATTEMPTS: 3,

  // How many relevant articles are gathered before they are moved to the Mention table.
  // Used by the classifier (not by the collector); kept here so all settings live in one file.
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

  // When Google answers "403 Forbidden", we wait this fixed time and try again
  // (instead of the growing waits above).
  FORBIDDEN_RETRY_MS: 5000,

  // ---------- Date windows ----------

  // How many days back the collection covers (a rolling 90 days, ending on the run's start day).
  COLLECTION_DAYS: 90,

  // A search that returns at least this many articles probably hit Google's ~100 limit.
  SPLIT_THRESHOLD: 95,

  // The smallest date window, in days.
  MIN_WINDOW_DAYS: 1,

  // ---------- Lock + heartbeat ----------

  // How often the running collector writes "I'm alive" (JobRun.last_heartbeat): every 5 minutes.
  HEARTBEAT_MS: 300000,

  // A running job whose last heartbeat is older than this (15 minutes = 3 missed beats)
  // is treated as crashed, and a new start takes it over.
  STALE_AFTER_MS: 900000,

  // ---------- Database ----------

  // If the database is busy (another service is writing), wait up to this long before giving up.
  DB_BUSY_TIMEOUT_MS: 5000,
};

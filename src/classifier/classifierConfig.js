// classifierConfig.js — every setting of the classifier (the AI step) in one place.
//
// Where it sits: read by every file in src/classifier/. It sits next to the shared
// src/config.js (database path, MOVE_CHUNK, heartbeat times), which the classifier also reads.
// These values live here for now so the classifier does not edit the collector's config file;
// they can be merged into src/config.js later (PLAN Q16).
// Reads: the OLLAMA_URL, OLLAMA_MODEL and LLM_CONCURRENCY environment variables (optional, from .env).
// Writes: nothing.
//
// To change how the classifier behaves, change a value here. Each value says what it controls.

import path from 'node:path';
import { config } from '../config.js';

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

export const classifierConfig = {
  // ---------- Ollama ----------

  // Where the local Ollama server listens.
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',

  // The model that answers "is this headline about the company, and what is its tone?" (D49).
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen3:4b',

  // How long Ollama keeps the model in GPU memory after the last request.
  OLLAMA_KEEP_ALIVE: '30m',

  // How long to wait for one answer before treating Ollama as "down or stuck" (covers a cold model load).
  OLLAMA_TIMEOUT_MS: 120000,

  // Waits between retries while Ollama is down, slow or answering with an error:
  // 2 s, 5 s, 10 s, 30 s, 60 s, then every 60 s. The classifier never gives up or exits over this.
  OLLAMA_BACKOFF_MS: [2000, 5000, 10000, 30000, 60000],

  // ---------- Answers and retries (D27, D59) ----------

  LLM_CONCURRENCY,

  // How many times one article is asked in one attempt before the attempt counts as failed
  // (1 try + 1 retry on an invalid answer, as in the model test).
  LLM_TRIES_PER_ATTEMPT: 2,

  // After this many failed attempts an article stays 'failed' for good: it is not asked again,
  // it is listed in data/run.json, and it does not stop the run from finishing.
  // The value lives in the shared src/config.js (the collector's queue count uses it too, D72).
  MAX_ATTEMPTS: config.MAX_ATTEMPTS,

  // ---------- Claiming rows (D45) ----------

  // How many BufferQueue rows are taken in one go (4 per parallel request). The answers of one
  // batch are saved together in one transaction.
  CLAIM_BATCH: 4 * LLM_CONCURRENCY,

  // A claim older than this (10 minutes) is treated as abandoned and the row is given back.
  CLAIM_TIMEOUT_MS: 10 * 60 * 1000,

  // When there is nothing to do, how long to wait before looking at the queue again.
  CLASSIFIER_POLL_MS: 5000,

  // How often the classifier prints its progress line.
  PROGRESS_EVERY_MS: 30000,

  // ---------- Section names for the prompt (D58) ----------

  // The file with the full section names ("Health (Healthcare & Biotechnology)"); shared with the seed loader.
  SECTION_KEYWORDS_FILE: config.SECTION_KEYWORDS_FILE,

  // Section 13 has no entry in section_keywords.json; this is its name from the company list file.
  UNSORTED_SECTION_NAME: 'Unsorted (line of business not confirmed)',

  // ---------- data/ export (D20, D41, D64) ----------

  // The folder the end-of-run snapshot is written to (committed to git).
  DATA_DIR: path.join(config.PROJECT_ROOT, 'data'),

  // The rolling window the export covers, in days (the "last quarter", D1).
  EXPORT_WINDOW_DAYS: config.COLLECTION_DAYS,
};

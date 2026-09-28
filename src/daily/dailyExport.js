// dailyExport.js — merges a daily run into the data/ folder (D106, Prompt 292).
//
// Where it sits: a step of dailyJob.js, after the Discord message, only when the run had new
// mentions. Reads: the database (through the exporter), the company list file, and the current
// data/run.json. Writes: data/companies.json,
// data/mentions.json, data/run.json.
//
// "Merge" needs no special code: the exporter (src/classifier/exporter.js) always writes a FULL
// snapshot of the database for the last 90 days. So after a daily run, mentions.json has the old
// mentions plus the new ones (each with its sentiment and alertedAt), and companies.json has every
// company's new totals, status and days ago. Mentions older than 90 days leave the files, but stay
// in the database (D13).
// run.json keeps describing the 90-day collection and gets a `lastDailyRun` part: when it ran, the days it searched, how many were new, whether
// the alert went out, which companies could not be searched.
// The collection's times are NOT the export time: when the current run.json describes the same
// collection (same runId), its `collectedAt` and `finishedAt` are kept as they are. Otherwise
// both are the collection's end (JobRun.finished_at): once the run is 'done', the database no
// longer knows when the collecting itself ended, so its finish time is used (owner, Prompt 298).
// A database that was filled from data/ (a fresh clone, D35) has no collection row: then the
// collection part of the current run.json is kept as it is.
// The files are written crash-safely by the exporter (".tmp" first, then renamed, run.json last).

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { buildExport, writeExportFiles } from '../classifier/exporter.js';
import { readCompanyNames } from '../shared/companyList.js';

// A stand-in collection row, used only to build companies.json and mentions.json when the
// database has no finished collection (its run.json part is replaced below).
const NO_COLLECTION = { id: -1, started_at: null, finished_at: null, classified_count: 0, relevant_count: 0, irrelevant_count: 0, failed_count: 0 };

// Reads the current data/run.json, or {} when it is missing or unreadable.
function readCurrentRunJson(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'run.json'), 'utf8'));
  } catch {
    return {};
  }
}

// Builds the three files after a daily run. Read-only (the database and data/run.json).
// `lastDailyRun` = the summary of this daily run (see the top).
export function buildDailyExport(db, {
  now = Date.now(),
  lastDailyRun,
  companyNames = readCompanyNames(config.COMPANY_LIST_FILE),
  dataDir = config.DATA_DIR,
}) {
  const collection = db.prepare("SELECT * FROM JobRun WHERE status = 'done' ORDER BY id DESC LIMIT 1").get();
  const files = buildExport(db, { run: collection ?? NO_COLLECTION, now, companyNames });
  const asOf = files['companies.json'].asOf;

  const current = readCurrentRunJson(dataDir);
  let runJson;
  if (!collection) {
    runJson = { ...current, asOf, mentionsInWindow: files['mentions.json'].mentions.length };
  } else if (current.runId === collection.id) {
    runJson = { ...files['run.json'], collectedAt: current.collectedAt ?? null, finishedAt: current.finishedAt ?? collection.finished_at };
  } else {
    runJson = { ...files['run.json'], collectedAt: collection.finished_at, finishedAt: collection.finished_at };
  }
  runJson.asOf = asOf; // the same time as the other two files (crash safety, see exporter.js)
  runJson.lastDailyRun = lastDailyRun;
  return { ...files, 'run.json': runJson };
}

// Builds and writes the files. Throws if they can't be written (the caller logs it; the database
// already has everything, so the next daily run with new mentions writes data/ again).
// Returns the paths written.
export async function writeDailyExport(db, { dataDir = config.DATA_DIR, writeOptions = {}, ...options }) {
  return writeExportFiles(buildDailyExport(db, { dataDir, ...options }), { dataDir, ...writeOptions });
}

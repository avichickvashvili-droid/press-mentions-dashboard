// exporter.js — writes the snapshot of the results to the data/ folder (D20, D35, D41, D64, D79, D86).
//
// Where it sits: written after each group of the collection has ended and its articles are
// classified (D86), and once more as the last step of a run, after the queue is drained and the
// leftovers are moved to Mention, before the run is marked 'done'. The api imports these files
// when its database is empty, and a reviewer can read them on GitHub.
// Reads: Company, Mention, JobRun, JobRunCompany, JobRunGroup, BufferQueue (articles that failed
// for good), and the company list file (which companies are in the list now).
// Writes: data/companies.json, data/mentions.json, data/run.json.
//
// A full snapshot every time, not an append. Only companies that are in the company list NOW
// are exported, with their mentions (D79): a company removed from the list (or renamed) keeps
// its rows in the database (nothing is ever deleted, D46) but is no longer in data/.
// "daysAgo" is a snapshot as of `asOf`; the live dashboard recomputes it.
// run.json also shows the groups (D86): { total, complete: [numbers], failed: [numbers],
// exported: how many groups' results are in this snapshot }, and failedCompanies: [names].
// After a group (the run is still being collected or classified) `finishedAt` is null; at the end of the run it
// is the time the run becomes 'done'. `asOf` is always the time of this snapshot.
//
// Crash safety (D41): every file is first written as "<name>.tmp", then each one is renamed over
// the old file; a rename is all-or-nothing, so a crash never leaves half a file. The renames go
// in a fixed order with run.json LAST: companies.json and mentions.json carry `asOf` and run.json
// carries the same time as `asOf`, so a run.json from this export means the other two
// files are from it too. On Windows a rename can fail for a moment while another program
// (antivirus, OneDrive, an editor) has the file open; it is tried EXPORT_RENAME_TRIES times,
// EXPORT_RENAME_RETRY_MS apart. If it still fails, the export throws and the run is not 'done'
// (the classifier tries the whole export again later).

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { readCompanyNames } from '../shared/companyList.js';
import { sleep as realSleep } from '../shared/retry.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Rename errors that usually mean "another program has the file open right now" (worth retrying).
const TEMPORARY_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);

// Whole days between a mention's date and the snapshot time (never below 0).
function daysBetween(fromIso, toMs) {
  return Math.max(0, Math.floor((toMs - Date.parse(fromIso)) / DAY_MS));
}

// Builds the three files' contents from the database. Read-only.
// `run` is the JobRun row being exported; `now` is the snapshot time (at the end of the run: the
// time the run becomes 'done').
// `companyNames` = the names in the company list now (default: read from COMPANY_LIST_FILE);
// only those companies and their mentions are exported (D79).
// `exportingGroup` = the number of the group this snapshot follows (after-group export, D86), or
// null for the end-of-run export, which covers every group.
export function buildExport(db, {
  run,
  now = Date.now(),
  exportingGroup = null,
  windowDays = config.EXPORT_WINDOW_DAYS,
  model = config.OLLAMA_MODEL,
  maxAttempts = config.MAX_ATTEMPTS,
  companyNames = readCompanyNames(config.COMPANY_LIST_FILE),
}) {
  const asOf = new Date(now).toISOString();
  const windowStart = new Date(now - windowDays * DAY_MS).toISOString();
  const inList = new Set(companyNames);

  // --- mentions.json: every relevant mention in the window, by company, newest first ---
  const mentionRows = db.prepare(`
    SELECT m.company_id, c.name AS company_name, m.guid, m.title, m.url, m.publisher, m.published_at,
           m.first_seen_at, m.sentiment, m.alerted_at
    FROM Mention m JOIN Company c ON c.id = m.company_id
    WHERE m.published_at >= ?
    ORDER BY c.name COLLATE NOCASE, m.published_at DESC, m.id`).all(windowStart);
  const mentions = mentionRows.filter((row) => inList.has(row.company_name)).map((row) => ({
    companyId: row.company_id,
    companyName: row.company_name,
    guid: row.guid,
    title: row.title,
    url: row.url,
    publisher: row.publisher,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    sentiment: row.sentiment,
    alertedAt: row.alerted_at,
  }));

  // --- companies.json: every company in the list (also those with no coverage) with its status ---
  const perCompany = new Map();
  for (const mention of mentions) {
    const entry = perCompany.get(mention.companyId) ?? { count: 0, last: null, sentimentCounts: { positive: 0, neutral: 0, negative: 0 } };
    entry.count += 1;
    entry.sentimentCounts[mention.sentiment] += 1;
    if (entry.last === null || mention.publishedAt > entry.last) entry.last = mention.publishedAt;
    perCompany.set(mention.companyId, entry);
  }
  const companyRows = db.prepare('SELECT id, name, section, hint FROM Company ORDER BY name COLLATE NOCASE').all()
    .filter((company) => inList.has(company.name));
  const companies = companyRows.map((company) => {
    const entry = perCompany.get(company.id);
    return {
      id: company.id,
      name: company.name,
      section: company.section,
      hint: company.hint,
      status: entry ? 'mentioned' : 'no_coverage',
      lastMentionAt: entry ? entry.last : null,
      daysAgo: entry ? daysBetween(entry.last, now) : null,
      mentionCount: entry ? entry.count : 0,
      sentimentCounts: entry ? entry.sentimentCounts : { positive: 0, neutral: 0, negative: 0 },
    };
  });

  // --- run.json: what this run did ---
  const checklist = db.prepare(`SELECT j.company_id, c.name, j.status, j.error FROM JobRunCompany j JOIN Company c ON c.id = j.company_id
                                WHERE j.run_id = ? ORDER BY c.name COLLATE NOCASE`).all(run.id);
  const failedArticles = db.prepare(`SELECT b.company_id, b.guid, b.title, b.publisher, b.attempts FROM BufferQueue b
                                     WHERE b.status = 'failed' AND b.attempts >= ? ORDER BY b.id`).all(maxAttempts)
    .map((row) => ({ companyId: row.company_id, guid: row.guid, title: row.title, publisher: row.publisher, attempts: row.attempts }));
  const groupRows = db.prepare('SELECT group_number, status, exported_at FROM JobRunGroup WHERE run_id = ? ORDER BY group_number').all(run.id);
  const groups = {
    total: groupRows.length,
    complete: groupRows.filter((row) => row.status === 'complete').map((row) => row.group_number),
    failed: groupRows.filter((row) => row.status === 'failed').map((row) => row.group_number),
    exported: exportingGroup === null
      ? groupRows.length
      : groupRows.filter((row) => row.exported_at !== null || row.group_number === exportingGroup).length,
  };
  const runSummary = {
    runId: run.id,
    asOf,
    startedAt: run.started_at,
    collectedAt: run.finished_at ?? null,
    finishedAt: exportingGroup === null ? asOf : null,
    model,
    groups,
    failedCompanies: checklist.filter((row) => row.status === 'failed').map((row) => row.name),
    companies: {
      total: checklist.length,
      finished: checklist.filter((row) => row.status === 'finished').length,
      failed: checklist.filter((row) => row.status === 'failed').map((row) => ({ id: row.company_id, name: row.name, error: row.error })),
    },
    counts: {
      classified: run.classified_count,
      relevant: run.relevant_count,
      irrelevantDeleted: run.irrelevant_count,
      failedPermanently: run.failed_count,
    },
    failedArticles,
    mentionsInWindow: mentions.length,
  };

  return {
    'companies.json': { asOf, windowStart, windowDays, companies },
    'mentions.json': { asOf, windowStart, mentions },
    'run.json': runSummary,
  };
}

// The order the files are renamed in: every file in the given order, but run.json last
// (see "Crash safety" at the top).
function renameOrder(fileNames) {
  return [...fileNames.filter((name) => name !== 'run.json'), ...fileNames.filter((name) => name === 'run.json')];
}

// Renames one finished ".tmp" file over the old file. A temporary error ("the file is open in
// another program") is tried again up to `tries` times, `retryMs` apart; then it is thrown.
async function renameWithRetry(tmpPath, finalPath, { rename, sleep, tries, retryMs }) {
  for (let tryNumber = 1; ; tryNumber += 1) {
    try {
      rename(tmpPath, finalPath);
      return;
    } catch (error) {
      if (!TEMPORARY_RENAME_ERRORS.has(error?.code) || tryNumber >= tries) throw error;
      await sleep(retryMs);
    }
  }
}

// Writes the files crash-safely: all ".tmp" files first, then each one renamed over the old
// file, run.json last (see "Crash safety" at the top). Creates the folder if it is missing.
// Throws if anything fails (the run then isn't 'done'). `rename` and `sleep` can be replaced in
// tests. Returns the final paths in the order they were renamed.
export async function writeExportFiles(files, {
  dataDir = config.DATA_DIR,
  rename = fs.renameSync,
  sleep = realSleep,
  tries = config.EXPORT_RENAME_TRIES,
  retryMs = config.EXPORT_RENAME_RETRY_MS,
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const order = renameOrder(Object.keys(files));
  for (const name of order) {
    fs.writeFileSync(path.join(dataDir, `${name}.tmp`), `${JSON.stringify(files[name], null, 2)}\n`);
  }
  const written = [];
  for (const name of order) {
    const finalPath = path.join(dataDir, name);
    await renameWithRetry(path.join(dataDir, `${name}.tmp`), finalPath, { rename, sleep, tries, retryMs });
    written.push(finalPath);
  }
  return written;
}

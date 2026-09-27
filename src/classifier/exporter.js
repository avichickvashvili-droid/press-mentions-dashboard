// exporter.js — writes the end-of-run snapshot to the data/ folder (D20, D35, D41, D64).
//
// Where it sits: the last step of a run, after the queue is drained and the leftovers are moved
// to Mention, and before the run is marked 'done'. The api imports these files when its database
// is empty, and a reviewer can read them on GitHub.
// Reads: Company, Mention, JobRun, JobRunCompany, BufferQueue (articles that failed for good).
// Writes: data/companies.json, data/mentions.json, data/run.json.
//
// A full snapshot every time, not an append. Each file is first written as "<name>.tmp" and then
// renamed over the old file; a rename is all-or-nothing, so a crash never leaves half a file.
// "daysAgo" is a snapshot as of `asOf`; the live dashboard recomputes it.

import fs from 'node:fs';
import path from 'node:path';
import { classifierConfig } from './classifierConfig.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days between a mention's date and the snapshot time (never below 0).
function daysBetween(fromIso, toMs) {
  return Math.max(0, Math.floor((toMs - Date.parse(fromIso)) / DAY_MS));
}

// Builds the three files' contents from the database. Read-only.
// `run` is the JobRun row being finished; `finishedAt` is the time the run becomes 'done'.
export function buildExport(db, { run, now = Date.now(), windowDays = classifierConfig.EXPORT_WINDOW_DAYS, model = classifierConfig.OLLAMA_MODEL, maxAttempts = classifierConfig.MAX_ATTEMPTS }) {
  const asOf = new Date(now).toISOString();
  const windowStart = new Date(now - windowDays * DAY_MS).toISOString();

  // --- mentions.json: every relevant mention in the window, by company, newest first ---
  const mentionRows = db.prepare(`
    SELECT m.company_id, c.name AS company_name, m.guid, m.title, m.url, m.publisher, m.published_at,
           m.first_seen_at, m.sentiment, m.alerted_at
    FROM Mention m JOIN Company c ON c.id = m.company_id
    WHERE m.published_at >= ?
    ORDER BY c.name COLLATE NOCASE, m.published_at DESC, m.id`).all(windowStart);
  const mentions = mentionRows.map((row) => ({
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

  // --- companies.json: every company (also those with no coverage) with its status ---
  const perCompany = new Map();
  for (const mention of mentions) {
    const entry = perCompany.get(mention.companyId) ?? { count: 0, last: null, sentimentCounts: { positive: 0, neutral: 0, negative: 0 } };
    entry.count += 1;
    entry.sentimentCounts[mention.sentiment] += 1;
    if (entry.last === null || mention.publishedAt > entry.last) entry.last = mention.publishedAt;
    perCompany.set(mention.companyId, entry);
  }
  const companies = db.prepare('SELECT id, name, section, hint FROM Company ORDER BY name COLLATE NOCASE').all().map((company) => {
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
  const runSummary = {
    runId: run.id,
    startedAt: run.started_at,
    collectedAt: run.finished_at ?? null,
    finishedAt: asOf,
    model,
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

// Writes the files crash-safely: all ".tmp" files first, then each one renamed over the old file.
// Creates the folder if it is missing. Throws if anything fails (the run then isn't 'done').
export function writeExportFiles(files, { dataDir = classifierConfig.DATA_DIR } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const written = [];
  for (const [name, content] of Object.entries(files)) {
    const tmpPath = path.join(dataDir, `${name}.tmp`);
    fs.writeFileSync(tmpPath, `${JSON.stringify(content, null, 2)}\n`);
    written.push({ tmpPath, finalPath: path.join(dataDir, name) });
  }
  for (const { tmpPath, finalPath } of written) fs.renameSync(tmpPath, finalPath);
  return written.map(({ finalPath }) => finalPath);
}

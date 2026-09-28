// importData.js — loads the committed data/ folder into an EMPTY database, so a fresh clone
// shows the committed real run on the dashboard without running Google News or Ollama (D35).
//
// Where it sits: called once by the api at start-up (src/api/runApi.js), before it serves
// anything. This is the ONLY place where the api writes to the database.
// Reads: data/mentions.json and data/companies.json, the company list files (through the seed
// loader: filtered_ourcrowd_companies.txt, company_hints.json, section_keywords.json), and the
// Mention, BufferQueue and JobRun tables (the "is it empty?" check).
// Writes: the Company and Mention tables, in ONE transaction (all or nothing).
//
// Rules (owner-approved, Phase 0 answers):
//   - "Empty" = Mention, BufferQueue and JobRun all have 0 rows. Company rows alone (e.g. after
//     `npm run seed`) still count as empty. A database that has any of them is never touched,
//     so old mentions are never mixed into a collection that has started.
//   - The Company rows are built from the company list files by the seed loader's own code, so
//     every row gets the same search text (query_param) a real run gives it. companies.json is
//     only checked to be readable; its rows are not used.
//   - Every mention of mentions.json is imported as it is. run.json is NOT imported: a JobRun
//     row would make `npm start` think a collection already finished (D67).
//   - A mention whose company is not in the company list is skipped (one warning with the count).
//   - Anything malformed (missing file, bad JSON, an item with a missing or wrong field, a date
//     not in ISO form, a url that is not http(s), a duplicate) stops the import with a clear message naming the file and the item number,
//     and nothing is saved.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { inTransaction } from '../db/database.js';
import { readCompaniesFromFiles, writeCompanies } from '../seed/seedLoader.js';

const SENTIMENTS = new Set(['positive', 'negative', 'neutral']);

// The error for a data/ folder that can't be imported. The message is written for a person.
export class DataImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataImportError';
  }
}

// True when the database has no mentions, no queued articles and no runs (see the rules above).
export function isDatabaseEmpty(db) {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return count('Mention') === 0 && count('BufferQueue') === 0 && count('JobRun') === 0;
}

// Reads and parses one JSON file of the data/ folder, or stops with a clear message.
function readDataFile(dataDir, fileName) {
  const filePath = path.join(dataDir, fileName);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new DataImportError(`Cannot read ${filePath}: ${error.code === 'ENOENT' ? 'the file is missing' : error.message}.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DataImportError(`${filePath} is not valid JSON: ${error.message}`);
  }
}

// True only for a date in the exact ISO form every date column uses (e.g.
// "2026-09-20T12:00:00.000Z"). Other forms such as "Sun, 01 Mar 2026 08:00:00 GMT" or
// "+03:00" offsets are refused: the window and the latest date are compared as text, so they
// would silently give wrong counts and "days ago" values.
function isDateText(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

// True only for a web address (http or https). Anything else (data:, file:, javascript:, ...)
// must never become a link on the page.
function isWebAddress(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false; // not an address at all
  }
}

// Checks one item of mentions.json and returns it as a Mention row. Stops with a clear message
// (file + item number, counting from 1) if a field is missing or wrong.
function toMentionRow(item, itemNumber) {
  const problem = (text) => new DataImportError(`data/mentions.json, item ${itemNumber}: ${text}`);
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw problem('is not an object.');
  for (const field of ['companyId', 'guid', 'url', 'title']) {
    if (typeof item[field] !== 'string' || item[field].trim() === '') throw problem(`"${field}" is missing or not text.`);
  }
  if (!isWebAddress(item.url)) throw problem('"url" must be a web address starting with http:// or https://.');
  if (item.publisher !== null && item.publisher !== undefined && typeof item.publisher !== 'string') throw problem('"publisher" must be text or null.');
  if (!isDateText(item.publishedAt)) throw problem('"publishedAt" is missing or not a date in ISO form (e.g. 2026-09-20T12:00:00.000Z).');
  if (!isDateText(item.firstSeenAt)) throw problem('"firstSeenAt" is missing or not a date in ISO form (e.g. 2026-09-20T12:00:00.000Z).');
  if (!SENTIMENTS.has(item.sentiment)) throw problem('"sentiment" must be positive, negative or neutral.');
  if (item.alertedAt !== null && item.alertedAt !== undefined && !isDateText(item.alertedAt)) throw problem('"alertedAt" must be a date in ISO form (e.g. 2026-09-20T12:00:00.000Z) or null.');
  return {
    companyId: item.companyId,
    guid: item.guid,
    url: item.url,
    title: item.title,
    publisher: item.publisher ?? null,
    publishedAt: item.publishedAt,
    firstSeenAt: item.firstSeenAt,
    sentiment: item.sentiment,
    alertedAt: item.alertedAt ?? null,
  };
}

// Reads and checks the data/ files. Returns the mention rows, ready to insert. Nothing is written.
function readDataFolder(dataDir) {
  const companiesFile = readDataFile(dataDir, 'companies.json');
  if (!companiesFile || !Array.isArray(companiesFile.companies)) {
    throw new DataImportError(`${path.join(dataDir, 'companies.json')} has no "companies" list.`);
  }
  const mentionsFile = readDataFile(dataDir, 'mentions.json');
  if (!mentionsFile || !Array.isArray(mentionsFile.mentions)) {
    throw new DataImportError(`${path.join(dataDir, 'mentions.json')} has no "mentions" list.`);
  }
  return mentionsFile.mentions.map((item, index) => toMentionRow(item, index + 1));
}

// Imports data/ into the database if (and only if) it is empty. Returns what happened:
//   { imported: false, reason }                          the database already has data
//   { imported: true, companies, mentions, skipped, warnings }
// Throws DataImportError (or the seed loader's SeedError) with a clear message when data/ or
// the company list files are missing or broken; then nothing is saved.
// `dataDir` and `seedFiles` can be pointed at test folders.
export function importDataIfEmpty(db, { dataDir = config.DATA_DIR, seedFiles = {} } = {}) {
  // Quick check first, so a database with data is left alone without reading 11 MB of JSON.
  if (!isDatabaseEmpty(db)) return { imported: false, reason: 'the database already has data' };

  // Read and check everything BEFORE the transaction, so the write lock is held only briefly.
  const mentionRows = readDataFolder(dataDir);
  const { companies, warnings } = readCompaniesFromFiles(seedFiles);

  return inTransaction(db, () => {
    // Checked again inside the transaction: a collector may have started in between.
    if (!isDatabaseEmpty(db)) return { imported: false, reason: 'the database got data while the import was being prepared' };

    writeCompanies(db, companies);
    const listedIds = new Set(companies.map((company) => company.id));
    const insert = db.prepare(`INSERT INTO Mention (company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment, alerted_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let inserted = 0;
    let skipped = 0;
    mentionRows.forEach((row, index) => {
      if (!listedIds.has(row.companyId)) {
        skipped += 1;
        return;
      }
      try {
        insert.run(row.companyId, row.guid, row.url, row.title, row.publisher, row.publishedAt, row.firstSeenAt, row.sentiment, row.alertedAt);
      } catch (error) {
        throw new DataImportError(`data/mentions.json, item ${index + 1}: could not be saved (${error.message}).`);
      }
      inserted += 1;
    });

    const importWarnings = [...warnings];
    if (skipped > 0) {
      importWarnings.push(`${skipped} mention(s) in data/mentions.json belong to companies that are not in the company list; they were not imported.`);
    }
    return { imported: true, companies: companies.length, mentions: inserted, skipped, warnings: importWarnings };
  });
}

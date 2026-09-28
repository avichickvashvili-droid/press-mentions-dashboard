// apiHelpers.js — shared tools for the api's offline tests.
//
// Where it sits: imported by test/api/*.test.js only.
// Writes: a temporary folder with a SQLite database (and small data files), removed after each
// test; starts the api app on a free port (port 0) and stops it after each test.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, openDatabaseReadOnly } from '../../src/db/database.js';
import { createApp } from '../../src/api/app.js';

// The fixed "now" of the api tests: 27 Sep 2026 10:00 UTC, so the 90 days start 29 Jun 2026 10:00.
export const API_NOW = Date.parse('2026-09-27T10:00:00.000Z');

export const SECTION_NAMES = { 1: 'High-Tech', 2: 'Health' };

// Creates a temporary folder with a fresh database. When the test ends, every connection opened
// through `openReadOnly` and the writing connection are closed, then the folder is removed.
export function makeApiDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'press-api-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = openDatabase(dbPath);
  const connections = [db];
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    for (const connection of connections) {
      try { connection.close(); } catch { /* already closed */ }
    }
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* left in temp */ }
  });
  const openReadOnly = () => {
    const connection = openDatabaseReadOnly(dbPath);
    connections.push(connection);
    return connection;
  };
  return { db, dbPath, dir, openReadOnly, onCleanup: (cleanup) => cleanups.push(cleanup) };
}

// Adds companies: [{ id, name, section?, hint? }].
export function addCompanies(db, companies) {
  const insert = db.prepare('INSERT INTO Company (id, name, section, hint, query_param) VALUES (?, ?, ?, ?, ?)');
  for (const company of companies) insert.run(company.id, company.name, company.section ?? 1, company.hint ?? null, `"${company.name}"`);
}

// Adds mentions: [{ companyId, guid, publishedAt, sentiment?, title?, publisher? }].
export function addMentions(db, mentions) {
  const insert = db.prepare(`INSERT INTO Mention (company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const mention of mentions) {
    insert.run(mention.companyId, mention.guid, `https://news.google.com/rss/articles/${mention.guid}`,
      mention.title ?? `${mention.guid} headline - Example News`, mention.publisher === undefined ? 'Example News' : mention.publisher,
      mention.publishedAt, '2026-09-26T08:00:00.000Z', mention.sentiment ?? 'positive');
  }
}

// The standard test data: Harvey (section 1) has 3 mentions in the window + 1 older than 90 days;
// Ukko (section 2) has none; Gone has a mention but is not in the company list (D79).
export function addStandardData(db) {
  addCompanies(db, [
    { id: 'harvey', name: 'Harvey', section: 1, hint: '"Harvey AI"' },
    { id: 'ukko', name: 'Ukko', section: 2 },
    { id: 'gone', name: 'Gone', section: 1 },
  ]);
  addMentions(db, [
    { companyId: 'harvey', guid: 'h-old', publishedAt: '2026-06-01T12:00:00.000Z', sentiment: 'negative' },
    { companyId: 'harvey', guid: 'h-2days', publishedAt: '2026-09-25T09:00:00.000Z', sentiment: 'negative' },
    { companyId: 'harvey', guid: 'h-today', publishedAt: '2026-09-27T08:00:00.000Z', sentiment: 'positive' },
    { companyId: 'harvey', guid: 'h-10days', publishedAt: '2026-09-17T08:00:00.000Z', sentiment: 'neutral' },
    { companyId: 'gone', guid: 'g-1', publishedAt: '2026-09-20T08:00:00.000Z' },
  ]);
}

// Starts the app on a free port. `options` go to createApp (db, now, ...). Returns
// { baseUrl, errors } where `errors` collects what the app wrote to its server log.
export async function startApi(onCleanup, options) {
  const errors = [];
  const app = createApp({
    now: () => API_NOW,
    getCompanyNames: () => ['Harvey', 'Ukko'],
    getSectionNames: () => SECTION_NAMES,
    webDistDir: path.join(os.tmpdir(), 'press-api-test-no-such-folder'),
    logError: (text) => errors.push(text),
    ...options,
  });
  const server = await new Promise((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  onCleanup(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, errors };
}

// GETs a path and returns { status, type, body } (body parsed as JSON when it is JSON).
export async function get(baseUrl, urlPath) {
  const response = await fetch(`${baseUrl}${urlPath}`);
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, type, body, headers: response.headers };
}

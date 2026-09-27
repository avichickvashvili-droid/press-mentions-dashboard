// helpers.js — shared tools for the offline tests.
//
// Where it sits: imported by the *.test.js files only.
// Reads: the XML fixtures in test/fixtures. Writes: temporary SQLite files and small
// temporary data files in the system temp folder (deleted after each test).
//
// Nothing here talks to Google: a fake `fetch` answers from fixtures instead.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/database.js';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

// The fixed "now" used by the tests: 27 Sep 2026, so the 90 days are 30 Jun - 27 Sep 2026.
export const TEST_NOW = Date.parse('2026-09-27T10:00:00.000Z');

// Reads a fixture file as text.
export function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

// Removes a temporary folder. On Windows a file can stay locked for a moment after it is
// closed, so the removal is retried a few times; a folder that still can't be removed is left
// for the system to clean (it is in the temp folder) instead of failing the test.
function removeTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch {
    // left behind in the temp folder
  }
}

// Creates a temporary folder that is removed when the test ends.
export function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'press-dc-test-'));
  t.after(() => removeTempDir(dir));
  return dir;
}

// Opens a fresh database in a temporary folder. When the test ends, the database is closed
// FIRST and only then is the folder removed (Windows can't delete an open file).
// openOther() opens a second, separate connection to the same file (like a second process);
// it is closed before the folder is removed too.
export function makeTempDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'press-dc-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = openDatabase(dbPath);
  const others = [];
  t.after(() => {
    for (const connection of [...others, db]) {
      try { connection.close(); } catch { /* already closed */ }
    }
    removeTempDir(dir);
  });
  const openOther = () => {
    const connection = openDatabase(dbPath);
    others.push(connection);
    return connection;
  };
  return { db, dbPath, dir, openOther };
}

// Writes small data files (company list + hints + keywords) and returns their paths.
export function writeDataFiles(dir, { list, hints = { companies: {} }, keywords }) {
  const listFile = path.join(dir, 'companies.txt');
  const hintsFile = path.join(dir, 'hints.json');
  const keywordsFile = path.join(dir, 'keywords.json');
  fs.writeFileSync(listFile, list);
  fs.writeFileSync(hintsFile, typeof hints === 'string' ? hints : JSON.stringify(hints));
  fs.writeFileSync(keywordsFile, typeof keywords === 'string' ? keywords : JSON.stringify(keywords));
  return { listFile, hintsFile, keywordsFile };
}

// Section words used by the small test lists.
export const TEST_KEYWORDS = {
  sections: {
    1: { name: 'High-Tech', words: '(company OR AI)' },
    2: { name: 'Health', words: '(company OR health)' },
  },
};

// Builds an RSS feed text from a list of items ({ guid, title, publisher, pubDate, link? }).
export function makeFeed(items) {
  const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const itemXml = items.map((item) => `
    <item>
      <title>${escape(item.title)}</title>
      <link>${escape(item.link ?? `https://news.google.com/rss/articles/${item.guid}?oc=5`)}</link>
      <guid isPermaLink="false">${escape(item.guid)}</guid>
      <pubDate>${escape(item.pubDate)}</pubDate>
      ${item.publisher ? `<source url="https://example.com">${escape(item.publisher)}</source>` : ''}
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>test</title>${itemXml}</channel></rss>`;
}

// Makes `count` distinct items for one company, all dated on the given day (YYYY-MM-DD).
export function makeItems(prefix, count, day = '2026-09-20') {
  return Array.from({ length: count }, (_, index) => ({
    guid: `${prefix}-${index}`,
    title: `${prefix} story number ${index} - Example News`,
    publisher: 'Example News',
    pubDate: new Date(`${day}T12:00:00Z`).toUTCString(),
  }));
}

// A fake `fetch`: `answer(url, callNumber)` returns { status, body } (or throws to simulate a
// network error). Every requested URL is recorded in `fake.calls`.
export function makeFakeFetch(answer) {
  const fake = async (url) => {
    fake.calls.push(url);
    const result = await answer(url, fake.calls.length);
    return new Response(result.body ?? '', { status: result.status ?? 200 });
  };
  fake.calls = [];
  return fake;
}

// The search text (q=...) of a Google News URL, decoded.
export function queryOf(url) {
  return new URL(url).searchParams.get('q');
}

// A wait that returns at once but remembers every wait asked for.
export function makeFakeSleep() {
  const fake = async (ms) => { fake.waits.push(ms); };
  fake.waits = [];
  return fake;
}

// A progress display that prints nothing but records messages (for checking warnings).
export function makeSilentProgress() {
  const messages = { info: [], warn: [], error: [], updates: [] };
  return {
    messages,
    update: (fields) => messages.updates.push({ ...fields }),
    info: (text) => messages.info.push(text),
    warn: (text) => messages.warn.push(text),
    error: (text) => messages.error.push(text),
    finish: () => {},
  };
}

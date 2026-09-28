// importData.test.js — the api's one-time import of data/ into an empty database (D35,
// src/api/importData.js): when it imports, when it refuses, and that a broken data/ folder or
// company list saves nothing and gives a clear message. Offline, temporary folders only.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeApiDb, addCompanies, addMentions } from './apiHelpers.js';
import { writeDataFiles, TEST_KEYWORDS } from '../helpers.js';
import { DataImportError, importDataIfEmpty } from '../../src/api/importData.js';
import { SeedError } from '../../src/shared/companyList.js';

// One mention item as the data/ export writes it.
function mentionItem(companyId, guid, overrides = {}) {
  return {
    companyId,
    companyName: companyId,
    guid,
    title: `${guid} headline - Example News`,
    url: `https://news.google.com/rss/articles/${guid}`,
    publisher: 'Example News',
    publishedAt: '2026-09-20T12:00:00.000Z',
    firstSeenAt: '2026-09-26T08:00:00.000Z',
    sentiment: 'positive',
    alertedAt: null,
    ...overrides,
  };
}

// Writes a data/ folder (companies.json + mentions.json, with Windows line endings like a git
// checkout with autocrlf) and a small company list (Harvey, Ukko) with its hints and keywords.
function setup(t, { mentions = [mentionItem('harvey', 'h1'), mentionItem('harvey', 'h2', { sentiment: 'negative' })] } = {}) {
  const context = makeApiDb(t);
  const dataDir = path.join(context.dir, 'data');
  fs.mkdirSync(dataDir);
  const crlf = (value) => `${JSON.stringify(value, null, 2)}\n`.replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(dataDir, 'companies.json'), crlf({ asOf: 'x', companies: [] }));
  fs.writeFileSync(path.join(dataDir, 'mentions.json'), crlf({ asOf: 'x', mentions }));
  const seedFiles = writeDataFiles(context.dir, {
    list: '## 1. High-Tech\r\nHarvey\r\n## 2. Health\r\nUkko (ukko.fi)\r\n',
    hints: { companies: { Harvey: { hint: '"Harvey AI"' } } },
    keywords: TEST_KEYWORDS,
  });
  return { ...context, dataDir, seedFiles };
}

// Counts the rows of a table.
function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

test('empty database: the companies come from the list files (with their search) and every mention is imported', (t) => {
  const { db, dataDir, seedFiles } = setup(t);
  const result = importDataIfEmpty(db, { dataDir, seedFiles });
  assert.equal(result.imported, true);
  assert.equal(result.companies, 2);
  assert.equal(result.mentions, 2);
  assert.deepEqual(db.prepare('SELECT id, name, section, hint, query_param FROM Company ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 'harvey', name: 'Harvey', section: 1, hint: '"Harvey AI"', query_param: '"Harvey AI" (company OR AI)' },
    { id: 'ukko', name: 'Ukko', section: 2, hint: null, query_param: '"Ukko" (company OR health)' },
  ]);
  const row = db.prepare("SELECT * FROM Mention WHERE guid = 'h2'").get();
  assert.equal(row.company_id, 'harvey');
  assert.equal(row.sentiment, 'negative');
  assert.equal(row.first_seen_at, '2026-09-26T08:00:00.000Z');
  assert.equal(row.alerted_at, null);
  assert.equal(count(db, 'JobRun'), 0, 'run.json is not imported');
});

test('Company rows alone (e.g. after npm run seed) still count as empty', (t) => {
  const { db, dataDir, seedFiles } = setup(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }]);
  assert.equal(importDataIfEmpty(db, { dataDir, seedFiles }).imported, true);
  assert.equal(count(db, 'Mention'), 2);
});

test('a database with a mention, a queued article or a run is never touched', (t) => {
  const cases = {
    Mention: (db) => { addCompanies(db, [{ id: 'harvey', name: 'Harvey' }]); addMentions(db, [{ companyId: 'harvey', guid: 'old', publishedAt: '2026-09-01T00:00:00.000Z' }]); },
    BufferQueue: (db) => {
      addCompanies(db, [{ id: 'harvey', name: 'Harvey' }]);
      db.prepare(`INSERT INTO BufferQueue (company_id, guid, url, title, published_at, first_seen_at)
                  VALUES ('harvey', 'q1', 'u', 't', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`).run();
    },
    JobRun: (db) => db.prepare("INSERT INTO JobRun (started_at, status, last_heartbeat) VALUES ('x', 'running', 'x')").run(),
  };
  for (const [table, fill] of Object.entries(cases)) {
    const { db, dataDir, seedFiles } = setup(t);
    fill(db);
    const before = { Company: count(db, 'Company'), Mention: count(db, 'Mention') };
    const result = importDataIfEmpty(db, { dataDir, seedFiles });
    assert.equal(result.imported, false, `a ${table} row blocks the import`);
    assert.deepEqual({ Company: count(db, 'Company'), Mention: count(db, 'Mention') }, before);
  }
});

test('a mention of a company that is not in the list is skipped, with one warning and the count', (t) => {
  const { db, dataDir, seedFiles } = setup(t, { mentions: [mentionItem('harvey', 'h1'), mentionItem('gone', 'g1'), mentionItem('gone', 'g2')] });
  const result = importDataIfEmpty(db, { dataDir, seedFiles });
  assert.equal(result.mentions, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.warnings.filter((warning) => /2 mention\(s\).*not in the company list/.test(warning)).length, 1);
});

test('data/ missing or not valid JSON: a clear error, and nothing is saved', (t) => {
  const missing = setup(t);
  fs.rmSync(missing.dataDir, { recursive: true });
  assert.throws(() => importDataIfEmpty(missing.db, { dataDir: missing.dataDir, seedFiles: missing.seedFiles }),
    (error) => error instanceof DataImportError && /companies\.json: the file is missing/.test(error.message));
  assert.equal(count(missing.db, 'Company'), 0);

  const broken = setup(t);
  fs.writeFileSync(path.join(broken.dataDir, 'mentions.json'), '{ "mentions": [ {');
  assert.throws(() => importDataIfEmpty(broken.db, { dataDir: broken.dataDir, seedFiles: broken.seedFiles }),
    (error) => error instanceof DataImportError && /mentions\.json is not valid JSON/.test(error.message));
  assert.equal(count(broken.db, 'Company'), 0);
});

test('a malformed or duplicate item: the message names the item, and nothing is saved (all or nothing)', (t) => {
  const bad = setup(t, { mentions: [mentionItem('harvey', 'h1'), mentionItem('harvey', 'h2', { sentiment: 'great' })] });
  assert.throws(() => importDataIfEmpty(bad.db, { dataDir: bad.dataDir, seedFiles: bad.seedFiles }),
    /data\/mentions\.json, item 2: "sentiment" must be positive, negative or neutral/);
  assert.equal(count(bad.db, 'Company'), 0);
  assert.equal(count(bad.db, 'Mention'), 0);

  const duplicate = setup(t, { mentions: [mentionItem('harvey', 'h1'), mentionItem('ukko', 'u1'), mentionItem('harvey', 'h1')] });
  assert.throws(() => importDataIfEmpty(duplicate.db, { dataDir: duplicate.dataDir, seedFiles: duplicate.seedFiles }),
    /data\/mentions\.json, item 3: could not be saved/);
  assert.equal(count(duplicate.db, 'Company'), 0, 'the companies written before the failing row are rolled back too');
  assert.equal(count(duplicate.db, 'Mention'), 0);
});

test('a broken company list file: the seed loader\'s clear message, and nothing is saved', (t) => {
  const { db, dataDir, seedFiles } = setup(t);
  fs.writeFileSync(seedFiles.listFile, 'Harvey before any section\n');
  assert.throws(() => importDataIfEmpty(db, { dataDir, seedFiles }), (error) => error instanceof SeedError && /before any/.test(error.message));
  assert.equal(count(db, 'Company'), 0);
  assert.equal(count(db, 'Mention'), 0);
});

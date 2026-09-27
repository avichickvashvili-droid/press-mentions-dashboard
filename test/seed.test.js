// seed.test.js — tests of the seed loader (src/seed/seedLoader.js).
//
// Uses the real data files for the Harvey / Cerebras checks and small temporary files for
// the error cases. Every test works on its own temporary SQLite file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SeedError, makeSlug, parseCompanyList, seedCompanies, stripAnnotation } from '../src/seed/seedLoader.js';
import { TEST_KEYWORDS, makeTempDb, writeDataFiles } from './helpers.js';

const SECTION_1_WORDS = '(company OR startup OR AI OR software OR cybersecurity OR chip OR funding OR valuation)';

// Reads all Company rows as plain objects, ordered by name.
function allCompanies(db) {
  return db.prepare('SELECT * FROM Company ORDER BY name').all().map((row) => ({ ...row }));
}

test('real files: 258 companies; Harvey uses its hint, Cerebras its quoted name', (t) => {
  const { db } = makeTempDb(t);
  const result = seedCompanies(db);
  assert.equal(result.companies.length, 258);
  assert.equal(result.inserted, 258);

  const harvey = db.prepare("SELECT * FROM Company WHERE name = 'Harvey'").get();
  assert.equal(harvey.id, 'harvey');
  assert.equal(harvey.section, 1);
  assert.equal(harvey.hint, '"Harvey AI"');
  assert.equal(harvey.query_param, `"Harvey AI" ${SECTION_1_WORDS}`);

  const cerebras = db.prepare("SELECT * FROM Company WHERE name = 'Cerebras'").get();
  assert.equal(cerebras.hint, null);
  assert.equal(cerebras.query_param, `"Cerebras" ${SECTION_1_WORDS}`);
});

test('real files: the "(...)" note is removed from names and ids are slugs', (t) => {
  const { db } = makeTempDb(t);
  seedCompanies(db);
  const lambda = db.prepare("SELECT * FROM Company WHERE id = 'lambda'").get();
  assert.equal(lambda.name, 'Lambda');
  assert.equal(lambda.hint, 'Lambda "GPU"'); // hint found under the full list name "Lambda (lambda.ai)"
  assert.equal(db.prepare("SELECT name FROM Company WHERE id = 'people-ai'").get().name, 'People.ai');
  assert.equal(db.prepare("SELECT name FROM Company WHERE id = 'cycuity'").get().name, 'Cycuity');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM Company WHERE name LIKE '%(%'").get().n, 0);
});

test('stripAnnotation and makeSlug', () => {
  assert.equal(stripAnnotation('Lambda (lambda.ai)'), 'Lambda');
  assert.equal(stripAnnotation('Lifeward (formerly known as ReWalk)'), 'Lifeward');
  assert.equal(stripAnnotation('Cerebras'), 'Cerebras');
  assert.equal(makeSlug('People.ai'), 'people-ai');
  assert.equal(makeSlug('C2A Security'), 'c2a-security');
  assert.equal(makeSlug('Scale AI!'), 'scale-ai');
});

test('parseCompanyList: CRLF, comments, blank lines and sections', () => {
  const text = '# a comment\r\n\r\n## 1. Tech\r\nAlpha\r\n# inside comment\r\nBeta (formerly Gamma)\r\n\r\n## 2. Health\r\nDelta\r\n## 13. Unsorted\r\n# empty\r\n';
  const entries = parseCompanyList(text).map(({ listName, name, section }) => ({ listName, name, section }));
  assert.deepEqual(entries, [
    { listName: 'Alpha', name: 'Alpha', section: 1 },
    { listName: 'Beta (formerly Gamma)', name: 'Beta', section: 1 },
    { listName: 'Delta', name: 'Delta', section: 2 },
  ]);
});

test('running the seed twice adds no duplicates and keeps ids', (t) => {
  const { db } = makeTempDb(t);
  seedCompanies(db);
  const before = allCompanies(db);
  const second = seedCompanies(db);
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 258);
  assert.deepEqual(allCompanies(db), before);
});

test('a re-seed updates section/hint/search, keeps the id and never deletes', (t) => {
  const { db, dir } = makeTempDb(t);
  const first = writeDataFiles(dir, { list: '## 1. Tech\nAlpha\nBeta\n', keywords: TEST_KEYWORDS });
  seedCompanies(db, first);
  const second = writeDataFiles(dir, {
    list: '## 2. Health\nAlpha\n',
    hints: { companies: { Alpha: { hint: '"Alpha Bio"' } } },
    keywords: TEST_KEYWORDS,
  });
  seedCompanies(db, second);
  const rows = allCompanies(db);
  assert.equal(rows.length, 2, 'Beta was removed from the file but stays in the table');
  const alpha = rows.find((row) => row.name === 'Alpha');
  assert.deepEqual(alpha, { id: 'alpha', name: 'Alpha', section: 2, hint: '"Alpha Bio"', query_param: '"Alpha Bio" (company OR health)' });
});

test('empty or null hint means "no hint"', (t) => {
  const { db, dir } = makeTempDb(t);
  const files = writeDataFiles(dir, {
    list: '## 1. Tech\nAlpha\nBeta\n',
    hints: { companies: { Alpha: { hint: '' }, Beta: { hint: null } } },
    keywords: TEST_KEYWORDS,
  });
  seedCompanies(db, files);
  for (const row of allCompanies(db)) {
    assert.equal(row.hint, null);
    assert.equal(row.query_param, `"${row.name}" (company OR AI)`);
  }
});

test('warnings: a hint for an unknown name, and a search longer than 30 words', (t) => {
  const { db, dir } = makeTempDb(t);
  const longHint = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
  const files = writeDataFiles(dir, {
    list: '## 1. Tech\nAlpha\n',
    hints: { companies: { Alpha: { hint: longHint }, Nobody: { hint: 'x' } } },
    keywords: TEST_KEYWORDS,
  });
  const result = seedCompanies(db, files);
  assert.equal(result.inserted, 1, 'warnings do not stop the seed');
  assert.ok(result.warnings.some((w) => w.includes('"Nobody"')));
  assert.ok(result.warnings.some((w) => w.includes('"Alpha"') && w.includes('33 words')));
});

// Seeds good data first, then checks that a bad seed throws a SeedError and leaves the table unchanged.
function assertSeedAborts(t, badFiles, messagePattern) {
  const { db, dir } = makeTempDb(t);
  seedCompanies(db, writeDataFiles(dir, { list: '## 1. Tech\nAlpha\n', keywords: TEST_KEYWORDS }));
  const before = allCompanies(db);
  const badDir = path.join(dir, 'bad');
  fs.mkdirSync(badDir);
  const files = writeDataFiles(badDir, { keywords: TEST_KEYWORDS, ...badFiles });
  assert.throws(() => seedCompanies(db, files), (error) => error instanceof SeedError && messagePattern.test(error.message));
  assert.deepEqual(allCompanies(db), before);
}

test('abort: a company in a section that has no words (e.g. section 13)', (t) => {
  assertSeedAborts(t, { list: '## 1. Tech\nAlpha (updated)\n## 13. Unsorted\nMystery Co\n' }, /no words for section 13.*Mystery Co/);
});

test('abort: a company line before any section header', (t) => {
  assertSeedAborts(t, { list: 'Orphan\n## 1. Tech\nAlpha\n' }, /before any/);
});

test('abort: the same name twice', (t) => {
  assertSeedAborts(t, { list: '## 1. Tech\nAlpha\n## 2. Health\nAlpha (again)\n' }, /appears twice/);
});

test('abort: broken JSON in the hints file', (t) => {
  assertSeedAborts(t, { list: '## 1. Tech\nAlpha\n', hints: '{ "companies": { oops' }, /not valid JSON/);
});

test('abort: broken JSON in the keywords file', (t) => {
  assertSeedAborts(t, { list: '## 1. Tech\nAlpha\n', keywords: '[1, 2' }, /not valid JSON/);
});

test('abort: a malformed section header', (t) => {
  assertSeedAborts(t, { list: '## Tech\nAlpha\n' }, /section header/);
});

test('abort: a missing company list file', (t) => {
  const { db, dir } = makeTempDb(t);
  const files = writeDataFiles(dir, { list: '## 1. Tech\nAlpha\n', keywords: TEST_KEYWORDS });
  files.listFile = path.join(dir, 'does-not-exist.txt');
  assert.throws(() => seedCompanies(db, files), /Cannot read the company list/);
  assert.equal(allCompanies(db).length, 0);
});

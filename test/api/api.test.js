// api.test.js — the api's two endpoints, its errors and the page serving (src/api/app.js,
// src/api/queries.js, src/shared/companyStatus.js). Offline: a temporary database, the app on a
// free port, the built-in fetch.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { API_NOW, addMentions, addStandardData, get, makeApiDb, startApi } from './apiHelpers.js';
import { buildExport } from '../../src/classifier/exporter.js';
import { inTransaction } from '../../src/db/database.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// A database with the standard data, served by the app through a read-only connection.
async function setup(t, options = {}) {
  const { db, dir, openReadOnly, onCleanup } = makeApiDb(t);
  addStandardData(db);
  const readDb = openReadOnly();
  const api = await startApi(onCleanup, { db: readDb, ...options });
  return { db, dir, readDb, onCleanup, ...api };
}

test('GET /api/companies: every company in the list with status, days ago, section and totals', async (t) => {
  const { baseUrl } = await setup(t);
  const { status, body, headers } = await get(baseUrl, '/api/companies');
  assert.equal(status, 200);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(body.asOf, new Date(API_NOW).toISOString());
  assert.equal(body.windowStart, new Date(API_NOW - 90 * DAY_MS).toISOString());
  assert.deepEqual(body.companies, [
    {
      id: 'harvey', name: 'Harvey', section: 1, sectionName: 'High-Tech', hint: '"Harvey AI"',
      status: 'mentioned', lastMentionAt: '2026-09-27T08:00:00.000Z', daysAgo: 0, mentionCount: 3,
      sentimentCounts: { positive: 1, neutral: 1, negative: 1 },
      weekCount: 2, prevWeekCount: 1, logoUrl: null,
    },
    {
      id: 'ukko', name: 'Ukko', section: 2, sectionName: 'Health', hint: null,
      status: 'no_coverage', lastMentionAt: null, daysAgo: null, mentionCount: 0,
      sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
      weekCount: 0, prevWeekCount: 0, logoUrl: null,
    },
  ], 'Gone is not in the list (D79); the June mention is outside the 90 days');
});

test('GET /api/companies: "days ago" and the 90-day window are worked out again on every request', async (t) => {
  let now = API_NOW;
  const { baseUrl, db } = await setup(t, { now: () => now });
  now = API_NOW + 2 * DAY_MS; // two days later
  let harvey = (await get(baseUrl, '/api/companies')).body.companies[0];
  assert.equal(harvey.daysAgo, 2);

  // 90 days + 1 hour after the 17 Sep mention: it has left the window; 25 Sep and 27 Sep remain.
  now = Date.parse('2026-12-16T09:00:00.000Z');
  harvey = (await get(baseUrl, '/api/companies')).body.companies[0];
  assert.equal(harvey.mentionCount, 2);
  assert.deepEqual(harvey.sentimentCounts, { positive: 1, neutral: 0, negative: 1 });

  now = Date.parse('2027-01-01T00:00:00.000Z'); // every mention is older than 90 days
  harvey = (await get(baseUrl, '/api/companies')).body.companies[0];
  assert.equal(harvey.status, 'no_coverage');
  assert.equal(harvey.daysAgo, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention').get().n, 5, 'filtered, never deleted (D13)');
});

test('GET /api/companies/:id/mentions: the window only, newest first, without snippet', async (t) => {
  const { baseUrl } = await setup(t);
  const { status, body } = await get(baseUrl, '/api/companies/harvey/mentions');
  assert.equal(status, 200);
  assert.deepEqual(body.company, { id: 'harvey', name: 'Harvey' });
  assert.deepEqual(body.mentions.map((mention) => mention.publishedAt),
    ['2026-09-27T08:00:00.000Z', '2026-09-25T09:00:00.000Z', '2026-09-17T08:00:00.000Z']);
  assert.deepEqual(body.mentions[0], {
    title: 'h-today headline - Example News',
    url: 'https://news.google.com/rss/articles/h-today',
    publisher: 'Example News',
    publishedAt: '2026-09-27T08:00:00.000Z',
    sentiment: 'positive',
  });
});

test('GET /api/companies/:id/mentions: a company with no mentions gets an empty list', async (t) => {
  const { baseUrl } = await setup(t);
  const { status, body } = await get(baseUrl, '/api/companies/ukko/mentions');
  assert.equal(status, 200);
  assert.deepEqual(body, { company: { id: 'ukko', name: 'Ukko' }, asOf: new Date(API_NOW).toISOString(), mentions: [] });
});

test('unknown company id and unknown /api address: 404 with a JSON error', async (t) => {
  const { baseUrl } = await setup(t);
  const unknown = await get(baseUrl, '/api/companies/nope/mentions');
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'No company with the id "nope".' });

  const route = await get(baseUrl, '/api/whatever');
  assert.equal(route.status, 404);
  assert.match(route.body.error, /Unknown API address: GET \/api\/whatever/);
});

test('storage can not be read: 500 with a JSON error, the details only in the server log', async (t) => {
  const { baseUrl, readDb, errors } = await setup(t);
  readDb.close(); // any read now fails
  for (const urlPath of ['/api/companies', '/api/companies/harvey/mentions']) {
    const { status, body } = await get(baseUrl, urlPath);
    assert.equal(status, 500);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.match(body.error, /could not be read/);
    assert.doesNotMatch(body.error, /at .*\.js/, 'no stack trace for the page');
  }
  assert.equal(errors.length, 2);
  assert.match(errors[0], /GET \/api\/companies failed/);
});

test('the company list file can not be read: 500 with a JSON error', async (t) => {
  const { baseUrl, errors } = await setup(t, { getCompanyNames: () => { throw new Error('list file missing'); } });
  const { status, body } = await get(baseUrl, '/api/companies');
  assert.equal(status, 500);
  assert.match(body.error, /could not be read/);
  assert.match(errors[0], /list file missing/);
});

test('reads work while the pipeline holds a write transaction (WAL: readers are not blocked)', async (t) => {
  const { baseUrl, db } = await setup(t);
  db.exec('BEGIN IMMEDIATE;');
  try {
    addMentions(db, [{ companyId: 'ukko', guid: 'u-new', publishedAt: '2026-09-26T08:00:00.000Z' }]);
    const { status, body } = await get(baseUrl, '/api/companies');
    assert.equal(status, 200);
    assert.equal(body.companies[1].status, 'no_coverage', 'the uncommitted mention is not seen yet');
  } finally {
    db.exec('COMMIT;');
  }
  const { body } = await get(baseUrl, '/api/companies');
  assert.equal(body.companies[1].status, 'mentioned', 'seen once committed');
});

test('the api connection is read-only: SQLite refuses any write', async (t) => {
  const { readDb } = await setup(t);
  assert.throws(() => readDb.exec("DELETE FROM Mention WHERE guid = 'h-today'"), /readonly/i);
  assert.throws(() => inTransaction(readDb, () => readDb.exec('DELETE FROM Company')), /readonly/i);
});

test('the api and the data/ export give the same company status for the same database and time', async (t) => {
  const { baseUrl, readDb } = await setup(t);
  const run = { id: 0, started_at: 'x', finished_at: null, classified_count: 0, relevant_count: 0, irrelevant_count: 0, failed_count: 0 };
  const exported = buildExport(readDb, { run, now: API_NOW, companyNames: ['Harvey', 'Ukko'] })['companies.json'];
  const { body } = await get(baseUrl, '/api/companies');
  assert.equal(body.asOf, exported.asOf);
  assert.equal(body.windowStart, exported.windowStart);
  // The api adds only sectionName, the Recent activity counts and logoUrl; everything else is the
  // same as data/companies.json.
  const withoutSectionName = body.companies.map(({ sectionName, weekCount, prevWeekCount, logoUrl, ...rest }) => rest);
  assert.deepEqual(withoutSectionName, exported.companies);
});

test('page: without a build, any page address gets a clear "build it first" message', async (t) => {
  const { baseUrl } = await setup(t);
  const { status, body } = await get(baseUrl, '/');
  assert.equal(status, 503);
  assert.match(body, /npm run dashboard/);
  assert.match(body, /npm run build/);
});

test('page: the built page, its files, and index.html for any other address', async (t) => {
  const { dir, onCleanup, readDb } = await (async () => {
    const context = makeApiDb(t);
    addStandardData(context.db);
    return { ...context, readDb: context.openReadOnly() };
  })();
  const distDir = path.join(dir, 'dist');
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Dashboard</title>');
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log(1);');
  const { baseUrl } = await startApi(onCleanup, { db: readDb, webDistDir: distDir });

  assert.match((await get(baseUrl, '/')).body, /<title>Dashboard/);
  assert.match((await get(baseUrl, '/companies/harvey')).body, /<title>Dashboard/, 'fallback to index.html');
  const somePage = await get(baseUrl, '/some/page');
  assert.equal(somePage.status, 200);
  assert.match(somePage.body, /<title>Dashboard/, 'an address without a file extension gets the page');
  assert.equal((await get(baseUrl, '/assets/app.js')).body, 'console.log(1);');
  assert.equal((await get(baseUrl, '/api/nope')).status, 404, '/api addresses never get the page');

  // A missing file (an address with an extension) gets a 404, never the page.
  for (const missing of ['/favicon.ico', '/assets/index-OLD.js', '/some/page.css']) {
    const answer = await get(baseUrl, missing);
    assert.equal(answer.status, 404, missing);
    assert.doesNotMatch(String(answer.type), /text\/html/, `${missing} is not the page`);
  }
});

test('security headers on every answer: the page, a file, the api and an error', async (t) => {
  const context = makeApiDb(t);
  addStandardData(context.db);
  const distDir = path.join(context.dir, 'dist');
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Dashboard</title>');
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log(1);');
  const { baseUrl } = await startApi(context.onCleanup, { db: context.openReadOnly(), webDistDir: distDir });

  for (const urlPath of ['/', '/companies/harvey', '/assets/app.js', '/api/companies', '/api/nope', '/favicon.ico']) {
    const { headers } = await get(baseUrl, urlPath);
    assert.equal(headers.get('x-content-type-options'), 'nosniff', urlPath);
    assert.equal(headers.get('x-frame-options'), 'DENY', urlPath);
    assert.equal(headers.get('referrer-policy'), 'no-referrer', urlPath);
    assert.match(headers.get('content-security-policy') ?? '', /default-src 'self'/, urlPath);
    assert.match(headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/, urlPath);
  }
});

test('the built page needs nothing the CSP blocks: no inline script or style in web/index.html', () => {
  // The CSP is default-src 'self': an inline <script> or <style> (or a style="" attribute) in the
  // page shell would be blocked. Read with CRLF in mind (git autocrlf).
  const shell = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'web', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const scripts = [...shell.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  for (const [, attributes, body] of scripts) {
    assert.match(attributes, /\bsrc=/, 'every script is a file');
    assert.equal(body.trim(), '', 'no inline script code');
  }
  assert.doesNotMatch(shell, /<style\b/, 'no inline <style>');
  assert.doesNotMatch(shell, /\sstyle=/, 'no style="" attribute');
});

test('GET /api/companies sends windowDays, the window setting (not a fixed 90)', async (t) => {
  const standard = await setup(t);
  assert.equal((await get(standard.baseUrl, '/api/companies')).body.windowDays, 90);

  const short = await setup(t, { windowDays: 30 });
  const { body } = await get(short.baseUrl, '/api/companies');
  assert.equal(body.windowDays, 30);
  assert.equal(body.windowStart, new Date(API_NOW - 30 * DAY_MS).toISOString());
  assert.equal(body.companies[0].mentionCount, 3, 'the 3 September mentions are inside 30 days too');
});

test('window edge: a mention exactly at windowStart counts, 1 ms before it does not', async (t) => {
  const { baseUrl, db } = await setup(t);
  const windowStart = API_NOW - 90 * DAY_MS;
  addMentions(db, [
    { companyId: 'ukko', guid: 'u-edge', publishedAt: new Date(windowStart).toISOString() },
    { companyId: 'ukko', guid: 'u-before', publishedAt: new Date(windowStart - 1).toISOString() },
  ]);
  const ukko = (await get(baseUrl, '/api/companies')).body.companies[1];
  assert.equal(ukko.mentionCount, 1);
  assert.equal(ukko.lastMentionAt, new Date(windowStart).toISOString());
  assert.equal(ukko.daysAgo, 90);
  const { body } = await get(baseUrl, '/api/companies/ukko/mentions');
  assert.deepEqual(body.mentions.map((mention) => mention.url), ['https://news.google.com/rss/articles/u-edge']);
});

test('"days ago": 23 h 59 min after the latest mention is 0, exactly 24 h is 1', async (t) => {
  const latest = Date.parse('2026-09-27T08:00:00.000Z'); // Harvey's latest mention
  let now = latest + DAY_MS - 60 * 1000;
  const { baseUrl } = await setup(t, { now: () => now });
  assert.equal((await get(baseUrl, '/api/companies')).body.companies[0].daysAgo, 0);
  now = latest + DAY_MS;
  assert.equal((await get(baseUrl, '/api/companies')).body.companies[0].daysAgo, 1);
});

test('a mention dated in the future counts, and "days ago" is 0 (never below 0)', async (t) => {
  const { baseUrl, db } = await setup(t);
  const future = new Date(API_NOW + 3 * 60 * 60 * 1000).toISOString();
  addMentions(db, [{ companyId: 'ukko', guid: 'u-future', publishedAt: future }]);
  const ukko = (await get(baseUrl, '/api/companies')).body.companies[1];
  assert.equal(ukko.status, 'mentioned');
  assert.equal(ukko.lastMentionAt, future);
  assert.equal(ukko.daysAgo, 0);
  assert.equal(ukko.mentionCount, 1);
});

// dashboardExtras.test.js — what the api adds for the new company table (D110, D112): the
// Recent activity counts (this week / the week before, exact edges) and the company logos
// (logos.json, safe file names only, served with a 30-day browser cache).
// Offline: a temporary database and a temporary logo folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { API_NOW, addCompanies, addMentions, get, makeApiDb, startApi } from './apiHelpers.js';
import { readLogoUrls } from '../../src/api/logos.js';
import { config } from '../../src/config.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test('Recent activity: this week = the last 7 days, the week before = the 7 days before; exact edges', async (t) => {
  const { db, openReadOnly, onCleanup } = makeApiDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }, { id: 'ukko', name: 'Ukko' }]);
  addMentions(db, [
    { companyId: 'harvey', guid: 'week-edge', publishedAt: iso(API_NOW - 7 * DAY_MS) }, // exactly 7 days: this week
    { companyId: 'harvey', guid: 'prev-top', publishedAt: iso(API_NOW - 7 * DAY_MS - 1) }, // 1 ms before: the week before
    { companyId: 'harvey', guid: 'prev-edge', publishedAt: iso(API_NOW - 14 * DAY_MS) }, // exactly 14 days: the week before
    { companyId: 'harvey', guid: 'older', publishedAt: iso(API_NOW - 14 * DAY_MS - 1) }, // older: neither
    { companyId: 'ukko', guid: 'u-old', publishedAt: iso(API_NOW - 30 * DAY_MS) },
  ]);
  const { baseUrl } = await startApi(onCleanup, { db: openReadOnly() });
  const { body } = await get(baseUrl, '/api/companies');
  const byId = Object.fromEntries(body.companies.map((c) => [c.id, c]));
  assert.equal(byId.harvey.weekCount, 1);
  assert.equal(byId.harvey.prevWeekCount, 2);
  assert.equal(byId.harvey.mentionCount, 4, 'the 90-day count is unchanged');
  assert.equal(byId.ukko.weekCount, 0);
  assert.equal(byId.ukko.prevWeekCount, 0);
});

// A temporary logo folder with `files` ({ name: text }) and logos.json = `list`.
function makeLogoDir(t, files, list) {
  const dir = fs.mkdtempSync(path.join(config.PROJECT_ROOT, 'test', '.tmp-logos-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  if (list !== undefined) fs.writeFileSync(path.join(dir, 'logos.json'), typeof list === 'string' ? list : JSON.stringify(list));
  return dir;
}

test('logos: only safe file names that exist; a missing list is quiet, a broken one is logged', (t) => {
  const dir = makeLogoDir(t, { 'harvey.png': 'png', 'ukko.svg': '<svg/>' }, {
    harvey: { file: 'harvey.png' },
    ukko: { file: 'ukko.svg' },
    gone: { file: 'gone.png' }, // no such file
    evil: { file: '../secret.png' },
    exe: { file: 'x.exe' },
    none: null,
  });
  assert.deepEqual([...readLogoUrls(dir)], [['harvey', '/logos/harvey.png'], ['ukko', '/logos/ukko.svg']]);

  const errors = [];
  assert.equal(readLogoUrls(makeLogoDir(t, {}), { logError: (e) => errors.push(e) }).size, 0);
  assert.equal(errors.length, 0, 'no logos.json yet: no warning');
  assert.equal(readLogoUrls(makeLogoDir(t, {}, '{ broken'), { logError: (e) => errors.push(e) }).size, 0);
  assert.match(errors[0], /could not be read.*letter badges/);
});

test('logos: logoUrl in the company list, the file served with a 30-day cache, a missing one 404', async (t) => {
  const { db, openReadOnly, onCleanup } = makeApiDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }, { id: 'ukko', name: 'Ukko' }]);
  const logosDir = makeLogoDir(t, { 'harvey.png': 'png-bytes' }, { harvey: { file: 'harvey.png' }, ukko: null });
  const { baseUrl } = await startApi(onCleanup, { db: openReadOnly(), logosDir });
  const { body } = await get(baseUrl, '/api/companies');
  assert.deepEqual(body.companies.map((c) => [c.id, c.logoUrl]), [['harvey', '/logos/harvey.png'], ['ukko', null]]);

  const logo = await fetch(`${baseUrl}/logos/harvey.png`);
  assert.equal(logo.status, 200);
  assert.equal(await logo.text(), 'png-bytes');
  assert.equal(logo.headers.get('cache-control'), `public, max-age=${config.LOGO_CACHE_MAX_AGE_MS / 1000}`);
  assert.equal((await fetch(`${baseUrl}/logos/ukko.png`)).status, 404);
});

// ---------- the daily job's numbers for the top of the page (D113) ----------

// Adds a DailyRun row. Returns its id.
function addDailyRun(db, { status = 'done', startedAt, finishedAt = null, alertSentAt = null, newMentions = 0 }) {
  return Number(db.prepare('INSERT INTO DailyRun (started_at, finished_at, status, new_mentions, alert_sent_at) VALUES (?, ?, ?, ?, ?)')
    .run(startedAt, finishedAt, status, newMentions, alertSentAt).lastInsertRowid);
}

test('dailyRun: none before the first daily run', async (t) => {
  const { db, openReadOnly, onCleanup } = makeApiDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }]);
  const { baseUrl } = await startApi(onCleanup, { db: openReadOnly() });
  const { body } = await get(baseUrl, '/api/companies');
  assert.deepEqual(body.dailyRun, { latest: null, lastDone: null });
});

test('dailyRun: the last finished run matches its Discord message (the mentions it marked as sent)', async (t) => {
  const { db, openReadOnly, onCleanup } = makeApiDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }, { id: 'ukko', name: 'Ukko' }]);
  addMentions(db, [
    { companyId: 'harvey', guid: 'old', publishedAt: '2026-09-20T08:00:00.000Z' },
    { companyId: 'harvey', guid: 'a', publishedAt: '2026-09-27T01:00:00.000Z' },
    { companyId: 'harvey', guid: 'b', publishedAt: '2026-09-27T01:00:00.000Z' },
    { companyId: 'ukko', guid: 'c', publishedAt: '2026-09-27T01:00:00.000Z' },
  ]);
  // Run 1 (first run): marked the old one at its start (not sent); run 2 sent a, b, c.
  addDailyRun(db, { startedAt: '2026-09-26T00:00:00.000Z', finishedAt: '2026-09-26T00:10:00.000Z', alertSentAt: '2026-09-26T00:09:00.000Z' });
  db.prepare("UPDATE Mention SET alerted_at = '2026-09-26T00:00:00.000Z' WHERE guid = 'old'").run();
  addDailyRun(db, { startedAt: '2026-09-27T00:00:00.000Z', finishedAt: '2026-09-27T00:20:00.000Z', alertSentAt: '2026-09-27T00:19:00.000Z', newMentions: 3 });
  db.prepare("UPDATE Mention SET alerted_at = '2026-09-27T00:19:00.000Z' WHERE guid IN ('a', 'b', 'c')").run();
  addDailyRun(db, { status: 'running', startedAt: '2026-09-27T09:00:00.000Z' });

  const { baseUrl } = await startApi(onCleanup, { db: openReadOnly() });
  const { body } = await get(baseUrl, '/api/companies');
  assert.deepEqual(body.dailyRun, {
    latest: { id: 3, status: 'running', startedAt: '2026-09-27T09:00:00.000Z', finishedAt: null },
    lastDone: { id: 2, finishedAt: '2026-09-27T00:20:00.000Z', newMentions: 3, companiesWithUpdates: 2, discordSent: true },
  });
});

test('dailyRun: a run whose Discord message was not sent counts the mentions it found', async (t) => {
  const { db, openReadOnly, onCleanup } = makeApiDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }]);
  addMentions(db, [{ companyId: 'harvey', guid: 'a', publishedAt: '2026-09-26T01:00:00.000Z' }]); // first_seen_at 2026-09-26T08:00
  addDailyRun(db, { startedAt: '2026-09-26T07:00:00.000Z', finishedAt: '2026-09-26T09:00:00.000Z', newMentions: 1 });
  addDailyRun(db, { status: 'failed', startedAt: '2026-09-27T00:00:00.000Z', finishedAt: '2026-09-27T01:00:00.000Z' });
  const { baseUrl } = await startApi(onCleanup, { db: openReadOnly() });
  const { body } = await get(baseUrl, '/api/companies');
  assert.equal(body.dailyRun.latest.status, 'failed');
  assert.deepEqual(body.dailyRun.lastDone, { id: 1, finishedAt: '2026-09-26T09:00:00.000Z', newMentions: 1, companiesWithUpdates: 1, discordSent: false });
});

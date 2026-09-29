// overview.test.js — GET /api/overview (the Overview page, D117): the totals and the 30-day trend,
// every Israel day of the window (zeros included; a mention late in the UTC evening counts for the
// next Israel day), the months, "needs attention" (negative / spike / quiet / positive, at most one
// item per company, a mini chart each), the newest mentions, and only companies in the list count.
// Offline: a temporary database.

import test from 'node:test';
import assert from 'node:assert/strict';
import { API_NOW, addCompanies, addMentions, get, makeApiDb, startApi } from './apiHelpers.js';
import { makeDayKey } from '../../src/api/overview.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// `count` mentions for a company, `daysAgo` days before API_NOW (an hour apart), with a sentiment.
function many(companyId, count, daysAgo, sentiment = 'positive') {
  return Array.from({ length: count }, (_, i) => ({
    companyId, sentiment, guid: `${companyId}-${daysAgo}-${sentiment}-${i}`, publishedAt: iso(API_NOW - daysAgo * DAY_MS - i * 60 * 1000),
  }));
}

// Starts the api on a database with the companies and mentions. The company list is every
// company given, except the one with the id 'gone' (D79).
async function overview(t, companies, mentions) {
  const { db, openReadOnly, onCleanup } = makeApiDb(t);
  addCompanies(db, companies);
  addMentions(db, mentions);
  const names = companies.filter((c) => c.id !== 'gone').map((c) => c.name);
  const { baseUrl } = await startApi(onCleanup, { db: openReadOnly(), getCompanyNames: () => names });
  return (await get(baseUrl, '/api/overview')).body;
}

test('Israel days: 23:30 UTC on 29 Sep is 30 Sep in Israel', () => {
  const dayKey = makeDayKey('Asia/Jerusalem');
  assert.equal(dayKey('2026-09-29T20:59:00.000Z'), '2026-09-29');
  assert.equal(dayKey('2026-09-29T21:00:00.000Z'), '2026-09-30');
});

test('totals, the 30-day trend, every day of the window (zeros too) and the months', async (t) => {
  const body = await overview(t, [{ id: 'harvey', name: 'Harvey' }], [
    ...many('harvey', 3, 1, 'positive'),
    ...many('harvey', 2, 1, 'negative'),
    ...many('harvey', 1, 40, 'neutral'), // the 30 days before
    ...many('harvey', 1, 100, 'positive'), // outside the 90-day window: not counted anywhere
  ]);
  assert.deepEqual(body.totals, { mentions: 6, positive: 3, neutral: 1, negative: 2, companies: 1, companiesMentioned: 1 });
  assert.deepEqual(body.trend, { current: 5, previous: 1, days: 30 });
  assert.equal(body.timeZone, 'Asia/Jerusalem');
  assert.equal(body.daily.length, 91, 'every Israel day from the window start to today');
  assert.equal(body.daily.at(-1).day, '2026-09-27');
  const yesterday = body.daily.find((d) => d.day === '2026-09-26');
  assert.deepEqual(yesterday, { day: '2026-09-26', positive: 3, neutral: 0, negative: 2 });
  assert.equal(body.daily.filter((d) => d.positive + d.neutral + d.negative === 0).length, 89, 'days without mentions are 0');
  assert.deepEqual(body.monthly.map((m) => m.month), ['2026-06', '2026-07', '2026-08', '2026-09'], 'every month of the window');
  assert.equal(body.monthly.reduce((sum, m) => sum + m.positive + m.neutral + m.negative, 0), 6);
});

test('needs attention: negative, spike, quiet and positive, one item per company, with a mini chart', async (t) => {
  const body = await overview(t, [
    { id: 'neg', name: 'Negco' }, { id: 'spike', name: 'Spikeco' }, { id: 'quiet', name: 'Quietco' },
    { id: 'pos', name: 'Posco' }, { id: 'calm', name: 'Calmco' },
  ], [
    ...many('neg', 6, 1, 'negative'), ...many('neg', 4, 2, 'neutral'), // 60% negative this week
    ...many('spike', 12, 1, 'neutral'), ...many('spike', 3, 9, 'neutral'), // 12 vs 3: +300%
    ...many('quiet', 12, 15, 'neutral'), // 12 before, none this week
    ...many('pos', 10, 3, 'positive'), ...many('pos', 8, 9, 'neutral'), // 100% positive this week (8 the week before: no spike)
    ...many('calm', 10, 2, 'neutral'), ...many('calm', 10, 9, 'neutral'), // nothing special
  ]);
  const byKind = Object.fromEntries(body.attention.map((a) => [a.kind, a]));
  assert.deepEqual(body.attention.map((a) => a.kind), ['negative', 'spike', 'quiet', 'positive'], 'one of each kind in turn');
  assert.equal(byKind.negative.name, 'Negco');
  assert.equal(byKind.negative.value, 60);
  assert.equal(byKind.spike.name, 'Spikeco');
  assert.equal(byKind.spike.value, 300);
  assert.equal(byKind.quiet.name, 'Quietco');
  assert.equal(byKind.positive.value, 100);
  assert.ok(body.attention.every((a) => a.spark.length === 14 && 'logoUrl' in a));
  assert.equal(byKind.negative.spark.reduce((a, b) => a + b, 0), 6, 'a negative item charts its negative mentions');
  assert.equal(new Set(body.attention.map((a) => a.companyId)).size, body.attention.length);
  assert.ok(!body.attention.some((a) => a.name === 'Calmco'));
});

test('spikes rank by the mentions they added: 8 → 46 before 0 → 23 (code review #3)', async (t) => {
  const body = await overview(t, [{ id: 'island', name: 'Island' }, { id: 'oe', name: 'OpenEvidence' }], [
    ...many('island', 23, 1, 'neutral'),
    ...many('oe', 46, 1, 'neutral'), ...many('oe', 8, 9, 'neutral'),
  ]);
  assert.deepEqual(body.attention.filter((a) => a.kind === 'spike').map((a) => a.name), ['OpenEvidence', 'Island']);
});

test('every month of the window is listed, also one without mentions (code review #8)', async (t) => {
  const body = await overview(t, [{ id: 'harvey', name: 'Harvey' }], many('harvey', 1, 1, 'positive'));
  assert.deepEqual(body.monthly.map((m) => m.month), ['2026-06', '2026-07', '2026-08', '2026-09']);
  assert.deepEqual(body.monthly[1], { month: '2026-07', positive: 0, neutral: 0, negative: 0 });
});

test('a spike from nothing (none the week before) has no % but still counts', async (t) => {
  const body = await overview(t, [{ id: 'new', name: 'Newco' }], many('new', 10, 1, 'neutral'));
  assert.equal(body.attention[0].kind, 'spike');
  assert.equal(body.attention[0].value, null);
  assert.equal(body.attention[0].prev, 0);
});

test('recent: the newest mentions of all companies, with the company name; companies not in the list never count', async (t) => {
  const body = await overview(t, [{ id: 'harvey', name: 'Harvey' }, { id: 'gone', name: 'Gone' }], [
    { companyId: 'harvey', guid: 'old', publishedAt: iso(API_NOW - 3 * DAY_MS) },
    { companyId: 'harvey', guid: 'new', publishedAt: iso(API_NOW - DAY_MS), sentiment: 'negative' },
    { companyId: 'gone', guid: 'gone-1', publishedAt: iso(API_NOW - 1000) },
  ]);
  assert.deepEqual(body.recent.map((r) => [r.companyName, r.sentiment]), [['Harvey', 'negative'], ['Harvey', 'positive']]);
  assert.ok(body.recent[0].title && body.recent[0].url && body.recent[0].publishedAt);
  assert.equal(body.totals.mentions, 2, 'Gone is not in the company list (D79)');
  assert.equal(body.totals.companies, 1);
});

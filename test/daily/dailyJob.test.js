// dailyJob.test.js — one whole daily run (src/daily/dailyJob.js, D102, D105, D106), end to end:
// search → duplicates skipped → classify → new mentions → api signal → Discord → alerted → data/.
// Also: Discord failing (the mentions go out next time), a digest of several messages where a
// later one fails, a busy database right after Discord accepted a message, a quiet day, a company
// Google refuses, a company not in the database yet, the "failed for good" warning once per run,
// Ollama down for a while, waiting for the 90-day collection (also one stopped halfway), run.json's
// collection times, the days searched (also in a database filled from data/).
// Offline: a temporary database and data/ folder; fake Google, Ollama, api and Discord.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDb } from '../helpers.js';
import { SECTION_NAMES, addCompanies, addRun, makeFakeClient } from '../classifier/classifierHelpers.js';
import { createClassifier } from '../../src/classifier/classifierLoop.js';
import { OllamaUnavailableError } from '../../src/classifier/ollamaClient.js';
import { PermanentFetchError } from '../../src/collector/googleNews.js';
import { runDailyJob } from '../../src/daily/dailyJob.js';
import { dailySearchRange } from '../../src/daily/dailyCollect.js';
import { writeDailyExport } from '../../src/daily/dailyExport.js';
import { dayNumberOf } from '../../src/collector/dateWindows.js';

// "Now": 28 Sep 2026 00:30 UTC (03:30 in Israel). The daily search covers 27 + 28 Sep.
const NOW = Date.parse('2026-09-28T00:30:00.000Z');
const COMPANY_NAMES = ['Harvey', 'Ukko'];

// A raw Google item like parseFeed returns.
function item(guid, { day = '2026-09-27', title = `${guid} headline - News`, publisher = 'News' } = {}) {
  return { guid, link: `https://news.google.com/rss/articles/${guid}`, title, publisher, pubDate: `${day}T10:00:00.000Z` };
}

// A fake Google client: `feeds` = { companyName: [items] or an Error to throw }. Records the searches.
function fakeGoogle(feeds) {
  const searches = [];
  return {
    searches,
    async search(query, { companyName }) {
      searches.push({ query, companyName });
      await new Promise((resolve) => setImmediate(resolve));
      const feed = feeds[companyName] ?? [];
      if (feed instanceof Error) throw feed;
      return { items: feed, itemCount: feed.length };
    },
  };
}

// The fake AI: guids with "irr" are not about the company; "neg" = negative; the rest positive.
function decide(article) {
  if (article.title.includes('irr')) return { relevant: false };
  return { relevant: true, sentiment: article.title.includes('neg') ? 'negative' : 'positive' };
}

// Sets up a database with Harvey (one mention from the 90-day run) and Ukko, a data/ folder with
// an old run.json, and everything a run needs. Returns the parts and a `run(extra)` function.
function setup(t, { feeds, client = makeFakeClient(decide), send } = {}) {
  const { db, dir, openOther } = makeTempDb(t);
  addCompanies(db, [{ id: 'harvey', name: 'Harvey' }, { id: 'ukko', name: 'Ukko' }]);
  db.prepare(`INSERT INTO Mention (company_id, guid, url, title, publisher, published_at, first_seen_at, sentiment)
              VALUES ('harvey', 'h-old', 'https://x', 'h-old headline - News', 'News', '2026-09-20T10:00:00.000Z', '2026-09-27T08:00:00.000Z', 'neutral')`).run();
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'run.json'), JSON.stringify({ runId: 1, model: 'qwen3:4b', note: 'from the 90-day run' }));

  const google = fakeGoogle(feeds);
  const classifier = createClassifier({ db, client, sectionNames: SECTION_NAMES, sleep: async () => {}, log: () => {}, warn: () => {} });
  const sent = [];
  const signals = [];
  const lines = { log: [], warn: [] };
  const run = (extra = {}) => runDailyJob({
    db,
    googleClient: google,
    classifier,
    companyNames: COMPANY_NAMES,
    now: () => NOW,
    pid: process.pid,
    log: (text) => lines.log.push(text),
    warn: (text) => lines.warn.push(text),
    notify: async () => { signals.push(true); return { ok: true, pages: 1 }; },
    send: send ?? (async (body) => { sent.push(body); return { ok: true }; }),
    writeExport: (options) => writeDailyExport(db, { ...options, dataDir }),
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    ...extra,
  });
  const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
  return { db, google, client, sent, signals, lines, run, readJson, dataDir, openOther };
}

const STANDARD_FEEDS = {
  Harvey: [item('h-old', { day: '2026-09-20' }), item('h-new1'), item('h-new2-neg', { day: '2026-09-28' }), item('h-older', { day: '2026-09-25' })],
  Ukko: [item('u-irr'), item('u-new-neg')],
};

test('a whole run: only the really new mentions reach the dashboard, Discord and data/', async (t) => {
  const { db, google, sent, signals, run, readJson } = setup(t, { feeds: STANDARD_FEEDS });
  const result = await run();
  assert.equal(result.status, 'done');
  assert.equal(result.newMentions, 3);
  assert.equal(result.alertSent, true);

  // The search: every company, 27–28 Sep (Google's before:/after: exclude the given day).
  assert.deepEqual(google.searches.map((s) => s.companyName), ['Harvey', 'Ukko']);
  assert.match(google.searches[0].query, /^after:2026-09-26 before:2026-09-29 "Harvey"$/);

  // Mentions: the old one kept, the known one skipped, the one outside the 2 days dropped, the
  // not-relevant one deleted, three new ones added.
  const guids = db.prepare('SELECT guid FROM Mention ORDER BY guid').all().map((row) => row.guid);
  assert.deepEqual(guids, ['h-new1', 'h-new2-neg', 'h-old', 'u-new-neg']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n, 0);

  // The dashboard was told once; Discord got the lean digest with only the new mentions.
  assert.equal(signals.length, 1);
  assert.equal(sent.length, 1);
  const { title, description } = sent[0].embeds[0];
  assert.equal(title, '📰 New press mentions · Mon 28 Sep');
  assert.match(description, /\*\*Harvey\*\* · 2 {3}🟢 1 {2}🔴 1\n\*\*Ukko\*\* · 1 {3}🔴 1\n/);
  assert.match(description, /\*\*3\*\* new/);

  // Every mention is alerted now (the old one by the first-run marking).
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention WHERE alerted_at IS NULL').get().n, 0);

  // data/: the new mentions merged in, the new totals, and the daily run in run.json.
  const mentions = readJson('mentions.json').mentions;
  assert.deepEqual(mentions.map((m) => m.guid).sort(), ['h-new1', 'h-new2-neg', 'h-old', 'u-new-neg']);
  assert.ok(mentions.every((m) => m.alertedAt !== null));
  const harvey = readJson('companies.json').companies.find((c) => c.name === 'Harvey');
  assert.deepEqual(harvey.sentimentCounts, { positive: 1, neutral: 1, negative: 1 });
  const runJson = readJson('run.json');
  assert.equal(runJson.note, 'from the 90-day run'); // no collection row in this database: kept as it was
  assert.equal(runJson.asOf, readJson('companies.json').asOf);
  assert.deepEqual({ ...runJson.lastDailyRun, alertSentAt: typeof runJson.lastDailyRun.alertSentAt }, {
    dailyRunId: result.runId, startedAt: new Date(NOW).toISOString(), searchedDays: { from: '2026-09-27', to: '2026-09-28' },
    newMentions: 3, companiesWithNewMentions: 2, alertSentAt: 'string', companiesNotSearched: [],
  });

  // The run is recorded.
  const row = db.prepare('SELECT * FROM DailyRun WHERE id = ?').get(result.runId);
  assert.deepEqual([row.status, row.new_mentions, row.last_error, row.owner_pid], ['done', 3, null, null]);
  assert.ok(row.alert_sent_at);
});

test('Discord fails: the run is done, the mentions stay new, and the next run sends them', async (t) => {
  let discordUp = false;
  const sent = [];
  const send = async (body) => (discordUp ? (sent.push(body), { ok: true }) : { ok: false, error: 'Discord answered 502, after 3 tries' });
  const { db, run } = setup(t, { feeds: STANDARD_FEEDS, send });
  const first = await run();
  assert.equal(first.status, 'done');
  assert.equal(first.alertSent, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention WHERE alerted_at IS NULL').get().n, 3);
  const row = db.prepare('SELECT * FROM DailyRun WHERE id = ?').get(first.runId);
  assert.equal(row.alert_sent_at, null);
  assert.match(row.last_error, /Discord: Discord answered 502/);

  discordUp = true;
  const second = await run(); // Google returns the same articles: all duplicates now
  assert.equal(second.newMentions, 3);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].description, /\*\*3\*\* new/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention WHERE alerted_at IS NULL').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention').get().n, 4); // no duplicates added
});

test('a quiet day: the friendly message, no dashboard signal, data/ left alone', async (t) => {
  const { sent, signals, run, dataDir } = setup(t, { feeds: { Harvey: [item('h-old', { day: '2026-09-20' })] } });
  const before = fs.readFileSync(path.join(dataDir, 'run.json'), 'utf8');
  const result = await run();
  assert.equal(result.status, 'done');
  assert.equal(result.newMentions, 0);
  assert.equal(signals.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].embeds[0].title, '☕ All quiet on the press front · Mon 28 Sep');
  assert.match(sent[0].embeds[0].description, /No new mentions for your 2 companies today/);
  assert.equal(fs.readFileSync(path.join(dataDir, 'run.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dataDir, 'mentions.json')), false);
});

test('a company Google keeps refusing is skipped and named; the others are still searched', async (t) => {
  const feeds = { ...STANDARD_FEEDS, Harvey: new PermanentFetchError('Google answered 400 Bad Request, 3 tries 1 min apart') };
  const { db, run, readJson } = setup(t, { feeds });
  const result = await run();
  assert.equal(result.status, 'done');
  assert.equal(result.newMentions, 1); // Ukko's
  assert.match(db.prepare('SELECT last_error FROM DailyRun WHERE id = ?').get(result.runId).last_error, /not searched: Harvey/);
  assert.deepEqual(readJson('run.json').lastDailyRun.companiesNotSearched, ['Harvey']);
});

test('Ollama down for a while: the articles wait, and are classified once it is back', async (t) => {
  const client = makeFakeClient(decide);
  let failuresLeft = 2;
  const realCheck = client.checkReady;
  client.checkReady = async () => {
    if (failuresLeft > 0) { failuresLeft -= 1; throw new OllamaUnavailableError('Ollama is not reachable (ECONNREFUSED)'); }
    return realCheck();
  };
  const { run, lines } = setup(t, { feeds: STANDARD_FEEDS, client });
  const result = await run();
  assert.equal(result.status, 'done');
  assert.equal(result.newMentions, 3);
  assert.equal(lines.warn.filter((line) => line.startsWith('Ollama is not ready')).length, 2);
});

test('while the 90-day collection is not finished, the daily run waits (nothing is changed)', async (t) => {
  const { db, google, run } = setup(t, { feeds: STANDARD_FEEDS });
  addRun(db, { status: 'collected' });
  const result = await run();
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /still being classified/);
  assert.equal(google.searches.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM DailyRun').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention WHERE alerted_at IS NULL').get().n, 1); // not marked
});

test('with a finished 90-day collection: run.json keeps its real end time and gets lastDailyRun', async (t) => {
  const { db, run, readJson } = setup(t, { feeds: STANDARD_FEEDS });
  addRun(db, { status: 'done', finishedAt: '2026-09-27T09:00:00.000Z', companyIds: ['harvey', 'ukko'] });
  const result = await run();
  const runJson = readJson('run.json');
  assert.equal(runJson.finishedAt, '2026-09-27T09:00:00.000Z');
  assert.equal(runJson.asOf, new Date(NOW).toISOString());
  assert.equal(runJson.lastDailyRun.dailyRunId, result.runId);
  assert.equal(runJson.companies.total, 2);
});

test('an unexpected error ends the run as failed, with the reason', async (t) => {
  const { db, run } = setup(t, { feeds: STANDARD_FEEDS });
  const brokenGoogle = { async search() { throw new Error('something unexpected'); } };
  const result = await run({ googleClient: brokenGoogle });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /something unexpected/);
  const row = db.prepare('SELECT * FROM DailyRun WHERE id = ?').get(result.runId);
  assert.deepEqual([row.status, row.owner_pid], ['failed', null]);
  assert.match(row.last_error, /something unexpected/);
});

test('an empty database (no companies) is a clear failure, not a crash', async (t) => {
  const { db, run } = setup(t, { feeds: {} });
  db.exec('DELETE FROM Mention; DELETE FROM Company;');
  const result = await run();
  assert.equal(result.status, 'failed');
  assert.match(result.error, /no companies yet/);
});

test('the days searched: yesterday + today, or back to the last search after a gap (at most 90 days)', () => {
  const today = dayNumberOf(NOW);
  assert.deepEqual(dailySearchRange(NOW, null), { start: today - 1, end: today });
  assert.deepEqual(dailySearchRange(NOW, '2026-09-27T00:05:00.000Z'), { start: today - 1, end: today }); // yesterday's run
  assert.deepEqual(dailySearchRange(NOW, '2026-09-23T00:05:00.000Z'), { start: today - 5, end: today }); // off for days
  assert.deepEqual(dailySearchRange(NOW, '2026-01-01T00:00:00.000Z'), { start: today - 89, end: today }); // capped
});

test('a digest of several messages where a later one fails: the first one\'s mentions are marked, the rest stay new', async (t) => {
  // 45 companies with long names: the list needs more than one Discord message.
  const names = Array.from({ length: 45 }, (_, i) => `Company ${String(i).padStart(2, '0')} ${'x'.repeat(80)}`);
  const feeds = Object.fromEntries(names.map((name, i) => [name, [item(`c${i}-new`)]]));
  let calls = 0;
  const sent = [];
  const send = async (body) => {
    calls += 1;
    if (calls === 1) { sent.push(body); return { ok: true }; }
    return { ok: false, error: 'Discord answered 502, after 3 tries' };
  };
  const { db, run } = setup(t, { feeds, send });
  addCompanies(db, names.map((name, i) => ({ id: `c${i}`, name })));
  const result = await run({ companyNames: names });

  assert.equal(result.status, 'done');
  assert.equal(result.newMentions, 45);
  assert.equal(result.alertSent, false);
  assert.equal(calls, 2); // the second message failed: no third one is tried
  const listed = sent[0].embeds[0].description.split('\n').filter((line) => line.startsWith('**Company')).length;
  assert.ok(listed > 0 && listed < 45, `the first message lists ${listed} companies`);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM Mention WHERE alerted_at IS NULL AND company_id LIKE 'c%'").get().n, 45 - listed);
  const row = db.prepare('SELECT * FROM DailyRun WHERE id = ?').get(result.runId);
  assert.equal(row.alert_sent_at, null);
  assert.match(row.last_error, /Discord: Discord answered 502/);
});

test('the database is busy right after Discord accepted the message: retried, the run is done, no second message', async (t) => {
  const { db, run, sent, lines, openOther } = setup(t, { feeds: STANDARD_FEEDS });
  db.exec('PRAGMA busy_timeout = 0'); // a busy database fails at once instead of after 5 s
  const other = openOther(); // another program writing at that moment
  let locked = false;
  const result = await run({
    send: async (body) => { sent.push(body); other.exec('BEGIN IMMEDIATE'); locked = true; return { ok: true }; },
    sleep: async () => {
      if (locked) { other.exec('COMMIT'); locked = false; }
      await new Promise((resolve) => setImmediate(resolve));
    },
  });
  assert.equal(result.status, 'done');
  assert.equal(result.alertSent, true);
  assert.equal(sent.length, 1);
  assert.ok(lines.warn.some((line) => /^Database busy \(mark the sent mentions as alerted\)/.test(line)));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Mention WHERE alerted_at IS NULL').get().n, 0);
  assert.equal(db.prepare('SELECT status FROM DailyRun WHERE id = ?').get(result.runId).status, 'done');
});

test('a company in the list but not in the database yet: one warning with the seed hint; the others are searched', async (t) => {
  const { google, run, lines } = setup(t, { feeds: STANDARD_FEEDS });
  const result = await run({ companyNames: [...COMPANY_NAMES, 'Newco'] });
  assert.equal(result.status, 'done');
  assert.deepEqual(google.searches.map((s) => s.companyName), ['Harvey', 'Ukko']);
  const warnings = lines.warn.filter((line) => line.includes('not in the database yet'));
  assert.deepEqual(warnings, ['1 company in the list is not in the database yet, so not searched: Newco. Run "npm run seed" to add them.']);
});

test('queue rows that failed the AI step for good are reported once per run, not once per company', async (t) => {
  const { db, run, lines } = setup(t, { feeds: STANDARD_FEEDS });
  db.prepare(`INSERT INTO BufferQueue (company_id, guid, url, title, published_at, first_seen_at, status, attempts)
              VALUES ('harvey', 'dead', 'https://x', 'dead - News', '2026-09-27T00:00:00Z', '2026-09-27T00:00:00Z', 'failed', 3)`).run();
  const result = await run();
  assert.equal(result.status, 'done');
  assert.equal(lines.warn.filter((line) => line.includes('failed the AI step for good')).length, 1);
});

test('a 90-day collection stopped halfway (its program is gone): the daily run waits and says how to finish it', async (t) => {
  const { db, google, run } = setup(t, { feeds: STANDARD_FEEDS });
  addRun(db, { status: 'running', ownerPid: 999999 });
  const result = await run({ isAlive: () => false });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /was stopped halfway and nothing is working on it\. Run "npm start" to finish it/);
  assert.equal(google.searches.length, 0);
});

test('run.json keeps the collection\'s collectedAt and finishedAt from the current data/ (same run)', async (t) => {
  const { db, run, readJson, dataDir } = setup(t, { feeds: STANDARD_FEEDS });
  const runId = addRun(db, { status: 'done', finishedAt: '2026-09-27T07:01:06.000Z', companyIds: ['harvey', 'ukko'] });
  fs.writeFileSync(path.join(dataDir, 'run.json'), JSON.stringify({ runId, collectedAt: '2026-09-27T06:30:33.000Z', finishedAt: '2026-09-27T07:01:05.000Z' }));
  await run();
  const runJson = readJson('run.json');
  assert.equal(runJson.collectedAt, '2026-09-27T06:30:33.000Z'); // not the "done" time
  assert.equal(runJson.finishedAt, '2026-09-27T07:01:05.000Z');
  assert.equal(runJson.asOf, new Date(NOW).toISOString());
});

test('a database filled from data/ (no collection, no daily run): the first run searches from the snapshot on', async (t) => {
  const { db, google, run } = setup(t, { feeds: STANDARD_FEEDS });
  db.prepare("UPDATE Mention SET first_seen_at = '2026-09-23T08:00:00.000Z'").run(); // data/ is 5 days old
  await run();
  assert.match(google.searches[0].query, /^after:2026-09-22 before:2026-09-29 /);

  const old = setup(t, { feeds: STANDARD_FEEDS });
  old.db.prepare("UPDATE Mention SET first_seen_at = '2026-01-01T08:00:00.000Z'").run(); // very old: at most 90 days
  await old.run();
  assert.match(old.google.searches[0].query, /^after:2026-06-30 before:2026-09-29 /);
});

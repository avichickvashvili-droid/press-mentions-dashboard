// queries.js — the read-only database questions behind the api's two endpoints (D19, 1.4).
//
// Where it sits: called by the routes in src/api/app.js on every request. The company status
// itself comes from src/shared/companyStatus.js (the same code the data/ export uses, D99).
// Reads: the Company and Mention tables. Writes: nothing.
//
// The rolling 90-day window is worked out from `now` on every call, never stored (D13, NFR5).
// The same for "this week" (Recent activity, D110): counted on every call, never stored.

import { buildCompanyStatuses, windowStartFor } from '../shared/companyStatus.js';

// Counts, per company, its mentions published in the last `activityDays` days ("this week") and
// in the `activityDays` before them ("the week before"). Returns a Map: id -> { week, prev }.
function countRecentActivity(db, now, activityDays) {
  const weekStart = windowStartFor(now, activityDays);
  const prevStart = windowStartFor(now, activityDays * 2);
  const rows = db.prepare(`
    SELECT company_id,
           SUM(published_at >= ?) AS week,
           SUM(published_at < ?) AS prev
    FROM Mention
    WHERE published_at >= ?
    GROUP BY company_id`).all(weekStart, weekStart, prevStart);
  return new Map(rows.map((row) => [row.company_id, { week: Number(row.week), prev: Number(row.prev) }]));
}

// GET /api/companies: every company in the list now, with its status, section (number and
// name), mention count and sentiment totals. `sectionNames` = { number: name }.
// The api also adds (not in data/companies.json): weekCount / prevWeekCount (Recent activity,
// `activityDays` days each, D110) and logoUrl ("/logos/<file>", or null: `logoUrls` is a Map).
// Returns { asOf, windowStart, windowDays, companies }. windowDays is sent so the page shows
// the real window length (the setting DASHBOARD_WINDOW_DAYS), never a fixed "90".
export function readCompanyList(db, { now, windowDays, companyNames, sectionNames, activityDays = 7, logoUrls = new Map() }) {
  const { asOf, windowStart, companies } = buildCompanyStatuses(db, { now, windowDays, companyNames });
  const activity = countRecentActivity(db, now, activityDays);
  return {
    asOf,
    windowStart,
    windowDays,
    // sectionName is added next to the section number, for the page (owner-approved, Q5).
    companies: companies.map(({ id, name, section, ...rest }) => ({
      id, name, section, sectionName: sectionNames[section] ?? null, ...rest,
      weekCount: activity.get(id)?.week ?? 0,
      prevWeekCount: activity.get(id)?.prev ?? 0,
      logoUrl: logoUrls.get(id) ?? null,
    })),
  };
}

// Finds one company by its id: { id, name }, or null when there is no such company.
export function findCompany(db, id) {
  return db.prepare('SELECT id, name FROM Company WHERE id = ?').get(id) ?? null;
}

// GET /api/companies/:id/mentions: the company's mentions inside the window, newest first
// (ties: the order they were saved). No snippet: none is stored (D99).
export function readCompanyMentions(db, companyId, { now, windowDays }) {
  const windowStart = windowStartFor(now, windowDays);
  return db.prepare(`
    SELECT title, url, publisher, published_at, sentiment
    FROM Mention
    WHERE company_id = ? AND published_at >= ?
    ORDER BY published_at DESC, id`).all(companyId, windowStart)
    .map((row) => ({
      title: row.title,
      url: row.url,
      publisher: row.publisher,
      publishedAt: row.published_at,
      sentiment: row.sentiment,
    }));
}

// The daily job's latest result for the top of the page (owner, Prompt 333, D113):
//   latest   the newest daily run: { id, status: 'running' | 'done' | 'failed', startedAt, finishedAt }
//   lastDone the newest finished run: { id, finishedAt, newMentions, companiesWithUpdates, discordSent }
// The numbers match that run's Discord message: when Discord accepted it, they are the mentions
// the message marked as sent (alerted_at inside the run); if it was not sent, the mentions the run
// found (first_seen_at inside the run). Both are null before the first daily run, or when the
// DailyRun table can't be read (an old database): the page then simply shows no daily-run numbers.
export function readDailySummary(db) {
  try {
    const latest = db.prepare('SELECT id, status, started_at, finished_at FROM DailyRun ORDER BY id DESC LIMIT 1').get();
    const done = db.prepare("SELECT id, started_at, finished_at, alert_sent_at FROM DailyRun WHERE status = 'done' ORDER BY id DESC LIMIT 1").get();
    let lastDone = null;
    if (done) {
      const column = done.alert_sent_at ? 'alerted_at' : 'first_seen_at';
      const counts = db.prepare(`
        SELECT COUNT(*) AS mentions, COUNT(DISTINCT company_id) AS companies
        FROM Mention WHERE ${column} > ? AND ${column} <= ?`).get(done.started_at, done.finished_at);
      lastDone = {
        id: done.id,
        finishedAt: done.finished_at,
        newMentions: Number(counts.mentions),
        companiesWithUpdates: Number(counts.companies),
        discordSent: Boolean(done.alert_sent_at),
      };
    }
    return {
      latest: latest ? { id: latest.id, status: latest.status, startedAt: latest.started_at, finishedAt: latest.finished_at } : null,
      lastDone,
    };
  } catch {
    return { latest: null, lastDone: null };
  }
}

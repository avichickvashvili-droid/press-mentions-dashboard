// companyStatus.js — works out every company's status from the database: "mentioned N days ago"
// or "no coverage", plus its mention count and sentiment totals (FR1, FR5, D99).
//
// Where it sits: the ONE place this is computed. Used by the data/ export
// (src/classifier/exporter.js, for data/companies.json) and by the api
// (GET /api/companies, src/api/app.js), so the two always agree.
// Reads: the Company and Mention tables (read-only).
// Writes: nothing.
//
// Rules:
//   - Only mentions inside the rolling window count: published_at >= now - windowDays (90).
//     Old mentions are filtered here, never deleted (D13).
//   - Only companies in the company list NOW are returned (D79), in name order (A-Z, ignoring
//     upper/lower case). A company with no mention in the window is still returned, as
//     'no_coverage' (FR1).
//   - "daysAgo" = whole days (24-hour periods) between the latest mention and `now`, never
//     below 0. It is computed when asked, never stored (NFR5). The totals are counted when
//     asked, never stored (D99).

const DAY_MS = 24 * 60 * 60 * 1000;

// The start of the rolling window as ISO text: `windowDays` days before `now` (a time in ms).
export function windowStartFor(now, windowDays) {
  return new Date(now - windowDays * DAY_MS).toISOString();
}

// Whole days between a mention's date and `now` (never below 0).
export function daysBetween(fromIso, now) {
  return Math.max(0, Math.floor((now - Date.parse(fromIso)) / DAY_MS));
}

// Counts, per company, its mentions inside the window: how many, the latest date, and how many
// of each sentiment. Returns a Map: company id -> { count, last, sentimentCounts }.
function countMentionsInWindow(db, windowStart) {
  const rows = db.prepare(`
    SELECT company_id,
           COUNT(*) AS mention_count,
           MAX(published_at) AS last_mention_at,
           SUM(sentiment = 'positive') AS positive,
           SUM(sentiment = 'neutral') AS neutral,
           SUM(sentiment = 'negative') AS negative
    FROM Mention
    WHERE published_at >= ?
    GROUP BY company_id`).all(windowStart);
  const perCompany = new Map();
  for (const row of rows) {
    perCompany.set(row.company_id, {
      count: Number(row.mention_count),
      last: row.last_mention_at,
      sentimentCounts: { positive: Number(row.positive), neutral: Number(row.neutral), negative: Number(row.negative) },
    });
  }
  return perCompany;
}

// Builds the status of every company in the list: { asOf, windowStart, companies: [...] }.
// Each company: { id, name, section, hint, status, lastMentionAt, daysAgo, mentionCount,
// sentimentCounts: { positive, neutral, negative } } (the shape of data/companies.json).
// `now` = the time the status is worked out for (ms); `companyNames` = the names in the company
// list now (D79).
export function buildCompanyStatuses(db, { now, windowDays, companyNames }) {
  const asOf = new Date(now).toISOString();
  const windowStart = windowStartFor(now, windowDays);
  const inList = new Set(companyNames);
  const perCompany = countMentionsInWindow(db, windowStart);

  const companyRows = db.prepare('SELECT id, name, section, hint FROM Company ORDER BY name COLLATE NOCASE').all()
    .filter((company) => inList.has(company.name));
  const companies = companyRows.map((company) => {
    const entry = perCompany.get(company.id);
    return {
      id: company.id,
      name: company.name,
      section: company.section,
      hint: company.hint,
      status: entry ? 'mentioned' : 'no_coverage',
      lastMentionAt: entry ? entry.last : null,
      daysAgo: entry ? daysBetween(entry.last, now) : null,
      mentionCount: entry ? entry.count : 0,
      sentimentCounts: entry ? entry.sentimentCounts : { positive: 0, neutral: 0, negative: 0 },
    };
  });
  return { asOf, windowStart, companies };
}

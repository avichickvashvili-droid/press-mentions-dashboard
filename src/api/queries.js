// queries.js — the read-only database questions behind the api's two endpoints (D19, 1.4).
//
// Where it sits: called by the routes in src/api/app.js on every request. The company status
// itself comes from src/shared/companyStatus.js (the same code the data/ export uses, D99).
// Reads: the Company and Mention tables. Writes: nothing.
//
// The rolling 90-day window is worked out from `now` on every call, never stored (D13, NFR5).

import { buildCompanyStatuses, windowStartFor } from '../shared/companyStatus.js';

// GET /api/companies: every company in the list now, with its status, section (number and
// name), mention count and sentiment totals. `sectionNames` = { number: name }.
// Returns { asOf, windowStart, companies }.
export function readCompanyList(db, { now, windowDays, companyNames, sectionNames }) {
  const { asOf, windowStart, companies } = buildCompanyStatuses(db, { now, windowDays, companyNames });
  return {
    asOf,
    windowStart,
    // sectionName is added next to the section number, for the page (owner-approved, Q5).
    companies: companies.map(({ id, name, section, ...rest }) => ({
      id, name, section, sectionName: sectionNames[section] ?? null, ...rest,
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

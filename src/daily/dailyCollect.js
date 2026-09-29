// dailyCollect.js — the daily search: every company in the list, for the last days only (D102, D106).
//
// Where it sits: step 2 of a daily run (dailyJob.js). It reuses the collector's own parts, so the
// daily job finds and skips articles exactly like the 90-day collection does:
//   - collectCompany (src/collector/companyLoop.js): the searches, splitting a window that returns
//     95+ articles, the queue limit;
//   - the Google News client: the 1-request-per-second pace, and retrying Google's temporary
//     problems until they pass (no internet, 429, 5xx, CAPTCHA: "run when possible");
//   - the item rules and the duplicate checks (bufferWriter.js): an article the company already
//     has in BufferQueue or Mention (same guid, or same publisher + title) is skipped (D16, D33).
// Reads: Company (the companies in the list now), BufferQueue, Mention. Writes: BufferQueue.
//
// The days searched (whole UTC days, both ends included): normally yesterday + today
// (DAILY_SEARCH_DAYS = 2; Google takes dates only, I40). When the last search is older (the
// computer was off for days), it starts from the day the last search ran (that day is searched
// again, for articles that came out after it), so no day is skipped; never more than
// COLLECTION_DAYS back.
// A company that Google keeps refusing (400 three times) is skipped for this run and named in the
// result; the others go on.
// A name in the company list that has no Company row yet (added to the list after seeding) can't
// be searched: one warning per run names them and says to run `npm run seed`.
// Queue rows that failed the AI step for good are reported once per run (one reporter for the
// whole search), not once per company.

import { config } from '../config.js';
import { createSessionStats, collectCompany } from '../collector/companyLoop.js';
import { createDeadRowReporter } from '../collector/bufferWriter.js';
import { dayNumberOf, formatDay } from '../collector/dateWindows.js';
import { PermanentFetchError } from '../collector/googleNews.js';
import { cleanForLog } from '../shared/text.js';

// The days to search: { start, end } as UTC day numbers.
// `lastSearchStartedAt` = when the last search started (the last successful daily run, or the
// last finished 90-day collection), or null.
export function dailySearchRange(now, lastSearchStartedAt = null, {
  searchDays = config.DAILY_SEARCH_DAYS, maxDays = config.COLLECTION_DAYS,
} = {}) {
  const today = dayNumberOf(now);
  let start = today - (searchDays - 1);
  if (lastSearchStartedAt) {
    const fromLastSearch = dayNumberOf(lastSearchStartedAt);
    if (fromLastSearch < start) start = fromLastSearch;
  }
  start = Math.max(start, today - (maxDays - 1));
  return { start, end: today };
}

// The range as text for the log, e.g. "2026-09-27 to 2026-09-28".
export function describeRange(range) {
  return `${formatDay(range.start)} to ${formatDay(range.end)}`;
}

// How many names of the "not in the database" warning are written out; the rest are counted.
const MISSING_NAMES_SHOWN = 10;

// The companies to search: those in the company list now (D79), in list order.
// Returns { companies, missing } (missing = names in the list with no Company row yet).
function readCompaniesToSearch(db, companyNames) {
  const inList = new Set(companyNames);
  const companies = db.prepare('SELECT id, name, query_param FROM Company ORDER BY rowid').all().filter((company) => inList.has(company.name));
  const inDatabase = new Set(companies.map((company) => company.name));
  const missing = [...inList].filter((name) => !inDatabase.has(name));
  return { companies, missing };
}

// The warning for list names that are not in the database yet (see the top).
function describeMissing(missing) {
  const shown = missing.slice(0, MISSING_NAMES_SHOWN).map((name) => cleanForLog(name)).join(', ');
  const more = missing.length > MISSING_NAMES_SHOWN ? ` and ${missing.length - MISSING_NAMES_SHOWN} more` : '';
  return `${missing.length} ${missing.length === 1 ? 'company in the list is' : 'companies in the list are'} not in the database yet, so not searched: ${shown}${more}. Run "npm run seed" to add them.`;
}

// Searches every company for the range and puts the new articles in the queue.
// `shouldStop()` is checked before each company (Ctrl+C). `log` / `warn` print lines.
// Returns { companies, stats: { inserted, duplicates, badItems, outsideRange }, failed: [{ name, reason }],
// notInDatabase: [names] }.
export async function collectDaily({
  db, client, range, companyNames, log = console.log, warn = console.warn, shouldStop = () => false,
}) {
  const { companies, missing } = readCompaniesToSearch(db, companyNames);
  if (missing.length > 0) warn(describeMissing(missing));
  const stats = createSessionStats();
  const reportDeadRows = createDeadRowReporter(warn); // one for the whole search: no repeated warnings
  const failed = [];
  const progress = {
    update() {},
    info: log,
    warn,
    error: warn,
  };

  for (const [index, company] of companies.entries()) {
    if (shouldStop()) break;
    try {
      await collectCompany({ db, company, range, client, progress, stats, reportDeadRows });
    } catch (error) {
      if (!(error instanceof PermanentFetchError)) throw error;
      failed.push({ name: company.name, reason: error.message });
      warn(`${cleanForLog(company.name)}: ${error.message}. Skipped in this run.`);
    }
    if ((index + 1) % 50 === 0) log(`Searched ${index + 1} of ${companies.length} companies (${stats.inserted} new articles so far).`);
  }
  return { companies: companies.length, stats, failed, notInDatabase: missing };
}

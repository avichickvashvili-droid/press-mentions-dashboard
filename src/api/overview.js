// overview.js — GET /api/overview: the numbers behind the Overview page (owner, Prompt 364, D117):
// totals and their trend, mentions per day and per month by sentiment, "Needs attention" and the
// newest mentions of all companies.
//
// Where it sits: called by the route in src/api/app.js on every request. It gets the company list
// already built for GET /api/companies (readCompanyList), so both answers count the same
// companies (only those in the company list now, D79) and the same 90-day window.
// Reads: the Mention table (read-only). Writes: nothing. Nothing is stored (D13, NFR5).
//
// Days and months are Israel days (config.OVERVIEW.TIME_ZONE), like the mentions panel (D111):
// a mention at 23:30 UTC on 30 Sep is 1 Oct in Israel. Every day of the window is in the answer,
// also days without mentions (0), so the chart has no gaps.

import { config } from '../config.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SENTIMENTS = ['positive', 'neutral', 'negative'];

// A function that turns a time (ms or ISO text) into its day in `timeZone`: "2026-09-30".
export function makeDayKey(timeZone) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (time) => format.format(new Date(time));
}

// Every day from the day of `fromMs` to the day of `toMs` (in `dayKey`'s time zone), in order.
// Steps by 12 hours so a daylight-saving change never skips or repeats a day.
function listDays(fromMs, toMs, dayKey) {
  const days = [];
  for (let t = fromMs; t <= toMs + DAY_MS; t += DAY_MS / 2) {
    const day = dayKey(Math.min(t, toMs));
    if (days[days.length - 1] !== day) days.push(day);
    if (t >= toMs) break;
  }
  return days;
}

// An empty { positive, neutral, negative } counter.
const emptyCounts = () => ({ positive: 0, neutral: 0, negative: 0 });

// Adds one mention's sentiment to a counter (an unknown sentiment is not counted).
function addSentiment(counts, sentiment) {
  if (SENTIMENTS.includes(sentiment)) counts[sentiment] += 1;
}

// "Needs attention": finds the companies worth a look this week. `perCompany` = Map id -> stats
// (see readOverview). Returns up to `limit` items, the strongest of each kind taken in turn, so one
// kind never fills the whole list: negative, spike, quiet, positive.
function findAttention(companies, perCompany, { limit, minWeek, spikeRatio, negativeShare, positiveShare, quietMinBefore }) {
  const byKind = { negative: [], spike: [], quiet: [], positive: [] };
  for (const company of companies) {
    const stats = perCompany.get(company.id);
    if (!stats) continue;
    const { week, prev, weekNegative, weekPositive, before, lastAt } = stats;
    if (week >= minWeek && weekNegative / week >= negativeShare) {
      byKind.negative.push({ company, kind: 'negative', strength: weekNegative / week, value: Math.round((weekNegative / week) * 100), week, count: weekNegative });
    }
    if (week >= minWeek && week >= prev * spikeRatio) {
      const change = prev > 0 ? Math.round(((week - prev) / prev) * 100) : null;
      // Ranked by how many mentions the week added, so a spike from nothing (0 → 23) does not
      // outrank a bigger real one (8 → 46) (code review #3).
      byKind.spike.push({ company, kind: 'spike', strength: week - prev, value: change, week, prev });
    }
    if (week === 0 && before >= quietMinBefore) {
      byKind.quiet.push({ company, kind: 'quiet', strength: before, value: before, lastAt });
    }
    if (week >= minWeek && weekPositive / week >= positiveShare) {
      byKind.positive.push({ company, kind: 'positive', strength: weekPositive / week, value: Math.round((weekPositive / week) * 100), week, count: weekPositive });
    }
  }
  for (const list of Object.values(byKind)) list.sort((a, b) => b.strength - a.strength || a.company.name.localeCompare(b.company.name));
  // In turn, each kind adds its strongest company not listed yet (one item per company).
  const picked = [];
  const used = new Set();
  const next = Object.fromEntries(Object.keys(byKind).map((kind) => [kind, 0]));
  let added = true;
  while (picked.length < limit && added) {
    added = false;
    for (const kind of Object.keys(byKind)) {
      const list = byKind[kind];
      while (next[kind] < list.length && used.has(list[next[kind]].company.id)) next[kind] += 1;
      if (next[kind] < list.length && picked.length < limit) {
        const item = list[next[kind]];
        picked.push(item);
        used.add(item.company.id);
        next[kind] += 1;
        added = true;
      }
    }
  }
  return picked;
}

// GET /api/overview. `list` = the answer of readCompanyList (asOf, windowStart, windowDays,
// companies with weekCount / prevWeekCount / logoUrl). `now` = the request time (ms).
// Returns { asOf, windowStart, windowDays, timeZone, totals, trend, daily, monthly, attention, recent }.
export function readOverview(db, { list, now, activityDays = config.ACTIVITY_DAYS, settings = config.OVERVIEW }) {
  const { TIME_ZONE, TREND_DAYS, RECENT_LIMIT, ATTENTION_SPARK_DAYS } = settings;
  const dayKey = makeDayKey(TIME_ZONE);
  const inList = new Map(list.companies.map((company) => [company.id, company]));

  // The window's mentions (only what the counts need), of the companies in the list.
  const rows = db.prepare(`
    SELECT company_id AS companyId, published_at AS publishedAt, sentiment
    FROM Mention
    WHERE published_at >= ? AND published_at <= ?`).all(list.windowStart, new Date(now).toISOString())
    .filter((row) => inList.has(row.companyId));

  const days = listDays(Date.parse(list.windowStart), now, dayKey);
  const daily = new Map(days.map((day) => [day, emptyCounts()]));
  // Every month of the window, also a month without mentions (0), like the days (code review #8).
  const monthly = new Map(days.map((day) => [day.slice(0, 7), emptyCounts()]));
  const totals = emptyCounts();
  const weekStart = now - activityDays * DAY_MS;
  const prevStart = now - 2 * activityDays * DAY_MS;
  const beforeStart = weekStart - settings.ATTENTION_QUIET_BEFORE_DAYS * DAY_MS;
  const trendStart = now - TREND_DAYS * DAY_MS;
  const trendPrevStart = now - 2 * TREND_DAYS * DAY_MS;
  const sparkDays = days.slice(-ATTENTION_SPARK_DAYS);
  const trend = { current: 0, previous: 0, days: TREND_DAYS };
  const perCompany = new Map();

  for (const { companyId, publishedAt, sentiment } of rows) {
    const time = Date.parse(publishedAt);
    const day = dayKey(time);
    addSentiment(totals, sentiment);
    if (daily.has(day)) addSentiment(daily.get(day), sentiment);
    const month = day.slice(0, 7);
    if (monthly.has(month)) addSentiment(monthly.get(month), sentiment);
    if (time >= trendStart) trend.current += 1;
    else if (time >= trendPrevStart) trend.previous += 1;

    if (!perCompany.has(companyId)) {
      perCompany.set(companyId, { week: 0, prev: 0, weekNegative: 0, weekPositive: 0, before: 0, lastAt: null, spark: new Map(), sparkNegative: new Map() });
    }
    const stats = perCompany.get(companyId);
    if (time >= weekStart) {
      stats.week += 1;
      if (sentiment === 'negative') stats.weekNegative += 1;
      if (sentiment === 'positive') stats.weekPositive += 1;
    } else if (time >= prevStart) {
      stats.prev += 1;
    }
    if (time < weekStart && time >= beforeStart) stats.before += 1;
    if (!stats.lastAt || publishedAt > stats.lastAt) stats.lastAt = publishedAt;
    stats.spark.set(day, (stats.spark.get(day) ?? 0) + 1);
    if (sentiment === 'negative') stats.sparkNegative.set(day, (stats.sparkNegative.get(day) ?? 0) + 1);
  }

  const attention = findAttention(list.companies, perCompany, {
    limit: settings.ATTENTION_LIMIT,
    minWeek: settings.ATTENTION_MIN_WEEK,
    spikeRatio: settings.ATTENTION_SPIKE_RATIO,
    negativeShare: settings.ATTENTION_NEGATIVE_SHARE,
    positiveShare: settings.ATTENTION_POSITIVE_SHARE,
    quietMinBefore: settings.ATTENTION_QUIET_MIN_BEFORE,
  }).map(({ company, kind, value, week, prev, count, lastAt }) => {
    const stats = perCompany.get(company.id);
    const source = kind === 'negative' ? stats.sparkNegative : stats.spark;
    return {
      companyId: company.id,
      name: company.name,
      logoUrl: company.logoUrl ?? null,
      kind,
      value,
      week: week ?? 0,
      prev: prev ?? null,
      count: count ?? null,
      lastAt: lastAt ?? null,
      spark: sparkDays.map((day) => source.get(day) ?? 0),
    };
  });

  // The newest mentions of all companies in the list (ties: the order they were saved).
  const recent = db.prepare(`
    SELECT id, company_id AS companyId, title, url, publisher, published_at AS publishedAt, sentiment
    FROM Mention
    WHERE published_at >= ? AND published_at <= ?
    ORDER BY published_at DESC, id DESC
    LIMIT ?`).all(list.windowStart, new Date(now).toISOString(), RECENT_LIMIT * 3)
    .filter((row) => inList.has(row.companyId))
    .slice(0, RECENT_LIMIT)
    .map((row) => ({
      ...row,
      companyName: inList.get(row.companyId).name,
      logoUrl: inList.get(row.companyId).logoUrl ?? null,
    }));

  return {
    asOf: list.asOf,
    windowStart: list.windowStart,
    windowDays: list.windowDays,
    timeZone: TIME_ZONE,
    totals: {
      mentions: totals.positive + totals.neutral + totals.negative,
      ...totals,
      companies: list.companies.length,
      companiesMentioned: list.companies.filter((company) => company.mentionCount > 0).length,
    },
    trend,
    daily: days.map((day) => ({ day, ...daily.get(day) })),
    monthly: [...monthly.keys()].sort().map((month) => ({ month, ...monthly.get(month) })),
    attention,
    recent,
  };
}

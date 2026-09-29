// mentionFilters.js — the filters of the mentions panel: the time range (24h / 7d / 30d / 90d),
// the sentiment (All / Positive / Neutral / Negative) and the headline search, plus the
// grouping of the list by day (owner, Prompts 319-320, D111).
//
// Where it sits: used by the MentionsPanel. All in the page: the api already sends every mention
// of the company in the window.
// Reads/writes: nothing.
//
// Each button's count is worked out with the OTHER filters applied (e.g. the sentiment counts
// follow the chosen time and the search), so a count always says what a click would show.
// Times count back from `now` (the api's asOf): "7d" = the same 7 days as "this week" in the
// company table.

import { dayKey } from './dates.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The time range choices. The last one is the whole window (its label uses the api's windowDays).
export function timeRanges(windowDays = 90) {
  return [
    { value: '24h', label: '24h', ms: 24 * HOUR_MS },
    { value: '7d', label: '7d', ms: 7 * DAY_MS },
    { value: '30d', label: '30d', ms: 30 * DAY_MS },
    { value: 'all', label: `${windowDays}d`, ms: null },
  ];
}

export const SENTIMENT_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
];

// The filters a panel starts with (also after switching to another company).
export const DEFAULT_MENTION_FILTERS = { range: 'all', sentiment: 'all', search: '' };

// True when `mention` is inside the time range `rangeValue`, counted back from `now` (ms).
function inRange(mention, rangeValue, now, ranges) {
  const range = ranges.find((r) => r.value === rangeValue);
  if (!range?.ms) return true;
  return Date.parse(mention.publishedAt) >= now - range.ms;
}

// True when the headline contains the search text (any case, spaces at the ends ignored).
function matchesSearch(mention, search) {
  const wanted = (search ?? '').trim().toLowerCase();
  return wanted === '' || String(mention.title ?? '').toLowerCase().includes(wanted);
}

// True when `mention` passes the filters, leaving out the one named in `skip` ('range' or
// 'sentiment'), for the button counts.
function passes(mention, filters, now, ranges, skip) {
  if (skip !== 'range' && !inRange(mention, filters.range, now, ranges)) return false;
  if (skip !== 'sentiment' && filters.sentiment !== 'all' && mention.sentiment !== filters.sentiment) return false;
  return matchesSearch(mention, filters.search);
}

// Filters the mentions and counts the buttons. Returns
// { mentions, rangeCounts: { '24h', '7d', '30d', all }, sentimentCounts: { all, positive, neutral, negative } }.
export function filterMentions(mentions, filters, { now, windowDays } = {}) {
  const list = mentions ?? [];
  const ranges = timeRanges(windowDays);
  const when = now ?? Date.now();

  const rangeCounts = {};
  const forRanges = list.filter((m) => passes(m, filters, when, ranges, 'range'));
  for (const range of ranges) rangeCounts[range.value] = forRanges.filter((m) => inRange(m, range.value, when, ranges)).length;

  const forSentiments = list.filter((m) => passes(m, filters, when, ranges, 'sentiment'));
  const sentimentCounts = { all: forSentiments.length, positive: 0, neutral: 0, negative: 0 };
  for (const m of forSentiments) if (m.sentiment in sentimentCounts && m.sentiment !== 'all') sentimentCounts[m.sentiment] += 1;

  return { mentions: list.filter((m) => passes(m, filters, when, ranges, null)), rangeCounts, sentimentCounts };
}

// Splits one page of mentions into days (in `timeZone`), newest first as they come:
// [{ day: '2026-09-30', firstAt, count, mentions }]. `count` = that day's mentions in the whole
// filtered list `all` (not only on this page), so a day split over two pages shows its full count.
export function groupByDay(pageMentions, all, timeZone) {
  const totals = new Map();
  for (const m of all) {
    const key = dayKey(m.publishedAt, timeZone);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const groups = [];
  for (const m of pageMentions) {
    const key = dayKey(m.publishedAt, timeZone);
    const last = groups.at(-1);
    if (last && last.day === key) last.mentions.push(m);
    else groups.push({ day: key, firstAt: m.publishedAt, count: totals.get(key) ?? 0, mentions: [m] });
  }
  return groups;
}

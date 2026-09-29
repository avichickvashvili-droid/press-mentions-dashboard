// dashboardUtils.test.js — the helpers of the new table and panel (D110, D111): the Recent
// activity words (the % rule), the company filter buttons, the panel's filters and counts, the
// grouping by day in Israel time, and the Sort by choices.

import { describe, expect, it } from 'vitest';
import { describeChange, formatCount, PERCENT_MIN_PREVIOUS } from './activity.js';
import { applyCompanyFilter, countCompanyFilters } from './companyFilters.js';
import { DEFAULT_MENTION_FILTERS, filterMentions, groupByDay } from './mentionFilters.js';
import { dayKey, formatDayHeading, formatTime, PANEL_TIME_ZONE } from './dates.js';
import { DEFAULT_SORT, DEFAULT_SORT_CHOICE, isDefaultSortChoice, nextSortChoice, SORT_OPTIONS, sortChoiceLabel, sortForChoice, sortForOption } from './sortCompanies.js';

describe('Recent activity words', () => {
  it('up / down / same / nothing; the % only when the week before had 10 or more', () => {
    expect(PERCENT_MIN_PREVIOUS).toBe(10);
    expect(describeChange(32, 19)).toEqual({ direction: 'up', text: '↑ 13 vs prev week (+68%)' });
    expect(describeChange(12, 3)).toEqual({ direction: 'up', text: '↑ 9 vs prev week' });
    expect(describeChange(3, 7)).toEqual({ direction: 'down', text: '↓ 4 vs prev week' });
    expect(describeChange(8, 10)).toEqual({ direction: 'down', text: '↓ 2 vs prev week (−20%)' });
    expect(describeChange(5, 5)).toEqual({ direction: 'same', text: 'same as prev week' });
    expect(describeChange(0, 0)).toEqual({ direction: 'none', text: '' });
    expect(describeChange(undefined, undefined).direction).toBe('none');
    expect(formatCount(1243)).toBe('1,243');
  });
});

describe('company filter buttons', () => {
  const companies = [
    { id: 'a', mentionCount: 10, weekCount: 2 },
    { id: 'b', mentionCount: 4, weekCount: 0 },
    { id: 'c', mentionCount: 0, weekCount: 0 },
  ];
  it('counts and filters: all / this week / mentioned / no coverage', () => {
    expect(countCompanyFilters(companies)).toEqual({ all: 3, thisWeek: 1, mentioned: 2, none: 1 });
    expect(applyCompanyFilter(companies, 'all')).toBe(companies);
    expect(applyCompanyFilter(companies, 'thisWeek').map((c) => c.id)).toEqual(['a']);
    expect(applyCompanyFilter(companies, 'mentioned').map((c) => c.id)).toEqual(['a', 'b']);
    expect(applyCompanyFilter(companies, 'none').map((c) => c.id)).toEqual(['c']);
  });
});

describe('Sort by choices', () => {
  it('Most mentions first (the default), then Last mentioned and Company A-Z', () => {
    expect(SORT_OPTIONS.map((o) => o.label)).toEqual(['Most mentions', 'Last mentioned (newest)', 'Company A–Z']);
    expect(sortForOption('mentions')).toEqual(DEFAULT_SORT);
    expect(sortForOption('lastMentioned')).toEqual({ column: 'status', direction: 'desc' });
    expect(sortForOption('nonsense')).toEqual(DEFAULT_SORT);
  });

  it('choosing the current sort again reverses it; another one starts in its normal direction (Prompt 335)', () => {
    expect(isDefaultSortChoice(DEFAULT_SORT_CHOICE)).toBe(true);
    const fewest = nextSortChoice(DEFAULT_SORT_CHOICE, 'mentions');
    expect(fewest).toEqual({ value: 'mentions', reversed: true });
    expect(isDefaultSortChoice(fewest)).toBe(false);
    expect(sortChoiceLabel(fewest)).toBe('Fewest mentions');
    expect(sortForChoice(fewest)).toEqual({ column: 'mentions', direction: 'asc' });
    expect(nextSortChoice(fewest, 'mentions')).toEqual(DEFAULT_SORT_CHOICE);
    const name = nextSortChoice(fewest, 'name');
    expect(name).toEqual({ value: 'name', reversed: false });
    expect(sortChoiceLabel(nextSortChoice(name, 'name'))).toBe('Company Z–A');
    expect(sortForChoice(nextSortChoice(name, 'name'))).toEqual({ column: 'name', direction: 'desc' });
    const oldest = nextSortChoice(nextSortChoice(name, 'lastMentioned'), 'lastMentioned');
    expect(sortChoiceLabel(oldest)).toBe('Last mentioned (oldest)');
    expect(sortForChoice(oldest)).toEqual({ column: 'status', direction: 'asc' });
  });
});

describe('mention filters', () => {
  const NOW = Date.parse('2026-09-30T12:00:00.000Z');
  const HOUR = 60 * 60 * 1000;
  const m = (hoursAgo, sentiment, title) => ({ title, sentiment, url: `https://x/${title}`, publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString() });
  const MENTIONS = [
    m(1, 'positive', 'Launch day'),
    m(20, 'negative', 'Lawsuit filed'),
    m(3 * 24, 'neutral', 'Interview'),
    m(10 * 24, 'positive', 'Funding round'),
    m(60 * 24, 'negative', 'Old lawsuit'),
  ];
  const run = (filters) => filterMentions(MENTIONS, { ...DEFAULT_MENTION_FILTERS, ...filters }, { now: NOW, windowDays: 90 });

  it('the default shows everything; each count applies the OTHER filters', () => {
    const all = run({});
    expect(all.mentions).toHaveLength(5);
    expect(all.rangeCounts).toEqual({ '24h': 2, '7d': 3, '30d': 4, all: 5 });
    expect(all.sentimentCounts).toEqual({ all: 5, positive: 2, neutral: 1, negative: 2 });

    const week = run({ range: '7d' });
    expect(week.mentions.map((x) => x.title)).toEqual(['Launch day', 'Lawsuit filed', 'Interview']);
    expect(week.sentimentCounts).toEqual({ all: 3, positive: 1, neutral: 1, negative: 1 });
    expect(week.rangeCounts.all).toBe(5, 'the time counts ignore the chosen time');

    const negative = run({ sentiment: 'negative' });
    expect(negative.rangeCounts).toEqual({ '24h': 1, '7d': 1, '30d': 1, all: 2 });
    expect(negative.sentimentCounts.all).toBe(5, 'the sentiment counts ignore the chosen sentiment');
  });

  it('the headline search (any case, spaces ignored) works with the buttons and narrows every count', () => {
    const found = run({ search: '  LAWSUIT ', range: '30d' });
    expect(found.mentions.map((x) => x.title)).toEqual(['Lawsuit filed']);
    expect(found.rangeCounts).toEqual({ '24h': 1, '7d': 1, '30d': 1, all: 2 });
    expect(found.sentimentCounts).toEqual({ all: 1, positive: 0, neutral: 0, negative: 1 });
  });

  it('24h is exactly 24 hours back from the api time', () => {
    const edge = [m(24, 'neutral', 'edge'), { ...m(24, 'neutral', 'just out'), publishedAt: new Date(NOW - 24 * HOUR - 1).toISOString() }];
    expect(filterMentions(edge, { ...DEFAULT_MENTION_FILTERS, range: '24h' }, { now: NOW }).mentions.map((x) => x.title)).toEqual(['edge']);
  });
});

describe('days in Israel time', () => {
  it('a day starts at midnight in Israel, not UTC; headings and times as designed', () => {
    expect(PANEL_TIME_ZONE).toBe('Asia/Jerusalem');
    expect(dayKey('2026-09-29T20:59:00.000Z', PANEL_TIME_ZONE)).toBe('2026-09-29'); // 23:59 in Israel
    expect(dayKey('2026-09-29T21:00:00.000Z', PANEL_TIME_ZONE)).toBe('2026-09-30'); // 00:00 in Israel
    expect(formatDayHeading('2026-09-30T07:00:00.000Z', PANEL_TIME_ZONE, Date.parse('2026-09-30T08:00:00.000Z'))).toBe('Wed 30 Sep');
    expect(formatDayHeading('2025-12-30T07:00:00.000Z', PANEL_TIME_ZONE, Date.parse('2026-09-30T08:00:00.000Z'))).toBe('Tue 30 Dec 2025');
    expect(formatTime('2026-09-30T07:35:00.000Z', PANEL_TIME_ZONE)).toBe('10:35');
  });

  it('groups a page by day; a day\'s count is its count in the whole filtered list', () => {
    const at = (iso, title) => ({ title, publishedAt: iso });
    const all = [
      at('2026-09-30T09:00:00.000Z', 'a'), at('2026-09-30T05:00:00.000Z', 'b'),
      at('2026-09-29T09:00:00.000Z', 'c'), at('2026-09-29T08:00:00.000Z', 'd'),
    ];
    const page2 = all.slice(3); // a page that starts in the middle of 29 Sep
    expect(groupByDay(all.slice(0, 3), all, PANEL_TIME_ZONE).map((g) => [g.day, g.count, g.mentions.length]))
      .toEqual([['2026-09-30', 2, 2], ['2026-09-29', 2, 1]]);
    expect(groupByDay(page2, all, PANEL_TIME_ZONE).map((g) => [g.day, g.count, g.mentions.length])).toEqual([['2026-09-29', 2, 1]]);
  });
});

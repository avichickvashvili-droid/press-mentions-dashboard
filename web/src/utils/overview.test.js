// overview.test.js — the Overview page's calculations (D117): the trend, the chart points (daily
// and weekly, the newest week complete), shares that add up to 100, the Top companies tabs, the
// "needs attention" words and "2h ago".

import { describe, expect, it } from 'vitest';
import { attentionWords, chartPoints, formatDayLabel, formatMonthLabel, percentChange, sentimentShares, SHARE_MIN_MENTIONS, timeAgo, topCompanies } from './overview.js';

describe('overview calculations', () => {
  it('percentChange: up / down / same; no % from nothing', () => {
    expect(percentChange(4572, 3655)).toEqual({ direction: 'up', percent: 25 });
    expect(percentChange(5, 10)).toEqual({ direction: 'down', percent: 50 });
    expect(percentChange(3, 3)).toEqual({ direction: 'same', percent: 0 });
    expect(percentChange(4, 0)).toEqual({ direction: 'up', percent: null });
  });

  it('labels: "28 Sep" and "Sep 2026"', () => {
    expect(formatDayLabel('2026-09-28')).toBe('28 Sep');
    expect(formatMonthLabel('2026-07')).toBe('Jul 2026');
  });

  it('chart points: one per day, or per 7 days counted back from the newest day', () => {
    const daily = Array.from({ length: 10 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, positive: 1, neutral: 0, negative: i === 9 ? 2 : 0 }));
    expect(chartPoints(daily, 'daily')).toHaveLength(10);
    expect(chartPoints(daily, 'daily').at(-1)).toMatchObject({ label: '10 Sep', total: 3 });
    const weeks = chartPoints(daily, 'weekly');
    expect(weeks.map((w) => [w.label, w.total])).toEqual([['1 Sep – 3 Sep', 3], ['4 Sep – 10 Sep', 9]]);
  });

  it('shares are whole percents that add up to 100', () => {
    expect(sentimentShares({ positive: 6458, neutral: 1997, negative: 3398 })).toEqual({ positive: 54, neutral: 17, negative: 29 });
    const odd = sentimentShares({ positive: 1, neutral: 1, negative: 1 });
    expect(odd.positive + odd.neutral + odd.negative).toBe(100);
    expect(sentimentShares({})).toEqual({ positive: 0, neutral: 0, negative: 0 });
  });

  it('Top companies tabs: mentioned, trending (a real rise), positive / negative share (enough mentions only)', () => {
    const c = (name, mentionCount, pos, neg, weekCount, prevWeekCount) => ({
      id: name, name, mentionCount, weekCount, prevWeekCount,
      sentimentCounts: { positive: pos, neutral: mentionCount - pos - neg, negative: neg },
    });
    const list = [c('Big', 100, 50, 40, 10, 20), c('Rising', 30, 29, 1, 25, 5), c('Tiny', 3, 3, 0, 3, 0), c('None', 0, 0, 0, 0, 0)];
    expect(topCompanies(list, 'mentioned').map((x) => x.name)).toEqual(['Big', 'Rising', 'Tiny']);
    expect(topCompanies(list, 'trending').map((x) => x.name)).toEqual(['Rising', 'Tiny']);
    expect(topCompanies(list, 'positive').map((x) => x.name)).toEqual(['Rising', 'Big'], `Tiny has fewer than ${SHARE_MIN_MENTIONS}`);
    expect(topCompanies(list, 'negative')[0].name).toBe('Big');
    expect(topCompanies(list, 'mentioned', 1)).toHaveLength(1);
  });

  it('needs attention words', () => {
    expect(attentionWords({ kind: 'negative', value: 85, count: 11, week: 13 })).toEqual({ badge: '85%', badgeNote: 'Negative', detail: '11 of its 13 mentions this week are negative' });
    expect(attentionWords({ kind: 'spike', value: 475, week: 46, prev: 8 }).badge).toBe('+475%');
    expect(attentionWords({ kind: 'spike', value: null, week: 23, prev: 0 })).toMatchObject({ badge: 'New', detail: '23 mentions this week, none the week before' });
    expect(attentionWords({ kind: 'quiet', value: 10 }).detail).toBe('Went quiet: no mentions this week, 10 in the 30 days before');
    expect(attentionWords({ kind: 'positive', value: 100, count: 10, week: 10 }).badgeNote).toBe('Positive');
  });

  it('time ago', () => {
    const now = Date.parse('2026-09-29T12:00:00.000Z');
    expect(timeAgo('2026-09-29T11:59:30.000Z', now)).toBe('just now');
    expect(timeAgo('2026-09-29T11:25:00.000Z', now)).toBe('35m ago');
    expect(timeAgo('2026-09-29T02:00:00.000Z', now)).toBe('10h ago');
    expect(timeAgo('2026-09-26T12:00:00.000Z', now)).toBe('3d ago');
  });
});

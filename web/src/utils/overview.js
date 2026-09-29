// overview.js — the small calculations of the Overview page (D117): the trend chip, the daily /
// weekly chart points, the Top companies tabs, the "needs attention" words and "2h ago".
//
// Where it sits: used by the components in src/components/Overview/. Pure functions (no React),
// so the tests check them directly.

import { formatCount } from './activity.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The change from `previous` to `current`: { direction: 'up' | 'down' | 'same', percent } (percent
// is null when there was nothing before).
export function percentChange(current, previous) {
  const now = current ?? 0;
  const before = previous ?? 0;
  if (now === before) return { direction: 'same', percent: 0 };
  return { direction: now > before ? 'up' : 'down', percent: before > 0 ? Math.round((Math.abs(now - before) / before) * 100) : null };
}

// "2026-09-28" → "28 Sep"; "2026-09" → "Sep 2026".
export function formatDayLabel(day) {
  const [, month, date] = day.split('-');
  return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
}
export function formatMonthLabel(month) {
  const [year, number] = month.split('-');
  return `${MONTHS[Number(number) - 1]} ${year}`;
}

// The chart points: one per day, or (weekly) one per 7 days counted back from the last day, so
// the newest week is always complete. Each point: { label, positive, neutral, negative, total }.
export function chartPoints(daily, mode) {
  const withTotal = (point, label) => ({ label, ...point, total: point.positive + point.neutral + point.negative });
  if (mode !== 'weekly') return daily.map((d) => withTotal({ positive: d.positive, neutral: d.neutral, negative: d.negative }, formatDayLabel(d.day)));
  const weeks = [];
  for (let end = daily.length; end > 0; end -= 7) {
    const days = daily.slice(Math.max(0, end - 7), end);
    const sum = { positive: 0, neutral: 0, negative: 0 };
    for (const d of days) { sum.positive += d.positive; sum.neutral += d.neutral; sum.negative += d.negative; }
    weeks.unshift(withTotal(sum, `${formatDayLabel(days[0].day)} – ${formatDayLabel(days.at(-1).day)}`));
  }
  return weeks;
}

// A sentiment split in whole percents that add up to 100 (the largest part takes the rounding).
export function sentimentShares({ positive = 0, neutral = 0, negative = 0 }) {
  const total = positive + neutral + negative;
  if (total === 0) return { positive: 0, neutral: 0, negative: 0 };
  const shares = { positive: Math.round((positive / total) * 100), neutral: Math.round((neutral / total) * 100), negative: Math.round((negative / total) * 100) };
  const largest = Object.keys(shares).reduce((a, b) => ({ positive, neutral, negative }[a] >= { positive, neutral, negative }[b] ? a : b));
  shares[largest] += 100 - (shares.positive + shares.neutral + shares.negative);
  return shares;
}

// The Top companies tabs. "Most positive" / "Most negative" only rank companies with at least
// SHARE_MIN_MENTIONS mentions (a company with 1 positive mention is not "the most positive").
export const SHARE_MIN_MENTIONS = 20;
export const TOP_TABS = Object.freeze([
  { value: 'mentioned', label: 'Most mentioned' },
  { value: 'trending', label: 'Trending' },
  { value: 'positive', label: 'Most positive' },
  { value: 'negative', label: 'Most negative' },
]);

// The share of one sentiment in a company's 90 days (0..1).
const shareOf = (company, sentiment) => (company.mentionCount > 0 ? (company.sentimentCounts?.[sentiment] ?? 0) / company.mentionCount : 0);

// The top `limit` companies for a tab (ties: more mentions first, then the name).
export function topCompanies(companies, tab, limit = 10) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const list = companies.filter((c) => c.mentionCount > 0);
  const rankings = {
    mentioned: () => list.sort((a, b) => b.mentionCount - a.mentionCount || byName(a, b)),
    trending: () => list
      .filter((c) => c.weekCount > c.prevWeekCount)
      .sort((a, b) => (b.weekCount - b.prevWeekCount) - (a.weekCount - a.prevWeekCount) || b.weekCount - a.weekCount || byName(a, b)),
    positive: () => list.filter((c) => c.mentionCount >= SHARE_MIN_MENTIONS)
      .sort((a, b) => shareOf(b, 'positive') - shareOf(a, 'positive') || b.mentionCount - a.mentionCount || byName(a, b)),
    negative: () => list.filter((c) => c.mentionCount >= SHARE_MIN_MENTIONS)
      .sort((a, b) => shareOf(b, 'negative') - shareOf(a, 'negative') || b.mentionCount - a.mentionCount || byName(a, b)),
  };
  return (rankings[tab] ?? rankings.mentioned)().slice(0, limit);
}

// The words of one "needs attention" item: { badge, badgeNote, detail }.
export function attentionWords(item) {
  switch (item.kind) {
    case 'negative':
      return { badge: `${item.value}%`, badgeNote: 'Negative', detail: `${formatCount(item.count)} of its ${formatCount(item.week)} mentions this week are negative` };
    case 'spike':
      return item.value === null
        ? { badge: 'New', badgeNote: 'Mentions', detail: `${formatCount(item.week)} mentions this week, none the week before` }
        : { badge: `+${formatCount(item.value)}%`, badgeNote: 'Mentions', detail: `Spike: ${formatCount(item.week)} mentions this week vs ${formatCount(item.prev)} the week before` };
    case 'quiet':
      return { badge: '0', badgeNote: 'This week', detail: `Went quiet: no mentions this week, ${formatCount(item.value)} in the 30 days before` };
    case 'positive':
      return { badge: `${item.value}%`, badgeNote: 'Positive', detail: `${formatCount(item.count)} of its ${formatCount(item.week)} mentions this week are positive` };
    default:
      return { badge: '', badgeNote: '', detail: '' };
  }
}

// "just now", "35m ago", "5h ago", "3d ago" from an ISO time to `now` (ms).
export function timeAgo(isoText, now = Date.now()) {
  const ms = Math.max(0, now - Date.parse(isoText));
  if (ms < 60 * 1000) return 'just now';
  if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < DAY_MS) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / DAY_MS)}d ago`;
}

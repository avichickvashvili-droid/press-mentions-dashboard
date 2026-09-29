// StatusText.jsx — the Last mentioned column (FR5) as a small rounded label with a coloured dot
// that shows how fresh the coverage is (owner, Prompt 330). The wording is short (owner, Prompt
// 332): under a day, then days, then weeks, then months:
//   "< 24h"                     green   (0 days)
//   "1d ago"                    green   (1 day)
//   "2d ago" … "6d ago", "1w ago" amber (2-7 days)
//   "2w ago" … "4w ago", "1mo ago", "2mo ago" …   grey (8+ days)
//   "No coverage"               plain grey text, no label
// Hovering the label shows the exact time of the latest mention in Israel time
// ("Last mention: 29 Sep 2026, 02:53 IST").
//
// Where it sits: shown in each row of the company table.
// Reads: the status, daysAgo (worked out by the server on every request) and lastMentionAt the api sends.

import { formatDateTime, PANEL_TIME_LABEL, PANEL_TIME_ZONE } from '../../utils/dates.js';
import styles from './StatusText.module.css';

// The status as text: 0 days -> "< 24h", 1-6 -> "Nd ago", 7-29 -> whole weeks "Nw ago",
// 30+ -> whole months of 30 days "Nmo ago"; no mention -> "No coverage".
export function statusWords(status, daysAgo) {
  if (status !== 'mentioned' || daysAgo === null || daysAgo === undefined) return 'No coverage';
  if (daysAgo <= 0) return '< 24h';
  if (daysAgo < 7) return `${daysAgo}d ago`;
  if (daysAgo < 30) return `${Math.floor(daysAgo / 7)}w ago`;
  return `${Math.floor(daysAgo / 30)}mo ago`;
}

// How fresh the latest mention is: 'fresh' (0-1 days), 'recent' (2-7) or 'old' (8+).
export function freshness(daysAgo) {
  if (daysAgo <= 1) return 'fresh';
  if (daysAgo <= 7) return 'recent';
  return 'old';
}

// The tooltip: "Last mention: 29 Sep 2026, 02:53 IST" (Israel time); '' when the time is unknown.
export function lastMentionTitle(lastMentionAt) {
  const when = formatDateTime(lastMentionAt, PANEL_TIME_ZONE);
  return when ? `Last mention: ${when} ${PANEL_TIME_LABEL}` : '';
}

// Shows the label; "No coverage" is plain grey text.
export function StatusText({ status, daysAgo, lastMentionAt = null }) {
  const words = statusWords(status, daysAgo);
  if (words === 'No coverage') return <span className={styles.noCoverage}>{words}</span>;
  return (
    <span className={`${styles.label} ${styles[freshness(daysAgo)]}`} title={lastMentionTitle(lastMentionAt) || undefined}>
      <span className={styles.dot} aria-hidden="true" />
      {words}
    </span>
  );
}

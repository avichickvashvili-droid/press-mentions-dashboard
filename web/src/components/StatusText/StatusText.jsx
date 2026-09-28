// StatusText.jsx — a company's mention status in words (FR5): "last mentioned 3 days ago",
// "last mentioned today", or "no coverage found".
//
// Where it sits: shown in each row of the company table.
// Reads: the status and daysAgo the api sends (worked out by the server on every request).

import styles from './StatusText.module.css';

// The status as text. `daysAgo` 0 -> "today", 1 -> "1 day ago", N -> "N days ago".
export function statusWords(status, daysAgo) {
  if (status !== 'mentioned' || daysAgo === null || daysAgo === undefined) return 'no coverage found';
  if (daysAgo === 0) return 'last mentioned today';
  if (daysAgo === 1) return 'last mentioned 1 day ago';
  return `last mentioned ${daysAgo} days ago`;
}

// Shows the status; "no coverage found" is greyed out.
export function StatusText({ status, daysAgo }) {
  const className = status === 'mentioned' ? styles.mentioned : styles.noCoverage;
  return <span className={className}>{statusWords(status, daysAgo)}</span>;
}

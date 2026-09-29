// SentimentBar.jsx — a company's sentiment mix as one coloured bar (green / grey / red) with the
// % under each part, in place of three number columns (owner, Prompts 317-318, D110).
//
// Where it sits: the Sentiment column of the company table.
// Reads: the sentiment totals the api sends ({ positive, neutral, negative }).
// The exact numbers show on hover (title) and are read out by screen readers (aria-label).
// A company with no mentions shows "—". A 0% part has no piece of the bar, so it has no % label
// either ("100%  0% 0%" crowded the bar, Prompt 330); the exact numbers on hover include the zeros.

import styles from './SentimentBar.module.css';

const PARTS = [
  { key: 'positive', label: 'Positive' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'negative', label: 'Negative' },
];

// The whole % of each sentiment: { total, percents: { positive, neutral, negative } }
// (all 0 when there are no mentions).
export function sentimentPercents(counts) {
  const total = PARTS.reduce((sum, { key }) => sum + (counts?.[key] ?? 0), 0);
  const percents = {};
  for (const { key } of PARTS) percents[key] = total ? Math.round(((counts?.[key] ?? 0) / total) * 100) : 0;
  return { total, percents };
}

// `counts` = { positive, neutral, negative }.
export function SentimentBar({ counts }) {
  const { total, percents } = sentimentPercents(counts);
  if (!total) return <span className={styles.none}>—</span>;
  const exact = PARTS.map(({ key, label }) => `${label} ${(counts[key] ?? 0).toLocaleString('en-US')}`).join(' · ');
  return (
    <div className={styles.wrap} title={exact} role="img" aria-label={exact}>
      <div className={styles.bar}>
        {PARTS.map(({ key }) => (counts[key]
          ? <span key={key} className={styles[key]} style={{ flexGrow: counts[key] }} />
          : null))}
      </div>
      <div className={styles.percents} aria-hidden="true">
        {PARTS.map(({ key }) => (counts[key]
          ? <span key={key} className={styles[`${key}Text`]} style={{ flexGrow: counts[key] }}>{percents[key]}%</span>
          : null))}
      </div>
    </div>
  );
}

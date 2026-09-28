// SentimentBadge.jsx — a small coloured label: positive, negative or neutral (FR3).
//
// Where it sits: shown next to each mention in the MentionsPanel.
// Reads: the sentiment the api sends (decided by the local AI model).

import styles from './SentimentBadge.module.css';

const KNOWN = new Set(['positive', 'negative', 'neutral']);

// Shows the sentiment word in its colour (an unknown value is shown plainly).
export function SentimentBadge({ sentiment }) {
  const className = KNOWN.has(sentiment) ? `${styles.badge} ${styles[sentiment]}` : styles.badge;
  return <span className={className}>{sentiment}</span>;
}

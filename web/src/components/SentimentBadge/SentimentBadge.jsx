// SentimentBadge.jsx — a small coloured label with an icon: ✓ Positive, – Neutral, ! Negative
// (FR3; owner's panel design, Prompt 319, D111).
//
// Where it sits: shown next to each mention in the MentionsPanel.
// Reads: the sentiment the api sends (decided by the local AI model).

import styles from './SentimentBadge.module.css';

const LABELS = {
  positive: { icon: '✓', text: 'Positive' },
  neutral: { icon: '–', text: 'Neutral' },
  negative: { icon: '!', text: 'Negative' },
};

// Shows the sentiment in its colour with its icon (an unknown value is shown plainly, as sent).
export function SentimentBadge({ sentiment }) {
  const known = LABELS[sentiment];
  if (!known) return <span className={styles.badge}>{sentiment}</span>;
  return (
    <span className={`${styles.badge} ${styles[sentiment]}`}>
      <span className={styles.icon} aria-hidden="true">{known.icon}</span>
      {known.text}
    </span>
  );
}

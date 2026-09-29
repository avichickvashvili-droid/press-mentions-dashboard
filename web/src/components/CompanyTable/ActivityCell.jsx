// ActivityCell.jsx — the Recent activity column: "32 this week" and, under it, the change against
// the week before in green (↑), red (↓) or grey ("same as prev week") (owner, Prompts 317-322, D110).
//
// Where it sits: in each row of the company table.
// Reads: weekCount and prevWeekCount from the api (the last 7 days, and the 7 days before them).
// The words come from src/utils/activity.js (the % only when the week before had 10 or more).

import { describeChange, formatCount } from '../../utils/activity.js';
import styles from './CompanyTable.module.css';

// A bold arrow (a drawn one: the ↑ / ↓ characters look thin in most fonts). Up, or turned for down.
function Arrow({ down }) {
  return (
    <svg className={styles.arrow} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" style={down ? { transform: 'rotate(180deg)' } : undefined}>
      <path d="M6 10.5V2M2.5 5.5L6 2l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// `week` = mentions this week; `previous` = mentions the week before.
export function ActivityCell({ week, previous }) {
  const change = describeChange(week, previous);
  return (
    <div className={styles.activity}>
      <span className={week ? styles.activityMain : styles.activityNone}>{formatCount(week)} this week</span>
      {change.text && (change.direction === 'up' || change.direction === 'down'
        ? <span className={styles[change.direction]}><Arrow down={change.direction === 'down'} /><span className={'visually-hidden'}>{change.text.slice(0, 2)}</span>{change.text.slice(2)}</span>
        : <span className={styles[change.direction]}>{change.text}</span>)}
    </div>
  );
}

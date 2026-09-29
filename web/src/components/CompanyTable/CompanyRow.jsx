// CompanyRow.jsx — one company in the table: logo and name, Recent activity, mentions in the
// window, the sentiment bar, when it was last mentioned, and a › (FR1, FR5, D99, D110).
//
// Where it sits: drawn by CompanyTable.jsx for each company.
// A click anywhere on the row opens the company. The name is also a button, so the keyboard
// (Tab + Enter) and screen readers can open it; the open company is marked on it (aria-current).

import { formatCount } from '../../utils/activity.js';
import { CompanyLogo } from '../CompanyLogo/CompanyLogo.jsx';
import { SentimentBar } from '../SentimentBar/SentimentBar.jsx';
import { StatusText } from '../StatusText/StatusText.jsx';
import { ActivityCell } from './ActivityCell.jsx';
import styles from './CompanyTable.module.css';

// `selected` highlights the row; `flash` makes it glow for a moment (opened from the Overview);
// `onSelect(id)` opens the company. data-company-id lets the page find the row to scroll to.
export function CompanyRow({ company, selected, flash = false, onSelect }) {
  const quiet = !company.mentionCount && !company.weekCount && !company.prevWeekCount;
  return (
    <tr className={`${styles.row} ${selected ? styles.selected : ''} ${flash ? styles.flash : ''}`} data-company-id={company.id} onClick={() => onSelect(company.id)}>
      <td>
        <div className={styles.company}>
          <CompanyLogo name={company.name} logoUrl={company.logoUrl} />
          <button
            type="button"
            className={styles.nameButton}
            aria-current={selected ? 'true' : undefined}
            onClick={(event) => { event.stopPropagation(); onSelect(company.id); }}
          >
            {company.name}
          </button>
        </div>
      </td>
      <td>{quiet ? <span className={styles.muted}>—</span> : <ActivityCell week={company.weekCount} previous={company.prevWeekCount} />}</td>
      <td className={`${styles.mentions} ${styles.count}`}>{formatCount(company.mentionCount)}</td>
      <td><SentimentBar counts={company.sentimentCounts} /></td>
      <td><StatusText status={company.status} daysAgo={company.daysAgo} lastMentionAt={company.lastMentionAt} /></td>
      <td className={styles.chevron} aria-hidden="true">›</td>
    </tr>
  );
}

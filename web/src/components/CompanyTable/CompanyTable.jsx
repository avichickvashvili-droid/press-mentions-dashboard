// CompanyTable.jsx — the table of every company in the list, including those with no coverage
// (FR1). Clicking a row opens the company's mentions in the panel beside it.
//
// Where it sits: the main part of App.jsx, under the TableControls. The list arrives already in
// the chosen order and already narrowed by the search and the filter menu (App.jsx). When
// nothing is left, `emptyMessage` is shown in the table.
//
// Columns (owner's design, Prompts 317-322, D110): Company (logo + name), Recent activity (this
// week and the change vs the week before; ⓘ explains it), Mentions (90 days), Sentiment (one
// coloured bar with %), Last mentioned, and a › that shows the row opens something. The order is
// chosen in the Sort menu (an icon above the table), not by clicking the headers. No section column (D101).

import { CompanyRow } from './CompanyRow.jsx';
import styles from './CompanyTable.module.css';

// The number of columns (the empty message spans all of them).
const COLUMN_COUNT = 6;

// What the ⓘ next to "Recent activity" explains (on hover, and to screen readers).
export const ACTIVITY_HELP = 'Mentions published in the last 7 days, and the change compared with the 7 days before. The % shows only when the week before had 10 or more mentions.';

// `companies` = the list to show; `selectedId` = the open company; `onSelect(id)` opens one;
// `emptyMessage` = the text shown when the list is empty (e.g. no search match);
// `windowDays` = the window length (for the Mentions header).
export function CompanyTable({ companies, selectedId, onSelect, emptyMessage, windowDays = 90 }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Company</th>
          <th>
            Recent activity
            <span className={styles.help} title={ACTIVITY_HELP} aria-label={ACTIVITY_HELP} role="img">ⓘ</span>
          </th>
          <th className={styles.mentions}>Mentions <span className={styles.headerNote}>({windowDays} days)</span></th>
          <th>Sentiment <span className={styles.headerNote}>({windowDays} days)</span></th>
          <th>Last mentioned</th>
          <th aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {companies.length === 0 && emptyMessage && (
          <tr>
            <td colSpan={COLUMN_COUNT} className={styles.empty}>{emptyMessage}</td>
          </tr>
        )}
        {companies.map((company) => (
          <CompanyRow key={company.id} company={company} selected={company.id === selectedId} onSelect={onSelect} />
        ))}
      </tbody>
    </table>
  );
}

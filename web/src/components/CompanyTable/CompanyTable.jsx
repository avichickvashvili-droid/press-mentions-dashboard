// CompanyTable.jsx — the table of every company in the list, including those with no coverage
// (FR1). Clicking a company opens its mentions. No section column (owner, Prompt 265, D101);
// the api still sends section and sectionName.
//
// Where it sits: the main part of App.jsx. The list arrives already in table order and already
// narrowed by the search (App.jsx). When nothing is left, `emptyMessage` is shown in the table.

import { CompanyRow } from './CompanyRow.jsx';
import styles from './CompanyTable.module.css';

// The number of columns (the empty message spans all of them).
const COLUMN_COUNT = 6;

// `companies` = the list to show; `selectedId` = the open company; `onSelect(id)` opens one;
// `emptyMessage` = the text shown when the list is empty (e.g. no search match).
export function CompanyTable({ companies, selectedId, onSelect, emptyMessage }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Company</th>
          <th>Status</th>
          <th className={styles.number}>Mentions</th>
          <th className={styles.number}>Positive</th>
          <th className={styles.number}>Negative</th>
          <th className={styles.number}>Neutral</th>
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

// CompanyTable.jsx — the table of every company in the list, including those with no coverage
// (FR1). Clicking a company opens its mentions. No section column (owner, Prompt 265, D101);
// the api still sends section and sectionName.
//
// Where it sits: the main part of App.jsx. The list arrives already in table order and already
// narrowed by the search (App.jsx). When nothing is left, `emptyMessage` is shown in the table.
//
// Click-to-sort (owner, Prompt 282, D104): the Company, Status and Mentions headers are buttons
// (usable with the keyboard and announced by screen readers); the active one has aria-sort and
// a small ▲ / ▼; while the user has not clicked any header (`sort` is null) none is marked
// (Prompt 285). The Positive / Negative / Neutral headers are plain text (not sortable).

import { CompanyRow } from './CompanyRow.jsx';
import styles from './CompanyTable.module.css';

// The number of columns (the empty message spans all of them).
const COLUMN_COUNT = 6;

// A sortable header: a button in the <th>. `sort` = the table's current sort.
function SortHeader({ column, label, sort, onSort, className }) {
  const active = sort?.column === column;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined;
  return (
    <th className={className} aria-sort={ariaSort}>
      <button type="button" className={styles.sortButton} onClick={() => onSort(column)}>
        {label}
        {active && <span className={styles.arrow} aria-hidden="true">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

// `companies` = the list to show; `selectedId` = the open company; `onSelect(id)` opens one;
// `emptyMessage` = the text shown when the list is empty (e.g. no search match);
// `sort` = { column, direction } or null (not sorted by the user yet); `onSort(column)` = a
// header was clicked.
export function CompanyTable({ companies, selectedId, onSelect, emptyMessage, sort, onSort = () => {} }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <SortHeader column="name" label="Company" sort={sort} onSort={onSort} />
          <SortHeader column="status" label="Status" sort={sort} onSort={onSort} />
          <SortHeader column="mentions" label="Mentions" sort={sort} onSort={onSort} className={styles.number} />
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

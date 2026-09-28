// CompanyTable.jsx — the table of every company in the list, including those with no coverage
// (FR1). Clicking a company opens its mentions. No section column (owner, Prompt 265, D101);
// the api still sends section and sectionName.
//
// Where it sits: the main part of App.jsx. The list arrives already in table order (App.jsx).

import { CompanyRow } from './CompanyRow.jsx';
import styles from './CompanyTable.module.css';

// `companies` = the list to show; `selectedId` = the open company; `onSelect(id)` opens one.
export function CompanyTable({ companies, selectedId, onSelect }) {
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
        {companies.map((company) => (
          <CompanyRow key={company.id} company={company} selected={company.id === selectedId} onSelect={onSelect} />
        ))}
      </tbody>
    </table>
  );
}

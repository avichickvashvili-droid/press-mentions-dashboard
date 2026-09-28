// CompanyRow.jsx — one company in the table: name, status, mention count and the
// positive / negative / neutral totals (FR1, FR5, D99).
//
// Where it sits: drawn by CompanyTable.jsx for each company.

import { StatusText } from '../StatusText/StatusText.jsx';
import styles from './CompanyTable.module.css';

// `selected` highlights the row; clicking the name selects the company.
export function CompanyRow({ company, selected, onSelect }) {
  const { positive, negative, neutral } = company.sentimentCounts;
  return (
    <tr className={selected ? styles.selected : undefined} aria-selected={selected}>
      <td>
        <button type="button" className={styles.nameButton} onClick={() => onSelect(company.id)}>
          {company.name}
        </button>
      </td>
      <td><StatusText status={company.status} daysAgo={company.daysAgo} /></td>
      <td className={styles.number}>{company.mentionCount}</td>
      <td className={styles.number}>{positive}</td>
      <td className={styles.number}>{negative}</td>
      <td className={styles.number}>{neutral}</td>
    </tr>
  );
}

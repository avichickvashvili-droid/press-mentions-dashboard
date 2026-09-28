// CompanySearch.jsx — the search box above the company table (owner, Prompt 273, D103).
// The table narrows on every keystroke: no button, no Enter, no form.
//
// Where it sits: above the table in App.jsx, which keeps the text in useState.
// Reads/writes: nothing itself; it reports each change with onChange(text).

import styles from './CompanySearch.module.css';

// `value` = the current search text; `onChange(text)` is called on every keystroke.
export function CompanySearch({ value, onChange }) {
  return (
    <div className={styles.search}>
      <label htmlFor="company-search" className={styles.visuallyHidden}>Search companies</label>
      <input
        id="company-search"
        type="search"
        className={styles.input}
        placeholder="Search companies…"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

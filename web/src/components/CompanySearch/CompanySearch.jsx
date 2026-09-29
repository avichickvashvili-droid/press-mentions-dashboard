// CompanySearch.jsx — the search box above the company table (owner, Prompt 273, D103), with a
// magnifier icon (owner's design, D110). The table narrows on every keystroke: no button, no
// Enter, no form.
//
// Where it sits: in the TableControls above the table; App.jsx keeps the text in useState.
// Reads/writes: nothing itself; it reports each change with onChange(text).

import styles from './CompanySearch.module.css';

// `value` = the current search text; `onChange(text)` is called on every keystroke;
// `id`, `label` and `placeholder` let the mentions panel use the same box for headlines.
export function CompanySearch({ value, onChange, id = 'company-search', label = 'Search companies', placeholder = 'Search companies…' }) {
  return (
    <div className={styles.search}>
      <label htmlFor={id} className="visually-hidden">{label}</label>
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </span>
      <input
        id={id}
        type="search"
        className={styles.input}
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

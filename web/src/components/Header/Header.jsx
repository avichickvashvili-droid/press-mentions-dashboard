// Header.jsx — the top of the page: title, how fresh the data is ("Data as of ..."), the window
// ("Last N days", N = the api's windowDays setting), and the Refresh button (D100).
//
// Where it sits: at the top of App.jsx.
// Reads: asOf, windowStart and windowDays from the company list answer (GET /api/companies).

import { formatDate, formatDateTime } from '../../utils/dates.js';
import styles from './Header.module.css';

// `onRefresh` reloads everything on the page; `isRefreshing` disables the button meanwhile.
export function Header({ asOf, windowStart, windowDays, onRefresh, isRefreshing }) {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>Press Mentions Dashboard</h1>
        {asOf && (
          <p className={styles.meta}>
            Data as of {formatDateTime(asOf)} · Last {windowDays} days: {formatDate(windowStart)} – {formatDate(asOf)}
          </p>
        )}
      </div>
      <button type="button" onClick={() => onRefresh()} disabled={isRefreshing}>
        {isRefreshing ? 'Refreshing ...' : 'Refresh'}
      </button>
    </header>
  );
}

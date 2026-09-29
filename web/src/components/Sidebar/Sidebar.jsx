// Sidebar.jsx — the dark side menu (owner, Prompt 364, D117): the product name, the two pages
// (Overview, Companies), the last data update, and the dark / light switch. On a narrow screen
// it becomes a bar across the top.
//
// Where it sits: on the left of every page, drawn by App.jsx.
// Reads: its props only (the page, the theme, the daily run's status).

import { formatUpdateTime, PANEL_TIME_ZONE } from '../../utils/dates.js';
import { updateStatus } from '../../utils/updateStatus.js';
import styles from './Sidebar.module.css';

const ICON = { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' };
const NAV = [
  { page: 'overview', label: 'Overview', icon: <svg {...ICON}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg> },
  { page: 'companies', label: 'Companies', icon: <svg {...ICON}><path d="M5 21V4h10v17M15 9h4v12M3 21h18M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1" /></svg> },
];
const SunIcon = () => <svg {...ICON}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
const MoonIcon = () => <svg {...ICON}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>;

// The brand mark: three rising bars in a rounded square.
function BrandMark() {
  return (
    <svg className={styles.brandMark} viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <rect width="32" height="32" rx="9" className={styles.brandBg} />
      <rect x="8" y="16" width="4" height="8" rx="2" className={styles.brandBar} />
      <rect x="14" y="11" width="4" height="13" rx="2" className={styles.brandBar} />
      <rect x="20" y="7" width="4" height="17" rx="2" className={styles.brandBar} />
    </svg>
  );
}

// `page` / `onNavigate(page)`; `theme` / `onToggleTheme()`; `dailyRun` (the company list's); `now`.
export function Sidebar({ page, onNavigate, theme, onToggleTheme, dailyRun, now = Date.now() }) {
  const status = dailyRun ? updateStatus(dailyRun, now) : null;
  const lastDone = dailyRun?.lastDone ?? null;
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <BrandMark />
        <div>
          <div className={styles.brandName}>Press Mentions</div>
          <div className={styles.brandSub}>OurCrowd portfolio</div>
        </div>
      </div>

      <nav className={styles.nav} aria-label="Pages">
        {NAV.map((item) => (
          <button
            key={item.page}
            type="button"
            className={`${styles.navItem} ${page === item.page ? styles.active : ''}`}
            aria-current={page === item.page ? 'page' : undefined}
            onClick={() => onNavigate(item.page)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className={styles.bottom}>
        {status && (
          <div className={styles.status} title={status.title}>
            <span className={`${styles.statusDot} ${styles[status.tone]}`} aria-hidden="true" />
            <div>
              <div className={styles.statusTitle}>{status.tone === 'ok' ? 'Data up to date' : status.title}</div>
              {lastDone && <div className={styles.statusTime}>{formatUpdateTime(lastDone.finishedAt, PANEL_TIME_ZONE, now)} IST</div>}
            </div>
          </div>
        )}
        <button type="button" className={styles.themeButton} onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </aside>
  );
}

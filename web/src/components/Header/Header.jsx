// Header.jsx — the top of the page (owner's design, Prompt 333, D113): the title and how many
// companies are watched; when the daily job last updated the data (its finish time, in Israel
// time) with a status mark; the 90-day window; and two cards with the last daily run's numbers
// (new mentions, companies with updates), the same numbers as that run's Discord message; and a
// coverage card: how many of the watched companies were mentioned in the window ("138 / 258",
// owner, Prompt 334; no up / down arrow).
// Left out on purpose (owner): negative mentions, unusual activity, the Refresh button.
//
// Where it sits: at the top of App.jsx.
// Reads: from the company list answer (GET /api/companies): dailyRun (latest and lastDone),
// asOf, windowStart, windowDays, the number of companies and how many were mentioned.
//
// The status mark:
//   ✓ green   the last daily run finished, less than STALE_AFTER_MS ago
//   ↻ blue    a daily run is going on now (the numbers are still the last finished run's)
//   ! red     the newest daily run failed (the numbers are the last finished run's)
//   ! amber   the last finished run is older than STALE_AFTER_MS (e.g. `npm run daily` is not open)
//   – grey    no daily run yet (the data is from the 90-day collection)

import { formatDate, formatUpdateTime, PANEL_TIME_ZONE } from '../../utils/dates.js';
import { formatCount } from '../../utils/activity.js';
import styles from './Header.module.css';

// The daily job runs every day at 03:00: a last update older than 26 hours means one was missed.
export const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

// Which status the top of the page shows (see the file header): { tone, title }.
export function updateStatus(dailyRun, now = Date.now()) {
  const latest = dailyRun?.latest;
  const lastDone = dailyRun?.lastDone;
  if (latest?.status === 'running') return { tone: 'running', title: 'Daily run in progress' };
  if (latest?.status === 'failed') return { tone: 'failed', title: 'The last daily run failed' };
  if (!lastDone) return { tone: 'none', title: 'No daily run yet' };
  if (now - Date.parse(lastDone.finishedAt) > STALE_AFTER_MS) return { tone: 'stale', title: 'Last data update (over a day ago)' };
  return { tone: 'ok', title: 'Last data update' };
}

// The small round mark before the update time.
function StatusMark({ tone }) {
  const paths = {
    ok: <path d="M5 10.5l3 3 7-7" />,
    running: <path d="M15 10a5 5 0 1 1-1.5-3.5M15 4.5v3h-3" />,
    failed: <path d="M10 6v5M10 14h.01" />,
    stale: <path d="M10 6v5M10 14h.01" />,
    none: <path d="M6.5 10h7" />,
  };
  return (
    <span className={`${styles.mark} ${styles[tone]}`} aria-hidden="true">
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{paths[tone]}</svg>
    </span>
  );
}

// One number card: an icon, the number (with an optional "/ total" after it), and two lines of words.
function StatCard({ icon, tone, value, outOf, label, note }) {
  return (
    <div className={styles.card}>
      <span className={`${styles.cardIcon} ${styles[tone]}`} aria-hidden="true">{icon}</span>
      <div>
        <div className={styles.cardValue}>
          {value}
          {outOf && <span className={styles.outOf}> / {outOf}</span>}
        </div>
        <div className={styles.cardLabel}>{label}</div>
        <div className={styles.cardNote}>{note}</div>
      </div>
    </div>
  );
}

const ICON_PROPS = { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
const NewsIcon = () => <svg {...ICON_PROPS}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></svg>;
const BuildingIcon = () => <svg {...ICON_PROPS}><path d="M5 21V4h10v17M15 9h4v12M3 21h18M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1" /></svg>;
const UpdatesIcon = () => <svg {...ICON_PROPS}><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4" /><path d="M12 8v4l2.5 2.5" /></svg>;

// `dailyRun` = { latest, lastDone } from the api (or undefined while loading); `companyCount` =
// how many companies are watched; `coveredCount` = how many of them have a mention in the window; `asOf`, `windowStart`, `windowDays` = the 90-day window; `now`
// can be given (the tests).
export function Header({ asOf, windowStart, windowDays, companyCount, coveredCount, dailyRun, now = Date.now() }) {
  const lastDone = dailyRun?.lastDone ?? null;
  const status = updateStatus(dailyRun, now);
  const details = lastDone
    ? [`${formatCount(lastDone.newMentions)} new mentions`, `${formatCount(lastDone.companiesWithUpdates)} companies with updates`, lastDone.discordSent ? 'Discord sent' : 'Discord not sent']
    : ['The data is from the 90-day collection'];
  return (
    <header className={styles.header}>
      <div className={styles.top}>
        <div className={styles.titleBox}>
          <h1 className={styles.title}>Press Mentions</h1>
          <p className={styles.subtitle}>
            News coverage of {companyCount ? `${formatCount(companyCount)} portfolio companies` : 'the portfolio companies'}
          </p>
        </div>

        {dailyRun && (
          <div className={styles.update} role="status" aria-label={status.title}>
            <StatusMark tone={status.tone} />
            <div>
              <div className={styles.updateTitle}>{status.title}</div>
              {lastDone && (
                <div className={styles.updateTime}>
                  {formatUpdateTime(lastDone.finishedAt, PANEL_TIME_ZONE, now)} <span className={styles.zone}>(Israel time)</span>
                </div>
              )}
              <div className={styles.updateDetails}>{details.join(' · ')}</div>
            </div>
          </div>
        )}

        {asOf && (
          <div className={styles.window}>
            <div className={styles.updateTitle}>Last {windowDays} days</div>
            <div className={styles.windowDates}>{formatDate(windowStart)} – {formatDate(asOf)}</div>
          </div>
        )}
      </div>

      {(lastDone || companyCount > 0) && (
        <div className={styles.cards}>
          {companyCount > 0 && (
            <StatCard
              icon={<BuildingIcon />}
              tone="purple"
              value={formatCount(coveredCount ?? 0)}
              outOf={formatCount(companyCount)}
              label="companies mentioned"
              note={`in the last ${windowDays ?? 90} days`}
            />
          )}
          {lastDone && <StatCard icon={<NewsIcon />} tone="blue" value={formatCount(lastDone.newMentions)} label="new mentions" note="from the last daily run" />}
          {lastDone && <StatCard
            icon={<UpdatesIcon />}
            tone="teal"
            value={formatCount(lastDone.companiesWithUpdates)}
            label="companies with updates"
            note={companyCount ? `out of ${formatCount(companyCount)}` : 'in the last daily run'}
          />}
        </div>
      )}
    </header>
  );
}

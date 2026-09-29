// Hero.jsx — the top of every page (owner, Prompts 367-369, D118; replaces the old Header, D113):
// a band with a slowly drifting glow, today's date, the page title in a gradient, the week's
// briefing (Overview only; names open the company), glowing status pills (Live · last update,
// the last daily run's numbers, Discord, the window) and a ticker of the newest headlines.
//
// Where it sits: at the top of both pages, drawn by App.jsx.
// Reads: the company list (props) and GET /api/overview through useOverview (the briefing's
// "stands out" part and the ticker's headlines); the same cached answer the Overview uses.

import { useOverview } from '../../hooks/useOverview.js';
import { formatCount } from '../../utils/activity.js';
import { buildBriefing } from '../../utils/briefing.js';
import { formatDate, formatUpdateTime, PANEL_TIME_ZONE } from '../../utils/dates.js';
import { updateStatus } from '../../utils/updateStatus.js';
import { Ticker } from './Ticker.jsx';
import styles from './Hero.module.css';

const ICON = { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' };

// "Tuesday, 29 September" in Israel time.
export function formatHeroDate(now) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: PANEL_TIME_ZONE }).format(new Date(now));
}

// The words of the Live pill for each status tone.
function livePill(status, lastDone, now) {
  const time = lastDone ? formatUpdateTime(lastDone.finishedAt, PANEL_TIME_ZONE, now) : null;
  switch (status.tone) {
    case 'ok': return { label: 'Live', note: `updated ${time.charAt(0).toLowerCase()}${time.slice(1)} IST` };
    case 'running': return { label: 'Updating', note: 'a daily run is going on now' };
    case 'failed': return { label: 'Last run failed', note: time ? `data from ${time} IST` : 'no finished run yet' };
    case 'stale': return { label: 'Not updated', note: `last update ${time} IST` };
    default: return { label: 'No daily run yet', note: 'data from the 90-day collection' };
  }
}

// The briefing sentence: plain parts and clickable company names.
function Briefing({ parts, onOpenCompany }) {
  return (
    <p className={styles.brief}>
      {parts.map((part, index) => {
        if (part.company) {
          return <button key={index} type="button" className={styles.briefCompany} onClick={() => onOpenCompany(part.company.id)}>{part.company.name}</button>;
        }
        if (part.strong) return <b key={index}>{part.strong}</b>;
        if (part.up) return <span key={index} className={styles.up}>{part.up}</span>;
        if (part.down || part.negative) return <span key={index} className={styles.down}>{part.down ?? part.negative}</span>;
        return <span key={index}>{part.text}</span>;
      })}
    </p>
  );
}

// `title` = the page's name; `briefing` = show the week's sentence; `companies`, `dailyRun`,
// `windowStart`, `asOf`, `windowDays` = from the company list; `onOpenCompany(id)`; `now` (tests).
export function Hero({ title, subtitle, briefing = false, companies = [], dailyRun, windowStart, asOf, windowDays, onOpenCompany, now = Date.now() }) {
  const overview = useOverview();
  const status = updateStatus(dailyRun, now);
  const lastDone = dailyRun?.lastDone ?? null;
  const live = livePill(status, lastDone, now);
  const parts = briefing && companies.length ? buildBriefing(companies, overview.data?.attention ?? []) : null;
  return (
    <header className={styles.hero}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.content}>
        <div className={styles.date}>{formatHeroDate(now)}</div>
        <h1 className={styles.title}>{title}</h1>
        {parts ? <Briefing parts={parts} onOpenCompany={onOpenCompany} /> : subtitle && <p className={styles.subtitle}>{subtitle}</p>}

        <div className={styles.pills}>
          {dailyRun && (
            <span className={`${styles.pill} ${styles[`live_${status.tone}`]}`} role="status" title={status.title}>
              <span className={styles.pulse} aria-hidden="true" />
              {live.label} <span className={styles.pillNote}>· {live.note}</span>
            </span>
          )}
          {lastDone && (
            <span className={`${styles.pill} ${styles.news}`}>
              <svg {...ICON}><path d="M12 3l2.2 5.6L20 9l-4.5 3.8L17 19l-5-3.2L7 19l1.5-6.2L4 9l5.8-.4z" /></svg>
              {formatCount(lastDone.newMentions)} new mentions · {formatCount(lastDone.companiesWithUpdates)} companies
            </span>
          )}
          {lastDone && (
            <span className={`${styles.pill} ${lastDone.discordSent ? styles.sent : styles.notSent}`}>
              <svg {...ICON}>{lastDone.discordSent ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7L7 17" />}</svg>
              {lastDone.discordSent ? 'Discord sent' : 'Discord not sent'}
            </span>
          )}
          {asOf && (
            <span className={`${styles.pill} ${styles.window}`}>
              <svg {...ICON}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
              {formatDate(windowStart)} – {formatDate(asOf)} · {windowDays} days
            </span>
          )}
        </div>

        {overview.data?.recent?.length > 0 && <Ticker mentions={overview.data.recent} />}
      </div>
    </header>
  );
}

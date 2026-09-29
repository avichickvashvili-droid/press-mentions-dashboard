// KpiCards.jsx — the four number cards at the top of the Overview (D117): total mentions (with the
// change vs the 30 days before and a mini chart), companies mentioned (a ring), the sentiment
// split, and the last daily run (the same numbers as its Discord message, D113).
//
// Where it sits: in OverviewPage, above the charts. Reads: its props only.

import { formatCount } from '../../utils/activity.js';
import { formatUpdateTime, PANEL_TIME_ZONE } from '../../utils/dates.js';
import { percentChange, sentimentShares } from '../../utils/overview.js';
import { CountUp, Ring, Sparkline, SplitBar } from './visuals.jsx';
import styles from './Overview.module.css';

const ICON = { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' };
const icons = {
  mentions: <svg {...ICON}><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></svg>,
  companies: <svg {...ICON}><path d="M5 21V4h10v17M15 9h4v12M3 21h18M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1" /></svg>,
  sentiment: <svg {...ICON}><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></svg>,
  daily: <svg {...ICON}><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4" /><path d="M12 8v4l2.5 2.5" /></svg>,
};

// One card: an icon, a label, the main content and a line under it.
function Card({ icon, tone, label, children, className = '' }) {
  return (
    <section className={`${styles.card} ${styles.kpi} ${className}`} aria-label={label}>
      <div className={styles.kpiHead}>
        <span className={`${styles.kpiIcon} ${styles[tone]}`}>{icon}</span>
        <span className={styles.kpiLabel}>{label}</span>
      </div>
      {children}
    </section>
  );
}

// `overview` = GET /api/overview; `dailyRun` = the company list's dailyRun (D113); `now` = ms.
export function KpiCards({ overview, dailyRun, now = Date.now() }) {
  const { totals, trend, daily } = overview;
  const change = percentChange(trend.current, trend.previous);
  const shares = sentimentShares(totals);
  const lastDone = dailyRun?.lastDone ?? null;
  const lastDays = daily.slice(-trend.days).map((d) => d.positive + d.neutral + d.negative);
  return (
    <div className={styles.kpis}>
      <Card icon={icons.mentions} tone="accent" label="Total mentions">
        <div className={styles.kpiRow}>
          <div>
            <div className={styles.kpiValue}><CountUp value={totals.mentions} /></div>
            <div className={styles.kpiNote}>
              <span className={`${styles.chip} ${styles[change.direction]}`}>
                {change.direction === 'up' ? '↑' : change.direction === 'down' ? '↓' : '='} {change.percent === null ? 'new' : `${change.percent}%`}
              </span>
              <span>last {trend.days} days vs the {trend.days} before</span>
            </div>
          </div>
          <Sparkline values={lastDays} tone="accent" label={`Mentions per day, last ${trend.days} days`} />
        </div>
      </Card>

      <Card icon={icons.companies} tone="purple" label="Companies mentioned">
        <div className={styles.kpiRow}>
          <div>
            <div className={styles.kpiValue}>
              <CountUp value={totals.companiesMentioned} />
              <span className={styles.outOf}> / {formatCount(totals.companies)}</span>
            </div>
            <div className={styles.kpiNote}><span>{formatCount(totals.companies - totals.companiesMentioned)} with no coverage in {overview.windowDays} days</span></div>
          </div>
          <Ring part={totals.companiesMentioned} whole={totals.companies} />
        </div>
      </Card>

      <Card icon={icons.sentiment} tone="teal" label="Sentiment breakdown">
        <SplitBar positive={totals.positive} neutral={totals.neutral} negative={totals.negative} />
        <div className={styles.legend3}>
          {[['positive', 'Positive', 'bgPositive'], ['negative', 'Negative', 'bgNegative'], ['neutral', 'Neutral', 'bgNeutral']].map(([key, label, colour]) => (
            <div key={key} className={styles.legendPart}>
              <span className={styles.legendPercent}><span className={`${styles.dot} ${styles[colour]}`} />{shares[key]}%</span>
              <span className={styles.legendName}>{label}</span>
              <small>{formatCount(totals[key])}</small>
            </div>
          ))}
        </div>
      </Card>

      <Card icon={icons.daily} tone="amber" label="Last daily run">
        {lastDone ? (
          <>
            <div className={styles.kpiValue}>
              <CountUp value={lastDone.newMentions} />
              <span className={styles.outOf}> new mentions</span>
            </div>
            <div className={styles.kpiNote}>
              <span>{formatCount(lastDone.companiesWithUpdates)} companies · {formatUpdateTime(lastDone.finishedAt, PANEL_TIME_ZONE, now)} · {lastDone.discordSent ? 'Discord sent' : 'Discord not sent'}</span>
            </div>
          </>
        ) : (
          <div className={styles.kpiNote}><span>No daily run yet: the data is from the 90-day collection</span></div>
        )}
      </Card>
    </div>
  );
}

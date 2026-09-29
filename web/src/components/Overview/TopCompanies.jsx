// TopCompanies.jsx — "Top companies" (D117): the top 10 by a tab: Most mentioned (90 days),
// Trending (the biggest rise this week vs the week before), Most positive / Most negative (share of
// their 90 days, only companies with at least 20 mentions). A row opens the company.
//
// Where it sits: in OverviewPage. Reads: the company list (GET /api/companies) from its props.

import { useState } from 'react';
import { formatCount } from '../../utils/activity.js';
import { percentChange, sentimentShares, SHARE_MIN_MENTIONS, TOP_TABS, topCompanies } from '../../utils/overview.js';
import { CompanyLogo } from '../CompanyLogo/CompanyLogo.jsx';
import { StatusText } from '../StatusText/StatusText.jsx';
import { SplitBar } from './visuals.jsx';
import styles from './Overview.module.css';

// The "this week" chip of a row: ↑ 57% (or ↑ 12 when the week before had fewer than 10).
function WeekChip({ week, prev }) {
  const change = percentChange(week, prev);
  if (week === 0 && prev === 0) return <span className={styles.muted}>–</span>;
  const size = prev >= 10 ? `${change.percent}%` : formatCount(Math.abs(week - prev));
  return (
    <span className={`${styles.chip} ${styles[change.direction]}`} title={`${week} this week, ${prev} the week before`}>
      {change.direction === 'up' ? '↑' : change.direction === 'down' ? '↓' : '='} {change.direction === 'same' ? 'same' : size}
    </span>
  );
}

// `companies` = the company list; `onOpen(id)` opens a company; `onViewAll()` goes to Companies.
export function TopCompanies({ companies, onOpen, onViewAll }) {
  const [tab, setTab] = useState(TOP_TABS[0].value);
  const rows = topCompanies(companies, tab);
  const shareColumn = tab === 'positive' || tab === 'negative';
  return (
    <section className={`${styles.card} ${styles.listCard}`} aria-label="Top companies">
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Top companies</h2>
          <p className={styles.cardSub}>
            {tab === 'trending' ? 'Biggest rise this week vs the week before' : shareColumn ? `Share of their 90 days (at least ${SHARE_MIN_MENTIONS} mentions)` : 'Most mentions in 90 days'}
          </p>
        </div>
        <button type="button" className={styles.linkButton} onClick={onViewAll}>View all companies →</button>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Rank by">
        {TOP_TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} className={tab === t.value ? styles.tabOn : ''} onClick={() => setTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>No company fits this list right now.</p>
      ) : (
        <table className={styles.topTable}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Company</th>
              <th scope="col" className={styles.num}>{shareColumn ? 'Share' : 'Mentions'}</th>
              <th scope="col">This week</th>
              <th scope="col">Sentiment</th>
              <th scope="col">Last mentioned</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((company, index) => {
              const shares = sentimentShares(company.sentimentCounts);
              return (
                <tr key={company.id} className={styles.clickRow} onClick={() => onOpen(company.id)}>
                  <td className={styles.rank}>{index + 1}</td>
                  <td>
                    <button type="button" className={styles.companyButton} onClick={(e) => { e.stopPropagation(); onOpen(company.id); }}>
                      <CompanyLogo name={company.name} logoUrl={company.logoUrl} />
                      <span>{company.name}</span>
                    </button>
                  </td>
                  <td className={styles.num}>
                    {shareColumn ? <span className={tab === 'positive' ? styles.textPositive : styles.textNegative}>{shares[tab]}%</span> : formatCount(company.mentionCount)}
                  </td>
                  <td><WeekChip week={company.weekCount} prev={company.prevWeekCount} /></td>
                  <td className={styles.barCell}><SplitBar {...company.sentimentCounts} thin /></td>
                  <td><StatusText status={company.status} daysAgo={company.daysAgo} lastMentionAt={company.lastMentionAt} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

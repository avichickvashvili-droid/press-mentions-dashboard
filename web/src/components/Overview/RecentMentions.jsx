// RecentMentions.jsx — "Recent mentions" (D117): the newest mentions of all companies (from GET
// /api/overview `recent`), with All / Positive / Neutral / Negative buttons and their counts. The
// headline opens the article in a new tab; the company opens its mentions on the Companies page.
//
// Where it sits: in OverviewPage, at the bottom. Reads: its props only.

import { useState } from 'react';
import { formatDateTime, PANEL_TIME_ZONE } from '../../utils/dates.js';
import { isWebAddress } from '../../utils/links.js';
import { timeAgo } from '../../utils/overview.js';
import { CompanyLogo } from '../CompanyLogo/CompanyLogo.jsx';
import { SentimentBadge } from '../SentimentBadge/SentimentBadge.jsx';
import styles from './Overview.module.css';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
];

// `mentions` = the overview's recent list; `onOpen(id)` opens a company; `now` = ms.
export function RecentMentions({ mentions, onOpen, now = Date.now() }) {
  const [filter, setFilter] = useState('all');
  const count = (value) => (value === 'all' ? mentions.length : mentions.filter((m) => m.sentiment === value).length);
  const shown = filter === 'all' ? mentions : mentions.filter((m) => m.sentiment === filter);
  return (
    <section className={`${styles.card} ${styles.listCard}`} aria-label="Recent mentions">
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Recent mentions</h2>
          <p className={styles.cardSub}>The newest {mentions.length} across all companies</p>
        </div>
        <div className={styles.segmented} role="group" aria-label="Filter by sentiment">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" aria-pressed={filter === f.value} className={filter === f.value ? styles.segOn : ''} onClick={() => setFilter(f.value)}>
              {f.label} <span className={styles.segCount}>{count(f.value)}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className={styles.empty}>No {filter} mentions among the newest.</p>
      ) : (
        <div className={styles.recentScroll}>
          <table className={styles.recentTable}>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Company</th>
                <th scope="col">Headline</th>
                <th scope="col">Source</th>
                <th scope="col">Sentiment</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td className={styles.time} title={`${formatDateTime(m.publishedAt, PANEL_TIME_ZONE)} IST`}>{timeAgo(m.publishedAt, now)}</td>
                  <td>
                    <button type="button" className={styles.companyButton} onClick={() => onOpen(m.companyId)}>
                      <CompanyLogo name={m.companyName} logoUrl={m.logoUrl} />
                      <span>{m.companyName}</span>
                    </button>
                  </td>
                  <td className={styles.headline}>
                    {isWebAddress(m.url) ? <a href={m.url} target="_blank" rel="noopener noreferrer">{m.title}</a> : m.title}
                  </td>
                  <td className={styles.source}>{m.publisher ?? '–'}</td>
                  <td><SentimentBadge sentiment={m.sentiment} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

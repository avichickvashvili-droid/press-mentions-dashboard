// MentionsPanel.jsx — the selected company's mentions from the last N days (N = the api's
// windowDays setting), grouped by day, newest first (FR2, FR3, FR4; owner's design, Prompts
// 319-320, D111).
//
// Where it sits: beside the company table in App.jsx.
// Reads: the mentions through the useCompanyMentions hook (never fetch directly, D100).
//
// The panel: the logo, the name and "934 mentions in last 90 days", a × that closes it; a headline
// search with two icons beside it (owner, Prompts 331-332), each opening a small menu: Time range
// (a clock: 24h / 7d / 30d / 90d) and Sentiment (the filter lines: All / Positive / Neutral /
// Negative), each choice with its count. A choice that is not the default puts a dot on its icon
// and a small pill under the search ("7d ×", "Negative ×"); the pill's × goes back to the
// default. The list itself is always newest first (no sort). The list is grouped by day ("Wed 30 Sep (4)", Israel time),
// each mention with its sentiment, headline (one line; the whole one on hover), publisher and
// time ("10:35 IST") and a ↗ that opens the article. All filtering is done here (the api sends
// the whole list): src/utils/mentionFilters.js. 90d is chosen when a company opens, and another
// company starts again from these defaults (the filters live in MentionsBrowser, keyed by the
// company).
//
// States: nothing selected, loading, error (with "Try again"; a company that is not found gets
// its own message), no mentions ("no coverage found in the last N days"), nothing matches the
// filters, the list.
// Pages (owner, Prompt 265, D101): MENTIONS_PER_PAGE mentions per page, split here in the page.
// The page goes back to 1 when the company or a filter changes, never goes past the last page,
// and the panel goes back to its top when the page changes (its scroll area on a wide screen; on
// a narrow screen the page scrolls up to the panel if its top is out of view). The page nav is
// hidden when everything fits on one page. A day split over two pages shows its heading (with
// the day's full count) on both.
// Headlines and publisher names come from the internet: React writes them as plain text, never
// as HTML (NFR10). Links open in a new tab, without giving the new page access to this one.
// Only an http(s) address becomes a link; any other address shows the headline as plain text
// (the stored address is never changed).

import { useMemo, useRef, useState } from 'react';
import { useCompanyMentions } from '../../hooks/useCompanyMentions.js';
import { usePagination } from '../../hooks/usePagination.js';
import { formatCount } from '../../utils/activity.js';
import { formatDayHeading, formatTime, PANEL_TIME_LABEL, PANEL_TIME_ZONE } from '../../utils/dates.js';
import { isWebAddress } from '../../utils/links.js';
import { DEFAULT_MENTION_FILTERS, filterMentions, groupByDay, SENTIMENT_FILTERS, timeRanges } from '../../utils/mentionFilters.js';
import { SentimentBadge } from '../SentimentBadge/SentimentBadge.jsx';
import { CompanyLogo } from '../CompanyLogo/CompanyLogo.jsx';
import { CompanySearch } from '../CompanySearch/CompanySearch.jsx';
import { ActivePill, ClockIcon, FilterIcon, IconMenu } from '../common/IconMenu.jsx';
import { Loading } from '../common/Loading.jsx';
import { ErrorMessage } from '../common/ErrorMessage.jsx';
import { PageNav } from './PageNav.jsx';
import styles from './MentionsPanel.module.css';

// How many mentions one page of the panel shows.
export const MENTIONS_PER_PAGE = 20;

// The sentiment choices with their colours.
const SENTIMENT_OPTIONS = SENTIMENT_FILTERS.map((option) => (option.value === 'all' ? option : { ...option, tone: option.value }));

// One mention: sentiment, headline (a link when it is a web address), publisher · time, ↗.
function MentionItem({ mention }) {
  const link = isWebAddress(mention.url);
  const time = formatTime(mention.publishedAt, PANEL_TIME_ZONE);
  return (
    <li className={styles.item}>
      <SentimentBadge sentiment={mention.sentiment} />
      <div className={styles.itemText}>
        {link
          ? <a className={styles.headline} href={mention.url} target="_blank" rel="noopener noreferrer" title={mention.title}>{mention.title}</a>
          : <span className={styles.headline} title={mention.title}>{mention.title}</span>}
        <div className={styles.meta}>
          {[mention.publisher, time && `${time} ${PANEL_TIME_LABEL}`].filter(Boolean).join(' · ')}
        </div>
      </div>
      {link && (
        // The ↗ repeats the headline link for the mouse; keyboard and screen readers use the headline.
        <a className={styles.open} href={mention.url} target="_blank" rel="noopener noreferrer" aria-hidden="true" tabIndex={-1}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M9 2h5v5M14 2L7 9M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
      )}
    </li>
  );
}

// One page of mentions, grouped by day. `all` = every mention that passes the filters (for the
// day counts); `now` = the api's time (the heading shows the year only for another year).
function MentionDays({ pageMentions, all, now }) {
  const days = groupByDay(pageMentions, all, PANEL_TIME_ZONE);
  return days.map((day) => (
    <section key={day.day} className={styles.day} aria-label={formatDayHeading(day.firstAt, PANEL_TIME_ZONE, now)}>
      <h3 className={styles.dayHeading}>
        {formatDayHeading(day.firstAt, PANEL_TIME_ZONE, now)} <span className={styles.dayCount}>({day.count})</span>
      </h3>
      <ul className={styles.list}>
        {day.mentions.map((mention, index) => <MentionItem key={`${index}-${mention.url}`} mention={mention} />)}
      </ul>
    </section>
  ));
}

// The filters and the list of one company. It is drawn with key = the company id, so another
// company starts again from the default filters (owner, Prompt 320).
function MentionsBrowser({ companyId, data, windowDays, panelRef }) {
  const [filters, setFilters] = useState(DEFAULT_MENTION_FILTERS);
  const now = data.asOf ? Date.parse(data.asOf) : Date.now();
  const result = useMemo(() => filterMentions(data.mentions, filters, { now, windowDays }), [data.mentions, filters, now, windowDays]);
  const pages = usePagination(result.mentions, MENTIONS_PER_PAGE, `${companyId}|${filters.range}|${filters.sentiment}|${filters.search}`);
  const change = (part) => (value) => setFilters((current) => ({ ...current, [part]: value }));
  const ranges = timeRanges(windowDays);
  const rangeChanged = filters.range !== DEFAULT_MENTION_FILTERS.range;
  const sentimentChanged = filters.sentiment !== DEFAULT_MENTION_FILTERS.sentiment;

  // Changes the page and brings the panel back to its top.
  const goToPage = (n) => {
    pages.goToPage(n);
    scrollPanelToTop(panelRef.current);
  };

  return (
    <>
      <div className={styles.filters}>
        <div className={styles.searchRow}>
          <div className={styles.searchSlot}>
            <CompanySearch id="headline-search" label="Search headlines" placeholder="Search headlines…" value={filters.search} onChange={change('search')} />
          </div>
          <IconMenu label="Time range" icon={<ClockIcon />} active={rangeChanged} sections={[{ options: ranges, counts: result.rangeCounts, value: filters.range, onChange: change('range') }]} />
          <IconMenu label="Sentiment" icon={<FilterIcon />} active={sentimentChanged} sections={[{ options: SENTIMENT_OPTIONS, counts: result.sentimentCounts, value: filters.sentiment, onChange: change('sentiment') }]} />
        </div>
        {(rangeChanged || sentimentChanged) && (
          <div className={styles.pills}>
            {rangeChanged && <ActivePill label={ranges.find((r) => r.value === filters.range)?.label ?? filters.range} onRemove={() => change('range')(DEFAULT_MENTION_FILTERS.range)} />}
            {sentimentChanged && <ActivePill label={SENTIMENT_FILTERS.find((o) => o.value === filters.sentiment)?.label ?? filters.sentiment} onRemove={() => change('sentiment')(DEFAULT_MENTION_FILTERS.sentiment)} />}
          </div>
        )}
      </div>
      {result.mentions.length === 0
        ? <p className={styles.hint}>No mentions match these filters.</p>
        : (
          <>
            {pages.pageCount > 1 && <PageNav page={pages.page} pageCount={pages.pageCount} onGoTo={goToPage} />}
            <MentionDays pageMentions={pages.pageItems} all={result.mentions} now={now} />
          </>
        )}
    </>
  );
}

// The content of the panel for the current state of the query.
function PanelContent({ query, companyId, windowDays, panelRef }) {
  if (query.isPending) return <Loading text="Loading mentions ..." />;
  if (query.isError) {
    if (query.error?.status === 404) {
      return <ErrorMessage message="This company was not found. Reload the page to load the company list again." />;
    }
    return <ErrorMessage message={query.error?.message ?? 'The mentions could not be loaded.'} onRetry={query.refetch} />;
  }
  if (query.data.mentions.length === 0) {
    return <p className={styles.hint}>No coverage found{windowDays ? ` in the last ${windowDays} days` : ''}.</p>;
  }
  return <MentionsBrowser key={companyId} companyId={companyId} data={query.data} windowDays={windowDays} panelRef={panelRef} />;
}

// "1 mention" or "1,243 mentions".
function mentionCountText(count) {
  return `${formatCount(count)} ${count === 1 ? 'mention' : 'mentions'}`;
}

// Brings the panel back to its top after a page change. On a wide screen the panel sits in its
// own scroll area (App's .panelArea, the element around the panel): that goes back to 0. On a
// narrow screen the page itself scrolls: if the panel's top is above the screen, the page
// scrolls up to it.
function scrollPanelToTop(panel) {
  if (!panel) return;
  const scrollArea = panel.parentElement;
  if (scrollArea) scrollArea.scrollTop = 0;
  if (panel.getBoundingClientRect().top < 0) panel.scrollIntoView?.({ block: 'start' });
}

// `companyId` = the selected company (or null); `companyName` / `logoUrl` = from the company
// list (the title shows while loading); `windowDays` = how many days the window covers;
// `onClose()` = the × was clicked.
export function MentionsPanel({ companyId, companyName, logoUrl = null, windowDays, onClose }) {
  const query = useCompanyMentions(companyId);
  const panelRef = useRef(null);

  if (!companyId) {
    return (
      <aside className={styles.panel}>
        <p className={styles.hint}>Click a company to see its mentions.</p>
      </aside>
    );
  }

  const title = query.data?.company.name ?? companyName ?? companyId;
  return (
    <aside className={styles.panel} ref={panelRef} aria-label={`Mentions of ${title}`}>
      <div className={styles.top}>
        <CompanyLogo name={title} logoUrl={logoUrl} size="large" />
        <div className={styles.titleBox}>
          <h2 className={styles.title}>{title}</h2>
          {query.data && (
            <p className={styles.subtitle}>{mentionCountText(query.data.mentions.length)} in last {windowDays ?? 90} days</p>
          )}
        </div>
        {onClose && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close the mentions">×</button>
        )}
      </div>
      <PanelContent query={query} companyId={companyId} windowDays={windowDays} panelRef={panelRef} />
    </aside>
  );
}

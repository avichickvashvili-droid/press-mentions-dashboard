// MentionsPanel.jsx — the selected company's mentions from the last 90 days, newest first, each
// with its date, sentiment, headline (a link to the article) and publisher (FR2, FR3, FR4).
//
// Where it sits: beside the company table in App.jsx.
// Reads: the mentions through the useCompanyMentions hook (never fetch directly, D100).
//
// States: nothing selected, loading, error (with "Try again"; a company that is not found gets
// its own message), no mentions ("no coverage found in the last 90 days"), the list.
// Pages (owner, Prompt 265, D101): MENTIONS_PER_PAGE mentions per page, split here in the page
// (the api sends the whole list). The page goes back to 1 for another company, never goes past
// the last page, and the panel scrolls back to its top when the page changes. The page nav is
// hidden when everything fits on one page.
// Headlines and publisher names come from the internet: React writes them as plain text, never
// as HTML (NFR10). Links open in a new tab, without giving the new page access to this one.

import { useRef } from 'react';
import { useCompanyMentions } from '../../hooks/useCompanyMentions.js';
import { usePagination } from '../../hooks/usePagination.js';
import { formatDate } from '../../utils/dates.js';
import { SentimentBadge } from '../SentimentBadge/SentimentBadge.jsx';
import { Loading } from '../common/Loading.jsx';
import { ErrorMessage } from '../common/ErrorMessage.jsx';
import { PageNav } from './PageNav.jsx';
import styles from './MentionsPanel.module.css';

// How many mentions one page of the panel shows.
export const MENTIONS_PER_PAGE = 20;

// One page of mentions as a list.
function MentionList({ mentions }) {
  return (
    <ul className={styles.list}>
      {mentions.map((mention, index) => (
        <li key={`${index}-${mention.url}`} className={styles.item}>
          <div className={styles.itemMeta}>
            <span>{formatDate(mention.publishedAt)}</span>
            <SentimentBadge sentiment={mention.sentiment} />
          </div>
          <a href={mention.url} target="_blank" rel="noopener noreferrer">{mention.title}</a>
          {mention.publisher && <div className={styles.publisher}>{mention.publisher}</div>}
        </li>
      ))}
    </ul>
  );
}

// The content of the panel for the current state of the query.
function PanelContent({ query, pages, onGoTo }) {
  if (query.isPending) return <Loading text="Loading mentions ..." />;
  if (query.isError) {
    if (query.error?.status === 404) {
      return <ErrorMessage message="This company was not found. Press Refresh to load the company list again." />;
    }
    return <ErrorMessage message={query.error?.message ?? 'The mentions could not be loaded.'} onRetry={query.refetch} />;
  }
  if (query.data.mentions.length === 0) {
    return <p className={styles.hint}>No coverage found in the last 90 days.</p>;
  }
  return (
    <>
      {pages.pageCount > 1 && <PageNav page={pages.page} pageCount={pages.pageCount} onGoTo={onGoTo} />}
      <MentionList mentions={pages.pageItems} />
    </>
  );
}

// `companyId` = the selected company (or null); `companyName` = its name, shown in the title.
export function MentionsPanel({ companyId, companyName }) {
  const query = useCompanyMentions(companyId);
  const pages = usePagination(query.data?.mentions, MENTIONS_PER_PAGE, companyId);
  const panelRef = useRef(null);

  // Changes the page and scrolls back to the top of the panel (the panel's own scroll area on a
  // wide screen, the page on a narrow one).
  const goToPage = (n) => {
    pages.goToPage(n);
    panelRef.current?.scrollIntoView?.({ block: 'nearest' });
  };

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
      <h2 className={styles.title}>
        {title}
        {query.data ? ` · ${query.data.mentions.length} mentions` : ''}
      </h2>
      <PanelContent query={query} pages={pages} onGoTo={goToPage} />
    </aside>
  );
}

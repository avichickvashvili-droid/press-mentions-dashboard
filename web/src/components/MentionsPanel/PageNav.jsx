// PageNav.jsx — the small page navigation of the mentions panel: « First, ‹ Previous,
// "Page 3 of 161", Next ›, Last » (owner, Prompt 265, D101).
//
// Where it sits: drawn by MentionsPanel.jsx above the list, only when there is more than one page.
// A button that can't be used (First / Previous on page 1, Next / Last on the last page) is disabled.

import styles from './MentionsPanel.module.css';

// `page` and `pageCount` start at 1; `onGoTo(n)` changes the page.
export function PageNav({ page, pageCount, onGoTo }) {
  const onFirst = page <= 1;
  const onLast = page >= pageCount;
  return (
    <nav className={styles.pageNav} aria-label="Mention pages">
      <button type="button" onClick={() => onGoTo(1)} disabled={onFirst}>« First</button>
      <button type="button" onClick={() => onGoTo(page - 1)} disabled={onFirst}>‹ Previous</button>
      <span className={styles.pageText}>Page {page} of {pageCount}</span>
      <button type="button" onClick={() => onGoTo(page + 1)} disabled={onLast}>Next ›</button>
      <button type="button" onClick={() => onGoTo(pageCount)} disabled={onLast}>Last »</button>
    </nav>
  );
}

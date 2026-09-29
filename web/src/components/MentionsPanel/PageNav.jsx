// PageNav.jsx — the small page navigation of the mentions panel: four icon buttons (first «,
// previous ‹, next ›, last », drawn as chevrons) and "3 / 161" between them (owner, Prompt 265,
// D101; icons only, Prompt 331).
//
// Where it sits: drawn by MentionsPanel.jsx above the list, only when there is more than one page.
// Reads/writes: nothing; a click is reported with onGoTo(n).
// Each button has a name for screen readers and a tooltip ("First page", "Next page", ...); a
// button that can't be used (First / Previous on page 1, Next / Last on the last page) is disabled.

import styles from './MentionsPanel.module.css';

// The chevron paths (16×16), pointing left: one chevron, or two for the first / last page.
const SINGLE = 'M10 3.5L5.5 8l4.5 4.5';
const DOUBLE = 'M8 3.5L3.5 8 8 12.5M12.5 3.5L8 8l4.5 4.5';

// One chevron icon; `right` turns it to point right (next / last).
function Chevron({ path, right = false }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={path} transform={right ? 'matrix(-1 0 0 1 16 0)' : undefined} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// One page button (`name` = its name for screen readers and its tooltip).
function PageButton({ name, disabled, onClick, children }) {
  return (
    <button type="button" className={styles.pageButton} aria-label={name} title={name} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

// `page` and `pageCount` start at 1; `onGoTo(n)` changes the page.
export function PageNav({ page, pageCount, onGoTo }) {
  const onFirst = page <= 1;
  const onLast = page >= pageCount;
  return (
    <nav className={styles.pageNav} aria-label="Mention pages">
      <PageButton name="First page" disabled={onFirst} onClick={() => onGoTo(1)}><Chevron path={DOUBLE} /></PageButton>
      <PageButton name="Previous page" disabled={onFirst} onClick={() => onGoTo(page - 1)}><Chevron path={SINGLE} /></PageButton>
      <span className={styles.pageText}>
        <span aria-hidden="true">{page} / {pageCount}</span>
        <span className="visually-hidden">Page {page} of {pageCount}</span>
      </span>
      <PageButton name="Next page" disabled={onLast} onClick={() => onGoTo(page + 1)}><Chevron path={SINGLE} right /></PageButton>
      <PageButton name="Last page" disabled={onLast} onClick={() => onGoTo(pageCount)}><Chevron path={DOUBLE} right /></PageButton>
    </nav>
  );
}

// usePagination.js — splits an already loaded list into pages, in the page itself (owner,
// Prompt 265, D101). The api still sends the whole list; only the part on screen changes.
//
// Where it sits: used by MentionsPanel (20 mentions per page).
// Reads/writes: nothing (the page number is React state).
//
//   - The page number starts at 1 and goes back to 1 when `resetKey` changes (another company).
//   - If the list gets shorter (e.g. after a reload), a page past the end becomes the last page,
//     so an empty page is never shown.

import { useMemo, useState } from 'react';

// The list used while nothing is loaded yet (one fixed array, so useMemo sees no change).
const NO_ITEMS = [];

// Returns { page, pageCount, pageItems, goToPage(n) } for `items` (an array, or undefined while
// loading) split into pages of `pageSize`.
export function usePagination(items, pageSize, resetKey) {
  const [state, setState] = useState({ resetKey, page: 1 });
  const list = items ?? NO_ITEMS;
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));

  // Another company: start again at page 1 at once (React's pattern for resetting state when a
  // value changes: the stored state is updated while drawing, no effect needed).
  const requestedPage = state.resetKey === resetKey ? state.page : 1;
  if (state.resetKey !== resetKey) setState({ resetKey, page: 1 });
  // Never past the last page (the list may have become shorter).
  const page = Math.min(requestedPage, pageCount);

  const pageItems = useMemo(() => list.slice((page - 1) * pageSize, page * pageSize), [list, page, pageSize]);

  // Goes to page `n`, kept between 1 and the last page.
  const goToPage = (n) => setState({ resetKey, page: Math.min(Math.max(1, n), pageCount) });

  return { page, pageCount, pageItems, goToPage };
}

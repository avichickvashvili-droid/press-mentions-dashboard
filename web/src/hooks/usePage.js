// usePage.js — which page is open: the Overview (the default) or Companies (owner, Prompt 364,
// D117). Kept in the address as ?page=companies, so a refresh stays on the page and Back goes to
// the page before (still no router, D98).
//
// Where it sits: used by App.jsx. The open company (?company=, useSelectedCompany.js) lives next
// to it in the same address.
// Reads: window.location (at start and on Back / Forward). Writes: the address with
// history.pushState (each page change is one Back step).

import { useCallback, useEffect, useState } from 'react';

export const PAGE_PARAM = 'page';
export const PAGES = Object.freeze(['overview', 'companies']);
export const DEFAULT_PAGE = 'overview';

// The page named in an address's query string, or the default for anything else. A link with
// only ?company=<id> (the links from before the Overview, D109) opens the Companies page, where
// that company is shown (owner, Prompt 365).
export function readPageFromSearch(search) {
  try {
    const params = new URLSearchParams(search);
    const page = params.get(PAGE_PARAM);
    if (PAGES.includes(page)) return page;
    return params.get('company')?.trim() ? 'companies' : DEFAULT_PAGE;
  } catch {
    return DEFAULT_PAGE;
  }
}

// The address `href` for `page` (the default page has no ?page=), with `changes` to other query
// parts ({ name: value | null }); the rest of the address is kept.
export function addressForPage(href, page, changes = {}) {
  const url = new URL(href);
  if (page === DEFAULT_PAGE) url.searchParams.delete(PAGE_PARAM);
  else url.searchParams.set(PAGE_PARAM, page);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || value === undefined) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  return url.pathname + url.search + url.hash;
}

// Returns [page, goTo(page, changes)]. goTo also applies `changes` to the address (e.g. opening a
// company: { company: 'spacex' }) and scrolls to the top.
export function usePage() {
  const [page, setPage] = useState(() => readPageFromSearch(window.location.search));

  useEffect(() => {
    const onBack = () => setPage(readPageFromSearch(window.location.search));
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  const goTo = useCallback((next, changes = {}) => {
    setPage(next);
    try {
      // The same address again (e.g. Overview on the Overview) adds no Back step (code review #5).
      const address = addressForPage(window.location.href, next, changes);
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (address !== current) window.history.pushState(window.history.state, '', address);
    } catch {
      // The address is only a convenience: the page still changes.
    }
    try {
      window.scrollTo?.({ top: 0 });
    } catch {
      // jsdom and old browsers
    }
  }, []);

  return [page, goTo];
}

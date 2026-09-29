// useSelectedCompany.js — which company's mentions are open, kept in the page address as
// ?company=<id> (owner, Prompt 313, D109), so a refresh (F5) keeps it open and the address can be
// sent to someone to open the same company.
//
// Where it sits: used by App.jsx instead of a plain useState (still no router, D98).
// Reads: window.location once, when the page opens. Writes: the address, with
// history.replaceState (no new Back-button step per click, and the page never reloads).
// An id that is not a company (an old or mistyped link) is shown by the mentions panel as
// "This company was not found".

import { useState } from 'react';

export const COMPANY_PARAM = 'company';

// Reads the company id from an address's query string ("?company=spacex" → "spacex").
// Returns null when there is none, or it is empty.
export function readCompanyFromSearch(search) {
  try {
    const id = new URLSearchParams(search).get(COMPANY_PARAM);
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

// Returns the address `href` with ?company=<id> set, or removed when `id` is null. Other query
// parts and the #hash are kept.
export function addressWithCompany(href, id) {
  const url = new URL(href);
  if (id) url.searchParams.set(COMPANY_PARAM, id);
  else url.searchParams.delete(COMPANY_PARAM);
  return url.pathname + url.search + url.hash;
}

// Returns [selectedId, select(id)], like useState. Changing the address can fail (e.g. a browser
// that blocks it); the selection still works, only the address stays the same.
export function useSelectedCompany() {
  const [selectedId, setSelectedId] = useState(() => readCompanyFromSearch(window.location.search));

  // Opens a company (or closes with null) and writes it into the address.
  const select = (id) => {
    setSelectedId(id);
    try {
      window.history.replaceState(window.history.state, '', addressWithCompany(window.location.href, id));
    } catch {
      // The address is only a convenience: keep the selection.
    }
  };

  return [selectedId, select];
}

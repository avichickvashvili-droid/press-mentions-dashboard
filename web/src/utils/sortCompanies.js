// sortCompanies.js — the order of the company table (owner: Prompt 265, D101; click-to-sort:
// Prompt 282, D104).
//
// Where it sits: used by App.jsx (inside useMemo, over the loaded list; the search filter is
// applied after it). The chosen sort comes from the useTableSort hook (a click on a header).
// Reads/writes: nothing.
//
// A sort is { column, direction }:
//   'name'     Company: 'asc' = A-Z, 'desc' = Z-A (any case). No-coverage companies sort by name too.
//   'status'   by the latest mention: 'desc' = most recent first (today at the top),
//              'asc' = furthest first.
//   'mentions' by the mention count: 'desc' = most first, 'asc' = fewest first.
// For 'status' and 'mentions', companies with no coverage always stay at the bottom.
// Equal values are ordered by name A-Z. The sentiment columns can't be sorted (owner, D104).
// Default (when the page opens, and whenever `sort` is null): mentions, most first.

// The sort the page starts with.
export const DEFAULT_SORT = { column: 'mentions', direction: 'desc' };

// The columns that can be sorted, and the direction of their first click.
export const FIRST_DIRECTION = { name: 'asc', status: 'desc', mentions: 'desc' };

// Compares two names A-Z, ignoring upper/lower case.
function byName(a, b) {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
}

// The value a column sorts by (only for 'status' and 'mentions').
function sortValue(company, column) {
  if (column === 'status') return company.lastMentionAt ? Date.parse(company.lastMentionAt) : null;
  return company.mentionCount;
}

// True when the company has no mention in the window (the api sends 0 mentions and no
// lastMentionAt for it, status 'no_coverage').
function hasNoCoverage(company) {
  return !company.mentionCount;
}

// Returns a new array of the companies in the order of `chosenSort` (null = the default).
export function sortCompanies(companies, chosenSort = null) {
  const sort = chosenSort ?? DEFAULT_SORT;
  const sign = sort.direction === 'asc' ? 1 : -1;
  if (sort.column === 'name') {
    return [...companies].sort((a, b) => sign * byName(a, b));
  }
  return [...companies].sort((a, b) => {
    const aNone = hasNoCoverage(a);
    const bNone = hasNoCoverage(b);
    if (aNone !== bNone) return aNone ? 1 : -1; // no coverage always last
    if (aNone) return byName(a, b);
    return (sign * (sortValue(a, sort.column) - sortValue(b, sort.column))) || byName(a, b);
  });
}

// sortCompanies.js — the order of the company table (owner: Prompt 265, D101; D104; the sort
// choices: Prompts 317-322, D110; the Sort icon menu, Prompt 331).
//
// Where it sits: used by App.jsx (inside useMemo, over the loaded list; the filters are applied
// after it). The chosen sort comes from the Sort menu above the table (SORT_OPTIONS).
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

// The choices of the Sort menu (D110, Prompt 331): the headers are no longer clickable. The first one
// is the default.
// Choosing the current one again reverses it (owner, Prompt 335): `reverseLabel` names the
// reversed order.
export const SORT_OPTIONS = [
  { value: 'mentions', label: 'Most mentions', reverseLabel: 'Fewest mentions', sort: DEFAULT_SORT },
  { value: 'lastMentioned', label: 'Last mentioned (newest)', reverseLabel: 'Last mentioned (oldest)', sort: { column: 'status', direction: 'desc' } },
  { value: 'name', label: 'Company A–Z', reverseLabel: 'Company Z–A', sort: { column: 'name', direction: 'asc' } },
];

// The choice the page starts with: { value, reversed }.
export const DEFAULT_SORT_CHOICE = { value: SORT_OPTIONS[0].value, reversed: false };

// The next choice after a click on `value` in the Sort menu: the same one again flips its
// direction; another one starts in its normal direction.
export function nextSortChoice(current, value) {
  if (current?.value === value) return { value, reversed: !current.reversed };
  return { value, reversed: false };
}

// The name of a choice, in its direction ("Company Z–A" when reversed).
export function sortChoiceLabel(choice) {
  const option = SORT_OPTIONS.find((o) => o.value === choice?.value) ?? SORT_OPTIONS[0];
  return choice?.reversed ? option.reverseLabel : option.label;
}

// True when the choice is the page's default (Most mentions, not reversed).
export function isDefaultSortChoice(choice) {
  return choice?.value === DEFAULT_SORT_CHOICE.value && !choice?.reversed;
}

// The sort ({ column, direction }) of a choice, reversed when asked.
export function sortForChoice(choice) {
  const sort = sortForOption(choice?.value);
  if (!choice?.reversed) return sort;
  return { column: sort.column, direction: sort.direction === 'asc' ? 'desc' : 'asc' };
}

// The sort of a Sort menu choice (an unknown value gives the default).
export function sortForOption(value) {
  return SORT_OPTIONS.find((option) => option.value === value)?.sort ?? DEFAULT_SORT;
}

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

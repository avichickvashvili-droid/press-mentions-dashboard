// companyFilters.js — the filter of the company table: All / Mentioned this week /
// Mentioned / No coverage (owner, Prompts 317-318, D110; an icon menu since Prompt 331).
//
// Where it sits: used by App.jsx (after the sort and the search) and the Filter menu in TableControls.
// Reads/writes: nothing.
//
//   'all'       every company
//   'thisWeek'  at least one mention in the last 7 days (weekCount > 0, from the api)
//   'mentioned' at least one mention in the 90-day window
//   'none'      no mention in the 90-day window ("no coverage")

export const COMPANY_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'thisWeek', label: 'Mentioned this week' },
  { value: 'mentioned', label: 'Mentioned' },
  { value: 'none', label: 'No coverage' },
];

// True when `company` belongs to the filter `value` (an unknown value keeps every company).
export function matchesCompanyFilter(company, value) {
  if (value === 'thisWeek') return (company.weekCount ?? 0) > 0;
  if (value === 'mentioned') return (company.mentionCount ?? 0) > 0;
  if (value === 'none') return !company.mentionCount;
  return true;
}

// The companies of one filter, in the order they came in.
export function applyCompanyFilter(companies, value) {
  if (value === 'all') return companies;
  return companies.filter((company) => matchesCompanyFilter(company, value));
}

// How many companies each choice would show: { all, thisWeek, mentioned, none }.
export function countCompanyFilters(companies) {
  const counts = {};
  for (const { value } of COMPANY_FILTERS) counts[value] = companies.filter((company) => matchesCompanyFilter(company, value)).length;
  return counts;
}

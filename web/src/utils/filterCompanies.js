// filterCompanies.js — the company search of the table (owner, Prompt 273, D103): keeps the
// companies whose NAME contains the search text, ignoring upper/lower case and spaces at the
// start or end. An empty search keeps every company.
//
// Where it sits: used by App.jsx (inside useMemo, after sortCompanies, so the order stays
// "most mentions first"). Client-side only: the api is not asked.
// Reads/writes: nothing.

// Returns the companies that match `searchText`, in the order they came in (a new array).
export function filterCompanies(companies, searchText) {
  const wanted = (searchText ?? '').trim().toLowerCase();
  if (wanted === '') return companies;
  return companies.filter((company) => company.name.toLowerCase().includes(wanted));
}

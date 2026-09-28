// sortCompanies.js — the order of the company table (owner, Prompt 265, D101).
//
// Where it sits: used by App.jsx (inside useMemo, over the loaded list).
// Reads/writes: nothing.
//
// Most mentions first (mentionCount, high to low); companies with the same count by name A-Z
// (ignoring upper/lower case). Companies with no coverage have 0 mentions, so they come last.
// There is no click-sorting: this one function decides the order.

// Returns a new array of the companies in table order.
export function sortCompanies(companies) {
  return [...companies].sort((a, b) =>
    (b.mentionCount - a.mentionCount) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

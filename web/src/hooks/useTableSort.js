// useTableSort.js — which column the company table is sorted by, changed by a click on a header
// (owner, Prompt 282, D104).
//
// Where it sits: used by App.jsx; the sorting itself is src/utils/sortCompanies.js.
// Reads/writes: nothing (React state). The state lives in App, not in the data, so a reload of
// the data keeps the chosen sort.
//
// The state starts as null = "the user has not sorted yet": the table then shows the default
// order (DEFAULT_SORT) but no header is marked (owner, Prompt 285). The first click on any column,
// Mentions too, starts it with its first direction (Company A-Z, Status most recent first,
// Mentions most first); a click on the active column reverses it. Only a full page reload goes
// back to null.

import { useState } from 'react';
import { FIRST_DIRECTION } from '../utils/sortCompanies.js';

// Returns { sort, sortBy(column) }; `sort` is null until the first click.
export function useTableSort() {
  const [sort, setSort] = useState(null);

  // Handles a click on a column header.
  const sortBy = (column) => setSort((current) => (current?.column === column
    ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { column, direction: FIRST_DIRECTION[column] }));

  return { sort, sortBy };
}

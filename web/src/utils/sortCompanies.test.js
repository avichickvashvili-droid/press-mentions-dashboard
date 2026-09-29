// sortCompanies.test.js — the table order (D101, D104): each sortable column in both directions,
// no-coverage companies at the bottom (except for Company), ties by name A-Z, and the default.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, sortCompanies } from './sortCompanies.js';

// A company with `mentionCount` mentions, the latest one on `last` (a date), or no coverage.
function company(name, mentionCount, last = null) {
  return { name, mentionCount, lastMentionAt: last, status: mentionCount > 0 ? 'mentioned' : 'no_coverage' };
}

const COMPANIES = [
  company('zeta', 0),
  company('Beta', 5, '2026-09-20T10:00:00.000Z'),
  company('alpha', 5, '2026-09-27T08:00:00.000Z'),
  company('Ukko', 0),
  company('Anthropic', 3212, '2026-09-27T08:00:00.000Z'),
  company('Old', 1, '2026-07-01T10:00:00.000Z'),
];
const order = (sort) => sortCompanies(COMPANIES, sort).map((entry) => entry.name);

describe('sortCompanies', () => {
  it('default = Mentions, most first; ties by name A-Z; no coverage last; the input is not changed', () => {
    expect(DEFAULT_SORT).toEqual({ column: 'mentions', direction: 'desc' });
    expect(order()).toEqual(['Anthropic', 'alpha', 'Beta', 'Old', 'Ukko', 'zeta']);
    expect(order(null)).toEqual(order(DEFAULT_SORT), 'null (no user sort) = the default order');
    expect(COMPANIES[0].name).toBe('zeta');
  });

  it('Mentions, fewest first: no coverage still at the bottom', () => {
    expect(order({ column: 'mentions', direction: 'asc' })).toEqual(['Old', 'alpha', 'Beta', 'Anthropic', 'Ukko', 'zeta']);
  });

  it('Status: most recent first / furthest first, ties by name, no coverage at the bottom', () => {
    expect(order({ column: 'status', direction: 'desc' })).toEqual(['alpha', 'Anthropic', 'Beta', 'Old', 'Ukko', 'zeta']);
    expect(order({ column: 'status', direction: 'asc' })).toEqual(['Old', 'Beta', 'alpha', 'Anthropic', 'Ukko', 'zeta']);
  });

  it('Company: A-Z / Z-A in any case, no-coverage companies sorted by name like the rest', () => {
    expect(order({ column: 'name', direction: 'asc' })).toEqual(['alpha', 'Anthropic', 'Beta', 'Old', 'Ukko', 'zeta']);
    expect(order({ column: 'name', direction: 'desc' })).toEqual(['zeta', 'Ukko', 'Old', 'Beta', 'Anthropic', 'alpha']);
  });
});

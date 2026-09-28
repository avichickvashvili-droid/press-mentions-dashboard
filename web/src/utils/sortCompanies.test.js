// sortCompanies.test.js — the table order: most mentions first, ties by name A-Z, no coverage last.

import { describe, expect, it } from 'vitest';
import { sortCompanies } from './sortCompanies.js';

describe('sortCompanies', () => {
  it('most mentions first, the same count by name A-Z, no coverage last; the input is not changed', () => {
    const companies = [
      { name: 'zeta', mentionCount: 0 },
      { name: 'Beta', mentionCount: 5 },
      { name: 'alpha', mentionCount: 5 },
      { name: 'Ukko', mentionCount: 0 },
      { name: 'Anthropic', mentionCount: 3212 },
    ];
    expect(sortCompanies(companies).map((company) => company.name)).toEqual(['Anthropic', 'alpha', 'Beta', 'Ukko', 'zeta']);
    expect(companies[0].name).toBe('zeta');
  });
});

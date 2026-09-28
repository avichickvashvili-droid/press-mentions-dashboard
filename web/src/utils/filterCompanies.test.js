// filterCompanies.test.js — the company search: name only, contains, any case, spaces ignored,
// empty = everything, the order is kept.

import { describe, expect, it } from 'vitest';
import { filterCompanies } from './filterCompanies.js';

const COMPANIES = [
  { name: 'Anthropic', hint: 'Lambda hint' },
  { name: 'Lambda' },
  { name: 'Klook' },
  { name: 'Alamo' },
];
const names = (list) => list.map((company) => company.name);

describe('filterCompanies', () => {
  it('"contains" on the name, in any case', () => {
    expect(names(filterCompanies(COMPANIES, 'lam'))).toEqual(['Lambda', 'Alamo']);
    expect(names(filterCompanies(COMPANIES, 'LAMB'))).toEqual(['Lambda']);
    expect(names(filterCompanies(COMPANIES, 'ook'))).toEqual(['Klook']);
  });

  it('only the name is searched (not the hint or other fields)', () => {
    expect(names(filterCompanies(COMPANIES, 'hint'))).toEqual([]);
  });

  it('spaces at the start or end are ignored; empty or only spaces = every company, same order', () => {
    expect(names(filterCompanies(COMPANIES, '  klo  '))).toEqual(['Klook']);
    expect(filterCompanies(COMPANIES, '')).toEqual(COMPANIES);
    expect(filterCompanies(COMPANIES, '   ')).toEqual(COMPANIES);
    expect(filterCompanies(COMPANIES, undefined)).toEqual(COMPANIES);
  });

  it('no match: an empty list', () => {
    expect(filterCompanies(COMPANIES, 'xyz')).toEqual([]);
  });
});

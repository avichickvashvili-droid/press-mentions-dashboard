// useSelectedCompany.test.jsx — the open company lives in the address (?company=<id>, D109):
// read when the page opens, written on every click, other address parts kept.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { addressWithCompany, readCompanyFromSearch, useSelectedCompany } from './useSelectedCompany.js';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('readCompanyFromSearch', () => {
  it('reads the id, and null when missing or empty', () => {
    expect(readCompanyFromSearch('?company=spacex')).toBe('spacex');
    expect(readCompanyFromSearch('?company=a%20b')).toBe('a b');
    expect(readCompanyFromSearch('')).toBeNull();
    expect(readCompanyFromSearch('?company=')).toBeNull();
    expect(readCompanyFromSearch('?company=%20')).toBeNull();
  });
});

describe('addressWithCompany', () => {
  it('sets, replaces and removes the company, keeping the rest', () => {
    expect(addressWithCompany('http://localhost:3000/', 'spacex')).toBe('/?company=spacex');
    expect(addressWithCompany('http://localhost:3000/?company=old&x=1#top', 'new')).toBe('/?company=new&x=1#top');
    expect(addressWithCompany('http://localhost:3000/?company=old&x=1', null)).toBe('/?x=1');
  });
});

describe('useSelectedCompany', () => {
  it('starts from the address, and writes each choice into it', () => {
    window.history.replaceState(null, '', '/?company=anthropic');
    const { result } = renderHook(() => useSelectedCompany());
    expect(result.current[0]).toBe('anthropic');
    act(() => result.current[1]('spacex'));
    expect(result.current[0]).toBe('spacex');
    expect(window.location.search).toBe('?company=spacex');
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('starts with nothing open when the address has no company', () => {
    const { result } = renderHook(() => useSelectedCompany());
    expect(result.current[0]).toBeNull();
  });
});

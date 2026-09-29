// pageAndTheme.test.jsx — the page in the address (usePage, D117: Overview by default,
// ?page=companies, Back returns) and the theme (useTheme: dark by default, the switch is
// remembered, and a blocked storage still works).

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressForPage, readPageFromSearch, usePage } from './usePage.js';
import { applyStoredTheme, readStoredTheme, THEME_KEY, useTheme } from './useTheme.js';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('usePage', () => {
  it('reads and writes the page in the address; anything unknown is the Overview', () => {
    expect(readPageFromSearch('')).toBe('overview');
    expect(readPageFromSearch('?page=companies')).toBe('companies');
    expect(readPageFromSearch('?page=nonsense')).toBe('overview');
    expect(readPageFromSearch('?company=anthropic')).toBe('companies', 'an old company link opens Companies (Prompt 365)');
    expect(readPageFromSearch('?page=overview&company=anthropic')).toBe('overview');
    expect(addressForPage('http://x/?page=companies&company=a', 'overview', { company: null })).toBe('/');
    expect(addressForPage('http://x/', 'companies', { company: 'spacex' })).toBe('/?page=companies&company=spacex');
  });

  it('goTo changes the page and the address; Back returns', () => {
    window.scrollTo = vi.fn();
    const { result } = renderHook(() => usePage());
    expect(result.current[0]).toBe('overview');
    act(() => result.current[1]('companies', { company: 'spacex' }));
    expect(result.current[0]).toBe('companies');
    expect(window.location.search).toBe('?page=companies&company=spacex');
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toBe('overview');
  });
});

describe('useTheme', () => {
  it('dark by default; the switch changes <html data-theme> and is remembered', () => {
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('dark');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light');
    expect(readStoredTheme()).toBe('light');
  });

  it('a blocked browser storage: still dark, and the switch still works', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readStoredTheme()).toBe('dark');
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]());
    expect(document.documentElement.dataset.theme).toBe('light');
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

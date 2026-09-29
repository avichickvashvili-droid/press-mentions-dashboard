// usePagination.test.jsx — splitting a loaded list into pages (D101): the slice of each page,
// staying between the first and the last page, back to page 1 for another company, and a page
// past the end (after the list got shorter) becoming the last page.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePagination } from './usePagination.js';

// A list of the numbers 1..count.
const numbers = (count) => Array.from({ length: count }, (_, index) => index + 1);

describe('usePagination', () => {
  it('slices the list into pages and stays between the first and the last page', () => {
    const items = numbers(45);
    const { result } = renderHook(() => usePagination(items, 20, 'harvey'));
    expect(result.current.page).toBe(1);
    expect(result.current.pageCount).toBe(3);
    expect(result.current.pageItems).toEqual(numbers(20));

    act(() => result.current.goToPage(3));
    expect(result.current.pageItems).toEqual([41, 42, 43, 44, 45]);
    act(() => result.current.goToPage(99));
    expect(result.current.page).toBe(3);
    act(() => result.current.goToPage(0));
    expect(result.current.page).toBe(1);
  });

  it('nothing loaded yet: one empty page', () => {
    const { result } = renderHook(() => usePagination(undefined, 20, null));
    expect(result.current).toMatchObject({ page: 1, pageCount: 1, pageItems: [] });
  });

  it('goes back to page 1 when another company is selected', () => {
    const items = numbers(100);
    const { result, rerender } = renderHook(({ key }) => usePagination(items, 20, key), { initialProps: { key: 'harvey' } });
    act(() => result.current.goToPage(4));
    expect(result.current.page).toBe(4);
    rerender({ key: 'anthropic' });
    expect(result.current.page).toBe(1);
    expect(result.current.pageItems[0]).toBe(1);
  });

  it('a list that got shorter: a page past the end becomes the last page (never empty)', () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items, 20, 'harvey'), { initialProps: { items: numbers(100) } });
    act(() => result.current.goToPage(5));
    rerender({ items: numbers(30) });
    expect(result.current.page).toBe(2);
    expect(result.current.pageItems).toEqual(numbers(30).slice(20));
  });
});

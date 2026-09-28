// useTableSort.test.jsx — a click on the active column reverses it; a click on another column
// switches to it with its first direction (D104).

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTableSort } from './useTableSort.js';

describe('useTableSort', () => {
  it('starts with no user sort; the first click on Mentions starts most first; toggles; other columns start with their first direction', () => {
    const { result } = renderHook(() => useTableSort());
    expect(result.current.sort).toBeNull();
    act(() => result.current.sortBy('mentions'));
    expect(result.current.sort).toEqual({ column: 'mentions', direction: 'desc' });
    act(() => result.current.sortBy('mentions'));
    expect(result.current.sort).toEqual({ column: 'mentions', direction: 'asc' });
    act(() => result.current.sortBy('name'));
    expect(result.current.sort).toEqual({ column: 'name', direction: 'asc' });
    act(() => result.current.sortBy('name'));
    expect(result.current.sort).toEqual({ column: 'name', direction: 'desc' });
    act(() => result.current.sortBy('status'));
    expect(result.current.sort).toEqual({ column: 'status', direction: 'desc' });
  });
});

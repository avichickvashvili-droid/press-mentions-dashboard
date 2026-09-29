// useToday.test.jsx — today's date changes by itself just after midnight (UTC), and the timer is
// removed when the component goes away (D100). Fake timers, no waiting.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { msUntilNextMidnightUtc, todayUtc, useToday } from './useToday.js';

describe('useToday', () => {
  it('gives today in UTC and the time to the next UTC midnight', () => {
    const now = new Date('2026-09-27T23:59:00.000Z');
    expect(todayUtc(now)).toBe('2026-09-27');
    expect(msUntilNextMidnightUtc(now)).toBe(60 * 1000);
  });

  it('flips to the new date just after midnight, and again the next midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T23:59:00.000Z'));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-09-27');

    act(() => { vi.advanceTimersByTime(59 * 1000); });
    expect(result.current).toBe('2026-09-27');
    act(() => { vi.advanceTimersByTime(2 * 1000); });
    expect(result.current).toBe('2026-09-28');

    act(() => { vi.advanceTimersByTime(24 * 60 * 60 * 1000); });
    expect(result.current).toBe('2026-09-29');
  });

  it('keeps only one timer and removes it on unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    const { unmount } = renderHook(() => useToday());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

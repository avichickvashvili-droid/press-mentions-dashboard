// useTheme.js — dark or light (owner, Prompt 364, D117): the page opens dark; the sun / moon
// button in the sidebar switches, and the choice is remembered in this browser.
//
// Where it sits: used by the Sidebar's theme button; applyStoredTheme() runs once in main.jsx
// before the first paint, so the page never flashes light first.
// Reads/writes: <html data-theme="dark|light"> and localStorage 'pm-theme'. The browser storage is
// only a convenience: when it is blocked (a private window) the page still works, it just opens
// dark every time.

import { useCallback, useState } from 'react';

export const THEME_KEY = 'pm-theme';
export const DEFAULT_THEME = 'dark';

// The remembered theme, or the default when there is none (or the storage can't be read).
export function readStoredTheme() {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// Puts the theme on <html>, where the colour variables of styles/global.css read it.
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

// Once at start: applies the remembered theme.
export function applyStoredTheme() {
  applyTheme(readStoredTheme());
}

// Returns [theme, toggle()].
export function useTheme() {
  const [theme, setTheme] = useState(readStoredTheme);
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // not remembered; the switch still works for this visit
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

// setup.js — prepares every page test (Vitest): adds the Testing Library matchers
// (e.g. toBeInTheDocument) and cleans the drawn page and any fake fetch after each test.
//
// Where it sits: listed in web/vite.config.js (test.setupFiles).

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

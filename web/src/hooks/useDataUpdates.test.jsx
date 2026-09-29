// useDataUpdates.test.jsx — the page reloads its data when the daily job has added new data
// (D100, D106): the "data-updated" event reloads the list AND the open mentions (one invalidate),
// a reconnect after a drop reloads once, a connection the browser gave up on (CLOSED after an HTTP
// error) is opened again after a wait, and the connection is closed when the page goes away.
// The browser's EventSource and the fetch are fakes.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCompanies } from './useCompanies.js';
import { useCompanyMentions } from './useCompanyMentions.js';
import { DATA_UPDATED_EVENT, EVENTS_URL, RECONNECT_AFTER_MS, useDataUpdates } from './useDataUpdates.js';
import { COMPANIES_ANSWER, HARVEY_MENTIONS, jsonResponse, makeQueryWrapper, stubFetch } from '../test/testTools.jsx';

// A fake EventSource: remembers every one created, and lets the test fire its events.
class FakeEventSource {
  static created = [];

  constructor(url) {
    this.url = url;
    this.closed = false;
    this.readyState = 0; // CONNECTING
    this.listeners = {};
    FakeEventSource.created.push(this);
  }

  addEventListener(name, listener) {
    (this.listeners[name] ??= []).push(listener);
  }

  close() {
    this.closed = true;
    this.readyState = 2; // CLOSED
  }

  // Fires an event, like the browser does when the server sends it.
  fire(name) {
    for (const listener of this.listeners[name] ?? []) listener({ type: name });
  }
}

// The page's data hooks plus the live updates, with a fake api and a fake EventSource.
async function renderPage() {
  FakeEventSource.created = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  const fetchMock = stubFetch((url) => (url.includes('/mentions') ? jsonResponse(HARVEY_MENTIONS) : jsonResponse(COMPANIES_ANSWER)));
  const { wrapper } = makeQueryWrapper();
  const view = renderHook(() => {
    useDataUpdates();
    return { list: useCompanies(), mentions: useCompanyMentions('harvey') };
  }, { wrapper });
  await waitFor(() => expect(view.result.current.list.isSuccess && view.result.current.mentions.isSuccess).toBe(true));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  return { ...view, fetchMock, source: FakeEventSource.created[0] };
}

describe('useDataUpdates', () => {
  it('listens on /api/events', async () => {
    const { source } = await renderPage();
    expect(FakeEventSource.created).toHaveLength(1);
    expect(source.url).toBe(EVENTS_URL);
  });

  it('"data-updated" reloads the company list and the open mentions', async () => {
    const { source, fetchMock } = await renderPage();
    act(() => source.fire(DATA_UPDATED_EVENT));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const urls = fetchMock.mock.calls.slice(2).map(([url]) => url).sort();
    expect(urls).toEqual(['/api/companies', '/api/companies/harvey/mentions']);
  });

  it('the first connect does not reload; a reconnect after a drop reloads once', async () => {
    const { source, fetchMock } = await renderPage();
    act(() => source.fire('open'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    act(() => { source.fire('error'); source.fire('open'); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it('a connection the browser gave up on (CLOSED) is opened again after a wait, and reloads once', async () => {
    const { source, fetchMock, unmount } = await renderPage();
    vi.useFakeTimers();
    try {
      act(() => { source.readyState = 2; source.fire('error'); }); // e.g. 502 from the dev proxy
      expect(FakeEventSource.created).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(RECONNECT_AFTER_MS); });
      expect(FakeEventSource.created).toHaveLength(2);
      const second = FakeEventSource.created[1];
      expect(second.url).toBe(EVENTS_URL);
      act(() => second.fire('open'));
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4)); // reloaded once
    unmount();
    expect(FakeEventSource.created[1].closed).toBe(true);
  });

  it('a planned reconnect is dropped when the page goes away', async () => {
    const { source, unmount } = await renderPage();
    vi.useFakeTimers();
    try {
      act(() => { source.readyState = 2; source.fire('error'); });
      unmount();
      act(() => { vi.advanceTimersByTime(RECONNECT_AFTER_MS * 2); });
      expect(FakeEventSource.created).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a normal drop (the browser retries by itself) opens no second connection', async () => {
    const { source } = await renderPage();
    vi.useFakeTimers();
    try {
      act(() => { source.readyState = 0; source.fire('error'); });
      act(() => { vi.advanceTimersByTime(RECONNECT_AFTER_MS * 2); });
      expect(FakeEventSource.created).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the connection when the page goes away', async () => {
    const { source, unmount } = await renderPage();
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it('a browser without EventSource simply has no live updates (no error)', async () => {
    vi.stubGlobal('EventSource', undefined);
    const { wrapper } = makeQueryWrapper();
    expect(() => renderHook(() => useDataUpdates(), { wrapper })).not.toThrow();
  });
});

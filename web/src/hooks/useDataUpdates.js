// useDataUpdates.js — reloads the page's data when the daily job has added new data (D100, D106).
//
// Where it sits: used once, in App.jsx. The daily job tells the api "new data"; the api sends the
// event "data-updated" to every open page over GET /api/events (Server-Sent Events). This hook
// listens and runs ONE invalidate of every query whose key starts with 'companies': the company
// list AND the open company's mentions reload. The server works out the 90-day window again on
// that reload, so the new mentions appear and anything older than 90 days drops out (D13).
// Reads: the api's live-updates channel. Writes: the TanStack Query cache (marks it out of date).
//
// The browser's EventSource connects again by itself when the connection drops (e.g. the api was
// restarted). But after an HTTP error answer (e.g. 502 from the dev proxy while the api is down)
// it gives up for good (readyState CLOSED): then this hook opens a new one after
// RECONNECT_AFTER_MS. A signal sent while the page was disconnected would be missed, so after
// every reconnect the data is reloaded once too. The connection (and a planned reconnect) is
// closed when the page goes away.
// A browser without EventSource simply has no live updates (Refresh and tab focus still work).

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { COMPANIES_KEY } from './useCompanies.js';

// The address of the api's live-updates channel.
export const EVENTS_URL = '/api/events';

// The event the api sends when the daily job has added new data.
export const DATA_UPDATED_EVENT = 'data-updated';

// How long to wait before opening a new connection after the browser gave up on the old one
// (the same 5 s the api asks the browser to wait, EVENTS_RECONNECT_MS in src/config.js).
export const RECONNECT_AFTER_MS = 5000;

// EventSource.readyState when the browser has given up on the connection for good.
const CLOSED = 2;

// Listens for "data-updated" and reloads the data. Returns nothing.
export function useDataUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const reload = () => queryClient.invalidateQueries({ queryKey: [COMPANIES_KEY] });
    let source = null;
    let reconnectTimer = null;
    let lostConnection = false;
    let gone = false; // the page went away: open nothing new

    // Opens the connection and listens on it.
    const connect = () => {
      source = new EventSource(EVENTS_URL);
      source.addEventListener(DATA_UPDATED_EVENT, reload);
      source.addEventListener('error', () => {
        lostConnection = true;
        if (source.readyState !== CLOSED || gone || reconnectTimer !== null) return;
        reconnectTimer = setTimeout(() => { // the browser gave up: open a new one later
          reconnectTimer = null;
          if (!gone) connect();
        }, RECONNECT_AFTER_MS);
      });
      source.addEventListener('open', () => {
        if (lostConnection) reload(); // back after a drop: a signal may have been missed
        lostConnection = false;
      });
    };
    connect();

    return () => {
      gone = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      source.close();
    };
  }, [queryClient]);
}

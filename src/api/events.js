// events.js — the api's live-updates channel to the open dashboard pages (D106).
//
// Where it sits: created once by src/api/app.js. Each open page keeps one connection open to
// GET /api/events (Server-Sent Events: a normal HTTP answer that never ends, where the server
// writes a short text block whenever it has news). When the daily job sends
// POST /api/internal/data-updated, the api calls broadcast('data-updated') and every page gets it;
// the page's useDataUpdates() hook then reloads its data (invalidateQueries, D100).
// Reads/writes: nothing (memory only: the list of open connections).
//
// A small comment line (": keep-alive") is written every EVENTS_KEEP_ALIVE_MS, so a connection is
// never closed for being idle. A connection that fails to write, or is closed by the page, is
// simply removed. The timer does not keep the process alive on its own.

import { config } from '../config.js';

// Creates the channel. Returns:
//   open(req, res)   answers GET /api/events: keeps the connection open and remembers it
//   broadcast(name)  sends the event `name` to every open page; returns how many got it
//   count()          how many pages are connected
//   closeAll()       ends every connection and stops the timer (when the server stops)
export function createEventHub({
  keepAliveMs = config.EVENTS_KEEP_ALIVE_MS,
  reconnectMs = config.EVENTS_RECONNECT_MS,
} = {}) {
  const clients = new Set();
  let timer = null;

  // Writes text to one connection; a connection that can't be written is dropped.
  function writeTo(res, text) {
    try {
      res.write(text);
      return true;
    } catch {
      clients.delete(res);
      return false;
    }
  }

  // Starts the keep-alive timer while at least one page is connected.
  function startTimer() {
    if (timer !== null) return;
    timer = setInterval(() => {
      for (const res of [...clients]) writeTo(res, ': keep-alive\n\n');
    }, keepAliveMs);
    timer.unref?.();
  }

  // Stops the timer when no page is connected.
  function stopTimerIfIdle() {
    if (clients.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function open(req, res) {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    // `retry` = how long the browser waits before connecting again after a drop.
    res.write(`retry: ${reconnectMs}\n: connected\n\n`);
    clients.add(res);
    startTimer();
    const forget = () => {
      clients.delete(res);
      stopTimerIfIdle();
    };
    req.on('close', forget);
    res.on('error', forget);
  }

  function broadcast(name) {
    let reached = 0;
    for (const res of [...clients]) {
      if (writeTo(res, `event: ${name}\ndata: {}\n\n`)) reached += 1;
    }
    stopTimerIfIdle();
    return reached;
  }

  function closeAll() {
    for (const res of [...clients]) {
      try { res.end(); } catch { /* already closed */ }
    }
    clients.clear();
    stopTimerIfIdle();
  }

  return { open, broadcast, count: () => clients.size, closeAll };
}

// The header the daily job sends with its "new data" signal (POST /api/internal/data-updated).
// A web page on another site can't add a custom header to a request to our api (the browser would
// have to ask first, and the api never allows it), so only a program like the daily job can.
export const DAILY_JOB_HEADER = Object.freeze({ name: 'X-Press-Mentions', value: 'daily-job' });

// True when a request comes from this computer (127.0.0.1 or ::1, also written as ::ffff:127.0.0.1).
export function isLocalRequest(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

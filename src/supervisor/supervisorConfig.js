// supervisorConfig.js — every setting of the orchestrator (the supervisor behind `npm start`).
//
// Where it sits: read by supervisor.js. Kept apart from src/config.js (the collector's file) so
// the orchestrator does not edit another component's file. The values are fixed here on
// purpose; they are not read from .env (D69).
// Reads/writes: nothing.
//
// To change how restarts behave, change a value here. Each value says what it controls.

export const supervisorConfig = {
  // Waits before restarting a crashed service: 1 s, 2 s, 5 s, 10 s, 30 s, 60 s,
  // then every 60 s (D69). The wait grows so a broken service doesn't restart in a tight loop.
  RESTART_BACKOFF_MS: [1000, 2000, 5000, 10000, 30000, 60000],

  // A service that stayed up this long before crashing starts again from the first (shortest)
  // wait: 5 minutes. A crash after a long healthy run is treated as a fresh, one-off crash.
  STABLE_UPTIME_MS: 5 * 60 * 1000,

  // Give up on a service after MORE than this many crashes inside CRASH_WINDOW_MS (D69, I18):
  // the 6th crash within 10 minutes stops the restarts for that service only.
  MAX_CRASHES: 5,
  CRASH_WINDOW_MS: 10 * 60 * 1000,

  // When a service ends with the Ctrl+C / stop code (130 / 143), wait this long before deciding
  // what it means. On Ctrl+C, Windows (and a terminal) tells every process at the same time, so a
  // service can end a moment before the orchestrator hears its own Ctrl+C. Waiting briefly
  // avoids a wrong "crashed, restarting" line during a normal stop.
  STOP_SIGNAL_GRACE_MS: 1000,

  // On Ctrl+C / stop, each service is asked to stop cleanly (it writes its emergency heartbeat,
  // D48a, D70). A service still running after this long is force-killed as a last resort: 10 s.
  STOP_TIMEOUT_MS: 10000,

  // How many of a service's last error lines are shown when the orchestrator gives up on it.
  ERROR_LINES_KEPT: 5,
};

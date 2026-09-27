// serviceLink.js — the small piece each service calls at start-up so the orchestrator can stop
// it cleanly (D70, D48a).
//
// Where it sits: called once at the top of each service's entry file
// (src/collector/runCollect.js, src/classifier/runClassifier.js, later the api):
//     connectToSupervisor();
// When the service runs alone (`npm run collect`), there is no orchestrator and this does nothing.
// Reads: messages from the orchestrator over the private channel Node opens between the two.
// Writes: nothing itself; it triggers the service's own stop handler.
//
// Why it is needed: on Windows the orchestrator cannot send a "please stop" signal to one
// process — killing it is a hard kill, and a hard kill can't write anything. So the orchestrator
// sends the message { type: 'stop' } instead, and this helper turns it into the service's normal
// SIGTERM stop. The service's SIGTERM handler writes the emergency heartbeat (crashed_at,
// last_error, owner_pid = NULL) and exits with code 143.
//
// It also stops the service if the orchestrator itself dies (the channel "disconnects"), so no
// service is left running on its own (no orphans, Q5).
//
// Exit codes involved: 143 = stopped on request (see exitCodes.js for the full table).

import { EXIT_CODES } from './exitCodes.js';

// Connects the service to the orchestrator, if it was started by one.
// Returns true when connected, false when the service runs alone.
export function connectToSupervisor({ proc = process } = {}) {
  if (typeof proc.send !== 'function' || !proc.connected) return false;

  let stopRequested = false;

  // Runs the service's own stop (its SIGTERM handler writes the emergency heartbeat and exits).
  // If the service has no stop handler yet (e.g. before it took its lock, so there is nothing to
  // release), it simply exits with the stop-request code.
  function stopService() {
    if (stopRequested) return;
    stopRequested = true;
    if (proc.listenerCount('SIGTERM') > 0) {
      proc.emit('SIGTERM', 'SIGTERM');
    } else {
      proc.exit(EXIT_CODES.STOPPED_BY_REQUEST);
    }
  }

  proc.on('message', (message) => {
    if (message && message.type === 'stop') stopService();
  });
  proc.on('disconnect', stopService); // the orchestrator is gone

  // The channel must not keep the service running by itself: a one-shot job like the collector
  // has to be able to finish and exit normally. (Listening for messages turns the "keep running"
  // mark on, so it is turned off after the listeners are added.)
  try {
    proc.channel?.unref();
  } catch {
    // older runtimes without unref: the service still works, it just relies on its own work
  }
  return true;
}

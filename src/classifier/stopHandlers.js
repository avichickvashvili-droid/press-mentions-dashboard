// stopHandlers.js — the classifier's last clean-up when it is stopped or crashes (D48a, D68).
//
// Where it sits: installed once by runClassifier.js at start-up.
// Reads/writes: BufferQueue (gives back the articles in progress) and JobRun (the emergency
// heartbeat, only while this process holds a run it is finishing).
//
//   - Ctrl+C (SIGINT, exit 130) or a stop request (SIGTERM / orchestrator message, exit 143):
//     articles in progress go back to the queue and their attempt is undone (they did nothing wrong).
//   - Uncaught error or unhandled promise rejection (exit 1): articles in progress go back to the
//     queue but the attempt still counts (one of them may have caused the crash: poison-article
//     rule, D59). They are marked suspect, so each is asked alone next time (D78), and one that
//     has used all its attempts becomes 'failed' for good (see queueStore.js).
//   - If a run is held: crashed_at, last_error, owner_pid = NULL, so the next start takes it over at once.

import { config } from '../config.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { writeEmergencyHeartbeat } from '../shared/runLock.js';
import { describeError } from '../shared/text.js';
import { giveBackClaims, releaseOwnClaimsAfterCrash } from './queueStore.js';

// Installs the handlers for Ctrl+C, a stop request, an uncaught error and an unhandled promise
// rejection. Each one runs the last clean-up once and exits with the matching code.
export function installStopHandlers({ db, classifier, pid = process.pid, log = console.error, exit = (code) => process.exit(code), proc = process }) {
  let alreadyHandled = false;

  // The last clean-up, then exit. `crashed` = true keeps the attempt counted on the given-back articles.
  function stopWith(reason, exitCode, crashed) {
    if (alreadyHandled) return;
    alreadyHandled = true;
    classifier.stop();
    try {
      const count = crashed ? releaseOwnClaimsAfterCrash(db, { pid }) : giveBackClaims(db, null, { pid });
      if (count) log(`${count} articles in progress were given back to the queue.`);
    } catch (error) {
      log(`Could not give the articles in progress back (${error.message}); they are released after ${config.CLAIM_TIMEOUT_MS / 60000} min.`);
    }
    const heldRunId = classifier.state.heldRunId;
    if (heldRunId !== null) {
      try {
        writeEmergencyHeartbeat(db, heldRunId, reason, { pid });
        log(`Run ${heldRunId} released; the next classifier start finishes it.`);
      } catch (error) {
        log(`The emergency heartbeat could not be written (${error.message}); run ${heldRunId} is taken over once this process is gone.`);
      }
    }
    log(`Classifier stopped: ${reason}.`);
    exit(exitCode);
  }

  const handlers = {
    SIGINT: () => stopWith('stopped by Ctrl+C (SIGINT)', EXIT_CODES.STOPPED_BY_CTRL_C, false),
    SIGTERM: () => stopWith('stopped by SIGTERM', EXIT_CODES.STOPPED_BY_REQUEST, false),
    uncaughtException: (error) => stopWith(`crashed: ${describeError(error)}`, EXIT_CODES.CRASHED, true),
    unhandledRejection: (error) => stopWith(`crashed (unhandled promise): ${describeError(error)}`, EXIT_CODES.CRASHED, true),
  };
  for (const [event, handler] of Object.entries(handlers)) proc.on(event, handler);
  return { handleFatal: handlers.uncaughtException, uninstall: () => { for (const [event, handler] of Object.entries(handlers)) proc.off(event, handler); } };
}

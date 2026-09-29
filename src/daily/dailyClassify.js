// dailyClassify.js — the AI step of a daily run: classifies the new articles and moves the
// relevant ones to Mention (D106).
//
// Where it sits: step 2 of a daily run (dailyJob.js). It runs AT THE SAME TIME as the search
// (dailyCollect.js), in the same process, like the classifier service does next to the collector,
// so the queue can never fill up and block the search. It ends once the search is over and every
// article has an answer.
// It reuses the classifier's own pass (createClassifier in src/classifier/classifierLoop.js), so
// every rule is the same as in the 90-day run: batches, LLM_CONCURRENCY requests at a time (the
// GPU limit), 3 attempts per article, not-relevant articles deleted (D25), relevant ones get a
// sentiment. At the end, every relevant article left is moved to Mention (mover.js); a moved
// mention's alerted_at is empty: it is "new".
// Reads/writes: BufferQueue, Mention (through the classifier and mover.js), Ollama.
//
// Ollama is asked only when there is something to classify, so a quiet day with Ollama off still
// finishes. When Ollama is down, it waits and tries again (2 s, 5 s, 10 s, 30 s, 60 s, then every
// 60 s) and never gives up: "run when possible" (Prompt 272). Any other failed pass is retried
// after its own growing wait; a database error that is not "busy" is thrown on (D76).
// When nothing is left to classify, claims whose process is gone (or that are older than
// CLAIM_TIMEOUT_MS) are given back first (releaseAbandonedClaims), so an article left claimed by
// a crashed or closed program can never make the run wait forever.

import { config } from '../config.js';
import { isDatabaseBusyError, isDatabaseError } from '../db/database.js';
import { giveBackClaims, countQueue, isQueueDrained, releaseAbandonedClaims } from '../classifier/queueStore.js';
import { moveAllRelevantRows } from '../classifier/mover.js';
import { sleep as realSleep } from '../shared/retry.js';
import { isProcessAlive } from '../shared/runLock.js';
import { cleanForLog, describeDuration } from '../shared/text.js';

// True when the queue has articles the AI can take now (waiting, or failed with tries left).
function hasWork(db) {
  const counts = countQueue(db);
  return counts.pending + counts.failedRetry > 0;
}

// Classifies until `isSearchDone()` is true and the queue is drained, then moves every relevant
// article left to Mention. `shouldStop()` ends it early (Ctrl+C).
// `now` / `isAlive` are for the abandoned-claim check (replaced in tests).
// Returns { passes, moved } (moved = mentions added by the final move).
export async function classifyDaily({
  db, classifier, isSearchDone, shouldStop = () => false, sleep = realSleep, pid = process.pid,
  warn = console.warn, pollMs = config.CLASSIFIER_POLL_MS, now = () => Date.now(), isAlive = isProcessAlive,
}) {
  let ollamaReady = false;
  let ollamaWaits = 0;
  let errorWaits = 0;
  let passes = 0;
  const nextWait = (steps, index) => steps[Math.min(index, steps.length - 1)];

  while (!shouldStop()) {
    try {
      if (!hasWork(db)) {
        // A claim left by a program that is gone (crash, closed window) would keep the queue
        // "not drained" for ever, even on a row that has used all its tries: give it back first.
        const released = releaseAbandonedClaims(db, { now: now(), isAlive });
        if (released > 0) {
          warn(`${released} articles were left claimed by a program that stopped; they are given back.`);
          continue;
        }
        if (isSearchDone() && isQueueDrained(db)) break;
        await sleep(pollMs);
        continue;
      }
      if (!ollamaReady) {
        ollamaReady = await classifier.checkOllama();
        if (!ollamaReady) {
          const wait = nextWait(config.OLLAMA_BACKOFF_MS, ollamaWaits++);
          warn(`Ollama is not ready; the new articles wait. Trying again in ${describeDuration(wait)}.`);
          await sleep(wait);
          continue;
        }
        ollamaWaits = 0;
      }
      const pass = await classifier.runOnePass();
      passes += 1;
      errorWaits = 0;
      if (pass.kind === 'ollama-down') {
        ollamaReady = false;
        const wait = nextWait(config.OLLAMA_BACKOFF_MS, ollamaWaits++);
        warn(`${cleanForLog(pass.error?.message ?? 'Ollama is down')}. ${pass.gaveBack} articles given back; trying again in ${describeDuration(wait)}.`);
        await sleep(wait);
      } else if (pass.kind === 'idle') {
        await sleep(pollMs); // the waiting articles are held by another classifier right now
      }
    } catch (error) {
      if (isDatabaseError(error) && !isDatabaseBusyError(error)) throw error; // D76
      try { giveBackClaims(db, null, { pid }); } catch { /* the claim timeout releases them */ }
      const wait = nextWait(config.PASS_ERROR_BACKOFF_MS, errorWaits++);
      warn(`Classifying failed: ${cleanForLog(error?.message ?? error)}. Nothing half-saved; trying again in ${describeDuration(wait)}.`);
      await sleep(wait);
    }
  }

  const { moved } = moveAllRelevantRows(db);
  return { passes, moved };
}

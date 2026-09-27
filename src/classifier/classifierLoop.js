// classifierLoop.js — the classifier's main loop: queue → AI model → delete, or keep for Mention.
//
// Where it sits: the heart of the classifier service (`npm run classifier`, runClassifier.js).
// It runs forever and meets the other services only through the database (D38).
// Reads/writes: BufferQueue, Mention, JobRun (through queueStore.js, mover.js, runFinisher.js),
// Ollama (through ollamaClient.js) and data/ at the end of a run (exporter.js).
//
// One pass of the loop:
//   1. give back claims whose worker is gone (process dead or claim older than 10 min)
//   2. claim a batch of the oldest waiting articles (CLAIM_BATCH = 4 × LLM_CONCURRENCY)
//   3. ask Ollama about them, LLM_CONCURRENCY at a time (one end-to-end question each, D26)
//   4. save the whole batch's answers in one transaction
//   5. when ≥ MOVE_CHUNK relevant rows are waiting, move them to Mention
//   6. when nothing is waiting: if a run is 'collected' and the queue is drained,
//      finish it (leftovers → data/ → 'done')
// Ollama down / slow / HTTP error → the articles are given back unchanged and the loop waits
// 2 s, 5 s, 10 s, 30 s, 60 s, then every 60 s, and never gives up (Q6).
// Any other error in a pass is logged and the pass is retried after a wait (D37): the loop never dies.

import { config } from '../config.js';
import { isProcessAlive } from '../collector/jobLock.js';
import { retryDbWrite, sleep as realSleep } from '../collector/waiting.js';
import { classifierConfig } from './classifierConfig.js';
import { OllamaUnavailableError } from './ollamaClient.js';
import { claimBatch, countQueue, giveBackClaims, isQueueDrained, releaseAbandonedClaims, saveBatchResults } from './queueStore.js';
import { moveFullChunks } from './mover.js';
import { findCollectedRun, finishHeldRun, takeOverRun } from './runFinisher.js';

// Formats a number with thousands separators, e.g. 10000 -> "10,000".
const formatCount = (count) => Number(count).toLocaleString('en-US');

// Creates the classifier. Everything it talks to can be replaced in tests (fake Ollama,
// temp database, instant sleep). Returns functions to run one pass, run forever, and stop.
export function createClassifier({
  db,
  client,
  sectionNames,
  pid = process.pid,
  concurrency = classifierConfig.LLM_CONCURRENCY,
  claimBatchSize = classifierConfig.CLAIM_BATCH,
  moveChunk = config.MOVE_CHUNK,
  dataDir,
  isAlive = isProcessAlive,
  sleep = realSleep,
  now = () => Date.now(),
  log = console.log,
  warn = console.warn,
}) {
  const state = {
    stopping: false,
    ollamaReady: false,     // true after the start-up check passed; false again after an outage
    ollamaRetryIndex: 0,    // position in the OLLAMA_BACKOFF_MS list
    heldRunId: null,        // the JobRun this process holds while finishing it (for the emergency heartbeat)
    articlesDone: 0,        // answered articles since start (for the progress line)
    lastProgressAt: now(),
    articlesAtLastProgress: 0,
    note: 'starting',
  };

  // Builds the article the prompt needs from a claimed queue row.
  function articleFor(row) {
    let sectionName = sectionNames[row.company_section];
    if (!sectionName) {
      sectionName = `Section ${row.company_section}`;
      warn(`No section name for section ${row.company_section} (company ${row.company_name}); using "${sectionName}".`);
    }
    return { companyName: row.company_name, sectionName, title: row.title, publisher: row.publisher };
  }

  // Asks Ollama about every row of a batch, `concurrency` at a time.
  // Returns { results, giveBackIds, ollamaError }: answers to save, rows to give back untouched
  // (Ollama failed or we are stopping), and the Ollama error if there was one.
  async function classifyBatch(rows) {
    const results = [];
    const giveBackIds = [];
    let ollamaError = null;
    let next = 0;

    async function worker() {
      while (next < rows.length) {
        const row = rows[next++];
        if (ollamaError || state.stopping) { giveBackIds.push(row.id); continue; }
        try {
          const answer = await client.classifyArticle(articleFor(row));
          if (answer.ok) {
            results.push({ id: row.id, outcome: answer.relevant ? 'relevant' : 'irrelevant', sentiment: answer.sentiment, attempts: row.attempts });
          } else {
            warn(`Invalid AI answer for "${row.title}" (${row.company_name}), attempt ${row.attempts}/${classifierConfig.MAX_ATTEMPTS}: ${answer.error}.`);
            results.push({ id: row.id, outcome: 'invalid', attempts: row.attempts });
          }
        } catch (error) {
          if (error instanceof OllamaUnavailableError) {
            ollamaError = ollamaError ?? error;
            giveBackIds.push(row.id);
          } else {
            // An unexpected problem with this one article: count it as a failed attempt (bounded by MAX_ATTEMPTS).
            warn(`Could not classify "${row.title}" (${row.company_name}): ${error?.message ?? error}.`);
            results.push({ id: row.id, outcome: 'invalid', attempts: row.attempts });
          }
        }
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
    return { results, giveBackIds, ollamaError };
  }

  // Finishes the oldest 'collected' run if the queue is drained (see runFinisher.js).
  // Returns true if a run became 'done'.
  function tryFinishRun() {
    const run = findCollectedRun(db);
    if (!run || !isQueueDrained(db)) return false;
    if (!takeOverRun(db, run.id, { pid, now: now(), isAlive })) {
      state.note = `run ${run.id} is held by process ${run.owner_pid}`;
      return false;
    }
    state.heldRunId = run.id;
    log(`Run ${run.id}: queue drained. Moving the last relevant articles and writing data/ ...`);
    const result = finishHeldRun(db, run.id, { pid, now: now(), dataDir });
    if (!result.done) {
      warn(`Run ${run.id}: data/ was written, but the run could not be marked done (another process took it over).`);
      state.heldRunId = null;
      return false;
    }
    state.heldRunId = null;
    log(`Run ${run.id} is done: ${formatCount(result.moved)} mentions moved at the end, data/ written (${result.files.map((file) => file.split(/[\\/]/).pop()).join(', ')}).`);
    return true;
  }

  // Runs one pass of the loop (steps 1–6 at the top of this file).
  // Returns { kind: 'worked' | 'idle' | 'ollama-down', ... }.
  async function runOnePass() {
    releaseAbandonedClaims(db, { now: now(), isAlive });
    const rows = claimBatch(db, { limit: claimBatchSize, pid, now: new Date(now()).toISOString() });

    if (rows.length === 0) {
      moveFullChunks(db, { chunk: moveChunk });
      const finished = tryFinishRun();
      return { kind: 'idle', finished };
    }

    const { results, giveBackIds, ollamaError } = await classifyBatch(rows);
    const saved = results.length
      ? await retryDbWrite(() => saveBatchResults(db, results, { pid }), { label: 'save AI answers', warn, wait: sleep })
      : { relevant: 0, irrelevant: 0, failed: 0, failedForGood: 0 };
    if (giveBackIds.length) await retryDbWrite(() => giveBackClaims(db, giveBackIds, { pid }), { label: 'give articles back', warn, wait: sleep });
    state.articlesDone += saved.relevant + saved.irrelevant + saved.failed;
    const moved = moveFullChunks(db, { chunk: moveChunk });
    if (moved.moved) log(`Moved ${formatCount(moved.moved)} relevant articles to Mention.`);

    if (ollamaError) return { kind: 'ollama-down', error: ollamaError, saved, gaveBack: giveBackIds.length };
    return { kind: 'worked', saved, gaveBack: giveBackIds.length };
  }

  // The wait before the next try while Ollama is unavailable (2 s, 5 s, 10 s, 30 s, 60 s, 60 s, ...).
  function nextOllamaWait() {
    const steps = classifierConfig.OLLAMA_BACKOFF_MS;
    const wait = steps[Math.min(state.ollamaRetryIndex, steps.length - 1)];
    state.ollamaRetryIndex += 1;
    return wait;
  }

  // Checks Ollama before work starts (and again after an outage): the server answers, the model
  // is installed, and one known headline comes back as strict JSON with no thinking (I24).
  // Returns true when ready.
  async function checkOllama() {
    try {
      const { version } = await client.checkReady();
      const check = await client.selfCheck();
      if (!check.ok) {
        warn(`Ollama self-check failed: ${check.detail}. The model's answers can't be trusted; retrying.`);
        return false;
      }
      log(`Ollama ${version} is ready with ${client.model} (${check.detail}).`);
      return true;
    } catch (error) {
      warn(`${error.message}.`);
      return false;
    }
  }

  // Prints the progress line every PROGRESS_EVERY_MS (I10).
  function maybePrintProgress(force = false) {
    const nowMs = now();
    const elapsed = nowMs - state.lastProgressAt;
    if (!force && elapsed < classifierConfig.PROGRESS_EVERY_MS) return;
    const rate = elapsed > 0 ? (state.articlesDone - state.articlesAtLastProgress) / (elapsed / 1000) : 0;
    let counts;
    try { counts = countQueue(db); } catch (error) { counts = null; }
    const run = (() => { try { return db.prepare("SELECT id, status FROM JobRun WHERE status IN ('running', 'collected') ORDER BY id DESC LIMIT 1").get(); } catch { return null; } })();
    const parts = [`classifier · ${rate.toFixed(2)} articles/s`];
    if (counts) {
      parts.push(`queue: ${formatCount(counts.pending)} pending, ${formatCount(counts.failedRetry)} to retry, ${formatCount(counts.failedForGood)} failed for good`);
      parts.push(`${formatCount(counts.relevant)} relevant waiting to move`);
    }
    parts.push(run ? `run ${run.id} ${run.status}` : 'no open run');
    parts.push(state.note);
    log(parts.join(' · '));
    state.lastProgressAt = nowMs;
    state.articlesAtLastProgress = state.articlesDone;
  }

  // Runs until stop() is called. Never throws: every failure is logged and retried.
  async function runForever() {
    while (!state.stopping) {
      try {
        if (!state.ollamaReady) {
          state.ollamaReady = await checkOllama();
          if (!state.ollamaReady) {
            const wait = nextOllamaWait();
            state.note = `Ollama unavailable, retry in ${Math.round(wait / 1000)} s`;
            maybePrintProgress();
            await sleep(wait);
            continue;
          }
          state.ollamaRetryIndex = 0;
        }

        const pass = await runOnePass();
        if (pass.kind === 'ollama-down') {
          state.ollamaReady = false;
          const wait = nextOllamaWait();
          state.note = `Ollama unavailable, retry in ${Math.round(wait / 1000)} s`;
          warn(`${pass.error.message}. ${pass.gaveBack} articles given back; retrying in ${Math.round(wait / 1000)} s.`);
          await sleep(wait);
        } else if (pass.kind === 'idle') {
          state.ollamaRetryIndex = 0;
          state.note = 'waiting for new articles';
          maybePrintProgress();
          await sleep(classifierConfig.CLASSIFIER_POLL_MS);
        } else {
          state.ollamaRetryIndex = 0;
          state.note = 'Ollama ok';
          maybePrintProgress();
        }
      } catch (error) {
        // Not an article's fault (per-article problems are handled inside the batch): give this
        // process's claimed articles back unchanged so they don't wait for the 10-minute claim timeout.
        try { giveBackClaims(db, null, { pid }); } catch { /* the timeout will release them */ }
        const wait = nextOllamaWait();
        warn(`Classifier pass failed: ${error?.message ?? error}. Nothing half-saved; retrying in ${Math.round(wait / 1000)} s.`);
        await sleep(wait);
      }
    }
  }

  // Asks the loop to stop after the current step (used by tests; the service's stop handler exits directly).
  function stop() {
    state.stopping = true;
  }

  return { runOnePass, runForever, stop, state, checkOllama };
}

// classifierLoop.js — the classifier's main loop: queue → AI model → delete, or keep for Mention.
//
// Where it sits: the heart of the classifier service (`npm run classifier`, runClassifier.js).
// It runs forever and meets the other services only through the database (D38).
// Reads/writes: BufferQueue, Mention, JobRun (through queueStore.js, mover.js, runFinisher.js),
// Ollama (through ollamaClient.js) and data/ at the end of a run (exporter.js).
//
// One pass of the loop:
//   1. give back claims whose worker is gone (process dead or claim older than 10 min)
//   2. claim a batch of the oldest waiting articles (CLAIM_BATCH = 4 × LLM_CONCURRENCY), or ONE
//      article if a "suspect" one is waiting (a worker died while working on it, D78)
//   3. ask Ollama about them, LLM_CONCURRENCY at a time (one end-to-end question each, D26)
//   4. save the whole batch's answers in one transaction
//   5. when ≥ MOVE_CHUNK relevant rows are waiting, move them to Mention
//   6. while a run is still being collected: a group that has ended and whose articles are all
//      classified gets its own data/ export (leftovers of that group → data/, D86). If that
//      export fails, the pass still counts as done: one warning, and that group is tried again
//      only every GROUP_EXPORT_RETRY_MS (5 min; review G2)
//   7. when nothing is waiting: if a run is 'collected' and the queue is drained,
//      finish it (leftovers → data/ → 'done')
// When a request to Ollama fails (D75), a quick version check decides what it means:
//   - Ollama is down (not reachable): the articles are given back unchanged and the loop waits
//     2 s, 5 s, 10 s, 30 s, 60 s, then every 60 s, and never gives up (D59);
//   - Ollama is reachable, so only that request failed (timeout, HTTP error): it counts as a
//     failed attempt for that one article (retried later, 'failed' for good after MAX_ATTEMPTS).
// Any other error in a pass (e.g. the data/ files could not be written) is logged and the pass is
// retried after its own growing wait (D37), so the loop keeps going. The exception is a database
// error that is not "busy" (D76): it can't fix itself, so it is thrown on and the classifier
// crashes on purpose (emergency clean-up, exit 1, the orchestrator restarts it and shows why).
//
// Log lines (D92, D93): `log` / `warn` print on the terminal as before. The log file (`logFile`,
// classifier.log) gets the same lines, warnings as "WARNING: …", except two: "Moved N relevant
// articles to Mention." (after every pass; terminal only) and the speed line, which the file gets
// only every CLASSIFIER_FILE_STATUS_EVERY_MS (10 min). `event(text)` sends the system-log lines
// (orchestrator.log): Ollama ready / not ready (once per outage) / back, a group classified with
// data/ written, a run done.

import { config } from '../config.js';
import { isDatabaseBusyError, isDatabaseError } from '../db/database.js';
import { retryDbWrite, sleep as realSleep } from '../shared/retry.js';
import { findCollectedRun, isProcessAlive } from '../shared/runLock.js';
import { cleanForLog, describeDuration, formatCount } from '../shared/text.js';
import { OllamaUnavailableError } from './ollamaClient.js';
import { claimBatch, countQueue, giveBackClaims, isQueueDrained, releaseAbandonedClaims, saveBatchResults } from './queueStore.js';
import { moveFullChunks } from './mover.js';
import { exportGroup, findGroupsToExport, finishHeldRun, takeOverRun } from './runFinisher.js';

// Creates the classifier. Everything it talks to can be replaced in tests (fake Ollama,
// temp database, instant sleep, a small company list, a failing rename). Returns functions to
// run one pass, run forever, and stop.
export function createClassifier({
  db,
  client,
  sectionNames,
  pid = process.pid,
  concurrency = config.LLM_CONCURRENCY,
  claimBatchSize = config.CLAIM_BATCH,
  moveChunk = config.MOVE_CHUNK,
  dataDir,
  companyListFile = config.COMPANY_LIST_FILE,
  exportWriteOptions = {},
  isAlive = isProcessAlive,
  sleep = realSleep,
  now = () => Date.now(),
  log: printLine = console.log,
  warn: printWarning = console.warn,
  logFile = null,
  event = () => {},
}) {
  // Writes a line to the log file, if there is one. Logging must never stop the classifier.
  const toFile = (text) => {
    if (!logFile) return;
    try { logFile.write(text); } catch { /* only the file line is lost */ }
  };
  // A normal line: terminal and log file.
  const log = (text) => { printLine(text); toFile(text); };
  // A warning: terminal (as before) and log file (with "WARNING:" in front).
  const warn = (text) => { printWarning(text); toFile(`WARNING: ${text}`); };
  // A system-log line for the orchestrator (never throws).
  const sendEvent = (text) => {
    try { event(text); } catch { /* only the system-log line is lost */ }
  };

  const state = {
    stopping: false,
    ollamaReady: false,     // true after the start-up check passed; false again after an outage
    ollamaRetryIndex: 0,    // position in the OLLAMA_BACKOFF_MS list
    passErrorIndex: 0,      // position in the PASS_ERROR_BACKOFF_MS list (failed passes, not Ollama)
    heldRunId: null,        // the JobRun this process holds while finishing it (for the emergency heartbeat)
    articlesDone: 0,        // answered articles since start (for the progress line)
    lastProgressAt: now(),
    articlesAtLastProgress: 0,
    note: 'starting',
    lastFileStatusAt: null, // when the speed line was last written to the log file
    ollamaDownSince: null,  // when the current Ollama outage started (system log), or null
    ollamaAnnounced: false, // "Ollama ready" was sent once
    groupExportRetryAt: new Map(), // "runId:groupNumber" -> when a failed after-group export may be tried again (G2)
  };

  // Ollama could not be used: the first time of an outage sends one system-log line.
  function noteOllamaDown(reason) {
    if (state.ollamaDownSince !== null) return;
    state.ollamaDownSince = now();
    sendEvent(`Ollama not ready (${reason}) → classifier retrying`);
  }

  // Ollama works: "ready" the first time, "back after …" after an outage.
  function noteOllamaReady() {
    if (state.ollamaDownSince !== null) {
      sendEvent(`Ollama back after ${describeDuration(now() - state.ollamaDownSince)} (${client.model})`);
    } else if (!state.ollamaAnnounced) {
      sendEvent(`Ollama ready (${client.model})`);
    }
    state.ollamaDownSince = null;
    state.ollamaAnnounced = true;
  }

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
  // (Ollama is down or we are stopping), and the "Ollama is down" error if there was one.
  async function classifyBatch(rows) {
    const results = [];
    const giveBackIds = [];
    let ollamaError = null;
    let next = 0;

    async function worker() {
      while (next < rows.length) {
        const row = rows[next++];
        if (ollamaError || state.stopping) { giveBackIds.push(row.id); continue; }
        const title = cleanForLog(row.title); // headlines come from the internet: cleaned for logs only
        try {
          const answer = await client.classifyArticle(articleFor(row));
          if (answer.ok) {
            results.push({ id: row.id, outcome: answer.relevant ? 'relevant' : 'irrelevant', sentiment: answer.sentiment, attempts: row.attempts });
          } else {
            warn(`Invalid AI answer for "${title}" (${row.company_name}), attempt ${row.attempts}/${config.MAX_ATTEMPTS}: ${answer.error}.`);
            results.push({ id: row.id, outcome: 'invalid', attempts: row.attempts });
          }
        } catch (error) {
          if (error instanceof OllamaUnavailableError) {
            if (ollamaError || !(await client.isReachable())) {
              // Ollama itself is down: not the article's fault (D59).
              ollamaError = ollamaError ?? error;
              giveBackIds.push(row.id);
            } else {
              // Ollama answers, so only this request failed (D75): a failed attempt for this article.
              warn(`AI request for "${title}" (${row.company_name}) failed while Ollama is running, ` +
                `attempt ${row.attempts}/${config.MAX_ATTEMPTS}: ${cleanForLog(error.message)}.`);
              results.push({ id: row.id, outcome: 'invalid', attempts: row.attempts });
            }
          } else {
            // An unexpected problem with this one article: count it as a failed attempt (bounded by MAX_ATTEMPTS).
            warn(`Could not classify "${title}" (${row.company_name}): ${cleanForLog(error?.message ?? error)}.`);
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
  async function tryFinishRun() {
    const run = findCollectedRun(db);
    if (!run || !isQueueDrained(db)) return false;
    if (!takeOverRun(db, run.id, { pid, now: now(), isAlive })) {
      state.note = `run ${run.id} is held by process ${run.owner_pid}`;
      return false;
    }
    state.heldRunId = run.id;
    log(`Run ${run.id}: queue drained. Moving the last relevant articles and writing data/ ...`);
    const result = await finishHeldRun(db, run.id, { pid, now: now(), dataDir, companyListFile, writeOptions: exportWriteOptions });
    if (!result.done) {
      warn(`Run ${run.id}: data/ was written, but the run could not be marked done (another process took it over).`);
      state.heldRunId = null;
      return false;
    }
    state.heldRunId = null;
    log(`Run ${run.id} is done: ${formatCount(result.moved)} mentions moved at the end, data/ written (${result.files.map((file) => file.split(/[\\/]/).pop()).join(', ')}).`);
    let mentions = null;
    try { mentions = db.prepare('SELECT COUNT(*) AS n FROM Mention').get().n; } catch { /* the count is only for the log */ }
    sendEvent(`Run ${run.id} done, data/ written${mentions === null ? '' : `: ${formatCount(mentions)} mentions`}`);
    return true;
  }

  // Writes data/ after a group whose articles are all classified (D86), one group per call.
  // A failed export must never fail the pass (review G2): otherwise every pass, also the ones that
  // just classified a batch, would fail and wait up to 60 s. So a failure gives ONE warning for
  // that group, and the group is tried again only after GROUP_EXPORT_RETRY_MS (5 min); other
  // groups that are ready are not held up by it. The end-of-run export covers every group anyway.
  // The exception is a database error that is not "busy" (D76): thrown on, as everywhere.
  // Returns true if a group was exported.
  async function tryExportGroup() {
    const nowMs = now();
    const keyOf = (group) => `${group.runId}:${group.groupNumber}`;
    const group = findGroupsToExport(db).find((ready) => (state.groupExportRetryAt.get(keyOf(ready)) ?? 0) <= nowMs);
    if (!group) return false;
    let result;
    try {
      result = await exportGroup(db, group, { now: nowMs, dataDir, companyListFile, writeOptions: exportWriteOptions });
    } catch (error) {
      if (isDatabaseError(error) && !isDatabaseBusyError(error)) throw error; // D76: crash on purpose
      const firstFailure = !state.groupExportRetryAt.has(keyOf(group));
      state.groupExportRetryAt.set(keyOf(group), nowMs + config.GROUP_EXPORT_RETRY_MS);
      if (firstFailure) {
        warn(`Run ${group.runId}, group ${group.groupNumber}: data/ could not be written (${cleanForLog(error?.message ?? error)}). ` +
          `Classifying goes on; this group's data/ is tried again every ${describeDuration(config.GROUP_EXPORT_RETRY_MS)}, and the end of the run writes data/ anyway.`);
      }
      return false;
    }
    state.groupExportRetryAt.delete(keyOf(group));
    if (!result.marked) {
      // The group was set back to 'pending' by a --groups re-run while data/ was written (G8).
      log(`Run ${group.runId}, group ${group.groupNumber} is being collected again; its data/ is written again once it has ended.`);
      return false;
    }
    log(`Run ${group.runId}, group ${group.groupNumber}: all its articles are classified. ${formatCount(result.moved)} mentions moved, data/ written.`);
    sendEvent(`Run ${group.runId}, group ${group.groupNumber} classified, data/ written`);
    return true;
  }

  // Runs one pass of the loop (steps 1–7 at the top of this file).
  // Returns { kind: 'worked' | 'idle' | 'ollama-down', ... }.
  async function runOnePass() {
    releaseAbandonedClaims(db, { now: now(), isAlive });
    const rows = claimBatch(db, { limit: claimBatchSize, pid, now: new Date(now()).toISOString() });

    if (rows.length === 0) {
      moveFullChunks(db, { chunk: moveChunk });
      await tryExportGroup();
      const finished = await tryFinishRun();
      return { kind: 'idle', finished };
    }

    const { results, giveBackIds, ollamaError } = await classifyBatch(rows);
    const saved = results.length
      ? await retryDbWrite(() => saveBatchResults(db, results, { pid }), { label: 'save AI answers', warn, wait: sleep })
      : { relevant: 0, irrelevant: 0, failed: 0, failedForGood: 0 };
    if (giveBackIds.length) await retryDbWrite(() => giveBackClaims(db, giveBackIds, { pid }), { label: 'give articles back', warn, wait: sleep });
    state.articlesDone += saved.relevant + saved.irrelevant + saved.failed;
    const moved = moveFullChunks(db, { chunk: moveChunk });
    if (moved.moved) printLine(`Moved ${formatCount(moved.moved)} relevant articles to Mention.`); // terminal only (D93)
    await tryExportGroup();

    if (ollamaError) return { kind: 'ollama-down', error: ollamaError, saved, gaveBack: giveBackIds.length };
    return { kind: 'worked', saved, gaveBack: giveBackIds.length };
  }

  // The wait before the next try while Ollama is unavailable (2 s, 5 s, 10 s, 30 s, 60 s, 60 s, ...).
  function nextOllamaWait() {
    const steps = config.OLLAMA_BACKOFF_MS;
    const wait = steps[Math.min(state.ollamaRetryIndex, steps.length - 1)];
    state.ollamaRetryIndex += 1;
    return wait;
  }

  // The wait before retrying after a pass failed for a reason that is not Ollama
  // (2 s, 5 s, 10 s, 30 s, 60 s, 60 s, ...). Its own counter, reset after a pass that works.
  function nextPassErrorWait() {
    const steps = config.PASS_ERROR_BACKOFF_MS;
    const wait = steps[Math.min(state.passErrorIndex, steps.length - 1)];
    state.passErrorIndex += 1;
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
        noteOllamaDown(`self-check failed: ${check.detail}`);
        return false;
      }
      log(`Ollama ${version} is ready with ${client.model} (${check.detail}).`);
      noteOllamaReady();
      return true;
    } catch (error) {
      warn(`${error.message}.`);
      noteOllamaDown(error.message);
      return false;
    }
  }

  // Prints the progress line every PROGRESS_EVERY_MS (I10).
  function maybePrintProgress(force = false) {
    const nowMs = now();
    const elapsed = nowMs - state.lastProgressAt;
    if (!force && elapsed < config.PROGRESS_EVERY_MS) return;
    const rate = elapsed > 0 ? (state.articlesDone - state.articlesAtLastProgress) / (elapsed / 1000) : 0;
    let counts;
    try { counts = countQueue(db); } catch { counts = null; } // display only
    const run = (() => { try { return db.prepare("SELECT id, status FROM JobRun WHERE status IN ('running', 'collected') ORDER BY id DESC LIMIT 1").get(); } catch { return null; } })();
    const parts = [`classifier · ${rate.toFixed(2)} articles/s`];
    if (counts) {
      parts.push(`queue: ${formatCount(counts.pending)} pending, ${formatCount(counts.failedRetry)} to retry, ${formatCount(counts.failedForGood)} failed for good`);
      parts.push(`${formatCount(counts.relevant)} relevant waiting to move`);
    }
    parts.push(run ? `run ${run.id} ${run.status}` : 'no open run');
    parts.push(state.note);
    const line = parts.join(' · ');
    printLine(line);
    if (state.lastFileStatusAt === null || nowMs - state.lastFileStatusAt >= config.CLASSIFIER_FILE_STATUS_EVERY_MS) {
      toFile(line);
      state.lastFileStatusAt = nowMs;
    }
    state.lastProgressAt = nowMs;
    state.articlesAtLastProgress = state.articlesDone;
  }

  // Runs until stop() is called. Every failure is logged and retried, except a database error
  // that is not "busy" (D76): that one is thrown on, so the service crashes and is restarted.
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
        state.passErrorIndex = 0;
        if (pass.kind === 'ollama-down') {
          state.ollamaReady = false;
          const wait = nextOllamaWait();
          state.note = `Ollama unavailable, retry in ${Math.round(wait / 1000)} s`;
          warn(`${pass.error.message}. ${pass.gaveBack} articles given back; retrying in ${Math.round(wait / 1000)} s.`);
          noteOllamaDown(pass.error.message);
          await sleep(wait);
        } else if (pass.kind === 'idle') {
          state.ollamaRetryIndex = 0;
          state.note = 'waiting for new articles';
          maybePrintProgress();
          await sleep(config.CLASSIFIER_POLL_MS);
        } else {
          state.ollamaRetryIndex = 0;
          state.note = 'Ollama ok';
          maybePrintProgress();
        }
      } catch (error) {
        if (isDatabaseError(error) && !isDatabaseBusyError(error)) throw error; // D76: crash on purpose
        // Not an article's fault (per-article problems are handled inside the batch): give this
        // process's claimed articles back unchanged so they don't wait for the 10-minute claim timeout.
        try { giveBackClaims(db, null, { pid }); } catch { /* the timeout will release them */ }
        const wait = nextPassErrorWait();
        state.note = `last pass failed, retry in ${Math.round(wait / 1000)} s`;
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

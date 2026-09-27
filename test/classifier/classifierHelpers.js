// classifierHelpers.js — shared tools for the classifier's offline tests.
//
// Where it sits: imported by test/classifier/*.test.js only. Nothing here talks to Ollama:
// a fake client (or a fake `fetch`) answers instead. Databases are temporary files
// (makeTempDb from test/helpers.js), removed after each test.
// Writes: rows in the temporary database.

import { OllamaUnavailableError } from '../../src/classifier/ollamaClient.js';

export const SECTION_NAMES = { 1: 'High-Tech (Information Technology)', 2: 'Health (Healthcare & Biotechnology)', 13: 'Unsorted (line of business not confirmed)' };

// Adds companies: [{ id, name, section }].
export function addCompanies(db, companies) {
  const insert = db.prepare('INSERT INTO Company (id, name, section, hint, query_param) VALUES (?, ?, ?, NULL, ?)');
  for (const company of companies) insert.run(company.id, company.name, company.section ?? 1, `"${company.name}"`);
}

// Adds queue rows. Each: { companyId, guid, title, publisher?, status?, attempts?, sentiment?, publishedAt? }.
// Returns their ids in order.
export function addQueueRows(db, rows) {
  const insert = db.prepare(`INSERT INTO BufferQueue (company_id, guid, url, title, publisher, published_at, first_seen_at, status, sentiment, attempts)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return rows.map((row) => Number(insert.run(
    row.companyId, row.guid, `https://news.google.com/rss/articles/${row.guid}`, row.title, row.publisher === undefined ? 'Example News' : row.publisher,
    row.publishedAt ?? '2026-09-20T12:00:00.000Z', '2026-09-26T08:00:00.000Z', row.status ?? 'pending', row.sentiment ?? null, row.attempts ?? 0,
  ).lastInsertRowid));
}

// Adds a JobRun with the given status (and a checklist row per company id). Returns its id.
export function addRun(db, { status = 'collected', ownerPid = null, heartbeat = '2026-09-27T09:00:00.000Z', companyIds = [], finishedAt = '2026-09-27T09:00:00.000Z' } = {}) {
  const runId = Number(db.prepare(`INSERT INTO JobRun (started_at, finished_at, status, last_heartbeat, owner_pid) VALUES (?, ?, ?, ?, ?)`)
    .run('2026-09-27T06:00:00.000Z', status === 'running' ? null : finishedAt, status, heartbeat, ownerPid).lastInsertRowid);
  const addCompany = db.prepare("INSERT INTO JobRunCompany (run_id, company_id, status) VALUES (?, ?, 'finished')");
  for (const companyId of companyIds) addCompany.run(runId, companyId);
  return runId;
}

// All queue rows, oldest first.
export function queueRows(db) {
  return db.prepare('SELECT * FROM BufferQueue ORDER BY id').all();
}

// A fake Ollama client. `decide(article)` returns one of:
//   { relevant: true, sentiment } / { relevant: false } → a valid answer
//   'invalid'  → an invalid answer (after all tries)
//   'down'     → throws OllamaUnavailableError
//   'crash'    → throws a plain Error (a bug-like problem with this article)
// Records every article asked in `client.asked`.
export function makeFakeClient(decide, { selfCheckOk = true, ready = true } = {}) {
  const client = {
    model: 'fake-model',
    baseUrl: 'http://fake',
    asked: [],
    inFlight: 0,
    maxInFlight: 0,
    async classifyArticle(article) {
      client.asked.push(article);
      client.inFlight += 1;
      client.maxInFlight = Math.max(client.maxInFlight, client.inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      client.inFlight -= 1;
      const answer = decide(article);
      if (answer === 'down') throw new OllamaUnavailableError('Ollama is not reachable at http://fake (ECONNREFUSED)');
      if (answer === 'crash') throw new Error('boom');
      if (answer === 'invalid') return { ok: false, error: 'invalid JSON', tries: 2 };
      return { ok: true, relevant: answer.relevant, sentiment: answer.relevant ? answer.sentiment : null, tries: 1 };
    },
    async checkReady() {
      if (!ready) throw new OllamaUnavailableError('Ollama is not reachable at http://fake (ECONNREFUSED)');
      return { version: 'fake' };
    },
    async selfCheck() {
      return selfCheckOk ? { ok: true, detail: 'answer {"relevant": true, "sentiment": "positive"}' } : { ok: false, detail: 'answer is not valid' };
    },
  };
  return client;
}

// A logger that stores lines instead of printing them.
export function makeLogger() {
  const lines = { log: [], warn: [] };
  return { lines, log: (text) => lines.log.push(text), warn: (text) => lines.warn.push(text) };
}

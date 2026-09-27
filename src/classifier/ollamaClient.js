// ollamaClient.js — talks to the local Ollama server (the AI model on this PC).
//
// Where it sits: the classifier's only link to Ollama. For each article it sends the prompt
// (prompt.js) and checks the answer (answerValidator.js). Also used by the parallel test.
// Reads: Ollama's HTTP API (/api/version, /api/show, /api/chat). Writes: nothing.
//
// Kinds of failure (D59, D75):
//   - OllamaUnavailableError: a request got no usable answer (no connection, timeout, HTTP error,
//     unreadable body). The caller then asks isReachable() (a quick /api/version check) to tell
//     the two cases apart:
//       * Ollama is down (not reachable): not the article's fault; the caller gives the article
//         back (the attempt is undone) and waits;
//       * Ollama is reachable, so only this one request failed: it counts as a failed attempt for
//         that article (normal retry rules, 'failed' for good after MAX_ATTEMPTS).
//   - An invalid answer (bad JSON / wrong shape): asked again, up to LLM_TRIES_PER_ATTEMPT
//     times; after that the attempt counts as failed for that article.
// Every answer is capped at OLLAMA_NUM_PREDICT tokens (D75), so a model that keeps writing gives
// a quick invalid answer instead of running until the timeout.

import { config } from '../config.js';
import { ANSWER_SCHEMA, buildPrompt } from './prompt.js';
import { validateAnswer } from './answerValidator.js';

// Ollama can't be used right now (down, timeout, HTTP error, model not pulled).
export class OllamaUnavailableError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = 'OllamaUnavailableError';
    this.status = status;
  }
}

// A headline whose answer is known, used by the start-up self-check (issue I24):
// it proves the model answers in strict JSON with thinking off.
const SELF_CHECK_ARTICLE = {
  companyName: 'Harvey',
  sectionName: 'High-Tech (Information Technology)',
  title: 'Harvey Raises $550M at a $15.5B Valuation to Help Legal Teams Own Their Intelligence',
  publisher: 'Harvey',
};

// Creates the client. `fetchImpl` can be replaced by a fake in tests.
export function createOllamaClient({
  url = config.OLLAMA_URL,
  model = config.OLLAMA_MODEL,
  timeoutMs = config.OLLAMA_TIMEOUT_MS,
  keepAlive = config.OLLAMA_KEEP_ALIVE,
  numPredict = config.OLLAMA_NUM_PREDICT,
  reachableCheckTimeoutMs = config.OLLAMA_REACHABLE_CHECK_TIMEOUT_MS,
  triesPerAttempt = config.LLM_TRIES_PER_ATTEMPT,
  fetchImpl = fetch,
} = {}) {
  const baseUrl = url.replace(/\/+$/, '');

  // Sends one HTTP request to Ollama and returns the parsed JSON body. `waitMs` = how long to
  // wait for the answer (default: OLLAMA_TIMEOUT_MS).
  // Every problem (no connection, timeout, HTTP error, unreadable body) becomes OllamaUnavailableError.
  async function callOllama(path, { method = 'POST', body, waitMs = timeoutMs } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(waitMs),
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? `no answer within ${Math.round(waitMs / 1000)} s` : (error?.cause?.code ?? error?.message ?? String(error));
      throw new OllamaUnavailableError(`Ollama is not reachable at ${baseUrl} (${reason})`);
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      throw new OllamaUnavailableError(`Ollama's answer could not be read (${error.message})`);
    }
    if (!response.ok) {
      const hint = response.status === 404 && /not found/i.test(text) ? ` — is the model pulled? Run: ollama pull ${model}` : '';
      throw new OllamaUnavailableError(`Ollama answered HTTP ${response.status}: ${text.slice(0, 200)}${hint}`, { status: response.status });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new OllamaUnavailableError(`Ollama's answer is not JSON: ${text.slice(0, 200)}`);
    }
  }

  // Asks the model once. Returns the raw answer text plus a few numbers for logs and tests.
  // Settings (D27, D49, D75): strict JSON schema, temperature 0, thinking off, answer capped at
  // OLLAMA_NUM_PREDICT tokens.
  async function askOnce(promptText) {
    const result = await callOllama('/api/chat', {
      body: {
        model,
        stream: false,
        think: false,
        format: ANSWER_SCHEMA,
        keep_alive: keepAlive,
        options: { temperature: 0, num_predict: numPredict },
        messages: [{ role: 'user', content: promptText }],
      },
    });
    return {
      content: result?.message?.content ?? '',
      thinkingChars: (result?.message?.thinking ?? '').length,
      promptTokens: result?.prompt_eval_count ?? null,
      answerTokens: result?.eval_count ?? null,
    };
  }

  // Classifies one article: up to `triesPerAttempt` questions until the answer is valid.
  // Returns { ok: true, relevant, sentiment, tries } or { ok: false, error, tries, lastAnswer }.
  // Throws OllamaUnavailableError if Ollama itself fails (the caller then gives the article back).
  async function classifyArticle(article, { promptText = buildPrompt(article) } = {}) {
    let lastError = null;
    let lastAnswer = null;
    for (let tryNumber = 1; tryNumber <= triesPerAttempt; tryNumber += 1) {
      const answer = await askOnce(promptText);
      lastAnswer = answer.content;
      const checked = validateAnswer(answer.content);
      if (checked.ok) return { ok: true, relevant: checked.relevant, sentiment: checked.sentiment, tries: tryNumber, thinkingChars: answer.thinkingChars };
      lastError = checked.error;
    }
    return { ok: false, error: lastError, tries: triesPerAttempt, lastAnswer: String(lastAnswer).slice(0, 300) };
  }

  // Checks that Ollama runs and the model is installed. Throws OllamaUnavailableError otherwise.
  async function checkReady() {
    const version = await callOllama('/api/version', { method: 'GET' });
    await callOllama('/api/show', { body: { model } });
    return { version: version?.version ?? 'unknown' };
  }

  // Quick check whether the Ollama server answers at all (GET /api/version, short timeout).
  // Used after a request failed, to tell "Ollama is down" (false) from "only that request
  // failed" (true) (D75). Never throws.
  async function isReachable() {
    try {
      await callOllama('/api/version', { method: 'GET', waitMs: reachableCheckTimeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  // Start-up self-check (I24): one known headline must come back as valid JSON with no
  // "thinking" text. Returns { ok, detail }; throws OllamaUnavailableError if Ollama is down.
  async function selfCheck() {
    const answer = await askOnce(buildPrompt(SELF_CHECK_ARTICLE));
    const checked = validateAnswer(answer.content);
    if (!checked.ok) return { ok: false, detail: `answer is not valid (${checked.error}): ${answer.content.slice(0, 200)}` };
    if (answer.thinkingChars > 0) return { ok: false, detail: `the model "thought" (${answer.thinkingChars} characters) although thinking is off` };
    return { ok: true, detail: `answer ${answer.content.replace(/\s+/g, ' ')}` };
  }

  return { askOnce, classifyArticle, checkReady, isReachable, selfCheck, model, baseUrl };
}

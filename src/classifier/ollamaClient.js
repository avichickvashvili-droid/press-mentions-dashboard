// ollamaClient.js — talks to the local Ollama server (the AI model on this PC).
//
// Where it sits: the classifier's only link to Ollama. For each article it sends the prompt
// (prompt.js) and checks the answer (answerValidator.js). Also used by the parallel test.
// Reads: Ollama's HTTP API (/api/version, /api/show, /api/chat). Writes: nothing.
//
// Two kinds of failure are kept apart on purpose (owner decisions Q6, D59):
//   - OllamaUnavailableError: Ollama is down, too slow, or answered with an HTTP error.
//     That is not the article's fault: the caller gives the article back and waits.
//   - An invalid answer (bad JSON / wrong shape): asked again, up to LLM_TRIES_PER_ATTEMPT
//     times; after that the attempt counts as failed for that article.

import { classifierConfig } from './classifierConfig.js';
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
  url = classifierConfig.OLLAMA_URL,
  model = classifierConfig.OLLAMA_MODEL,
  timeoutMs = classifierConfig.OLLAMA_TIMEOUT_MS,
  keepAlive = classifierConfig.OLLAMA_KEEP_ALIVE,
  triesPerAttempt = classifierConfig.LLM_TRIES_PER_ATTEMPT,
  fetchImpl = fetch,
} = {}) {
  const baseUrl = url.replace(/\/+$/, '');

  // Sends one HTTP request to Ollama and returns the parsed JSON body.
  // Every problem (no connection, timeout, HTTP error, unreadable body) becomes OllamaUnavailableError.
  async function callOllama(path, { method = 'POST', body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)} s` : (error?.cause?.code ?? error?.message ?? String(error));
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
  // Settings (D27, D49): strict JSON schema, temperature 0, thinking off.
  async function askOnce(promptText) {
    const result = await callOllama('/api/chat', {
      body: {
        model,
        stream: false,
        think: false,
        format: ANSWER_SCHEMA,
        keep_alive: keepAlive,
        options: { temperature: 0 },
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

  // Start-up self-check (I24): one known headline must come back as valid JSON with no
  // "thinking" text. Returns { ok, detail }; throws OllamaUnavailableError if Ollama is down.
  async function selfCheck() {
    const answer = await askOnce(buildPrompt(SELF_CHECK_ARTICLE));
    const checked = validateAnswer(answer.content);
    if (!checked.ok) return { ok: false, detail: `answer is not valid (${checked.error}): ${answer.content.slice(0, 200)}` };
    if (answer.thinkingChars > 0) return { ok: false, detail: `the model "thought" (${answer.thinkingChars} characters) although thinking is off` };
    return { ok: true, detail: `answer ${answer.content.replace(/\s+/g, ' ')}` };
  }

  return { askOnce, classifyArticle, checkReady, selfCheck, model, baseUrl };
}

// ollamaClient.test.js — the Ollama client (ollamaClient.js) against a fake `fetch`. Offline.
// Checks the request settings (strict JSON, thinking off, temperature 0), the retry on an invalid
// answer, and that every Ollama problem becomes OllamaUnavailableError (Q6).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaClient, OllamaUnavailableError } from '../../src/classifier/ollamaClient.js';
import { ANSWER_SCHEMA } from '../../src/classifier/prompt.js';

const ARTICLE = { companyName: 'Harvey', sectionName: 'High-Tech (Information Technology)', title: 'Harvey raises $100M', publisher: 'Reuters' };

// A fake fetch that answers each /api/chat call with the next item of `answers`.
// An item is a string (the model's content), { status, body }, { thinking, content } or an Error to throw.
function fakeFetch(answers) {
  const fake = async (url, options) => {
    fake.calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    if (next && typeof next === 'object' && 'status' in next) return new Response(next.body ?? '', { status: next.status });
    const message = typeof next === 'string' ? { content: next } : next;
    return new Response(JSON.stringify({ message, eval_count: 17, prompt_eval_count: 300 }), { status: 200 });
  };
  fake.calls = [];
  return fake;
}

test('sends strict JSON, thinking off and temperature 0, and reads a valid answer', async () => {
  const fetchImpl = fakeFetch(['{"relevant": true, "sentiment": "positive"}']);
  const client = createOllamaClient({ url: 'http://ollama.test/', model: 'qwen3:4b', fetchImpl });
  const result = await client.classifyArticle(ARTICLE);
  assert.deepEqual({ ok: result.ok, relevant: result.relevant, sentiment: result.sentiment, tries: result.tries }, { ok: true, relevant: true, sentiment: 'positive', tries: 1 });
  const { url, body } = fetchImpl.calls[0];
  assert.equal(url, 'http://ollama.test/api/chat');
  assert.equal(body.model, 'qwen3:4b');
  assert.equal(body.think, false);
  assert.equal(body.stream, false);
  assert.deepEqual(body.format, ANSWER_SCHEMA);
  assert.equal(body.options.temperature, 0);
  assert.match(body.messages[0].content, /^Company: Harvey$/m);
});

test('an invalid answer is asked again once; a valid second answer is used', async () => {
  const fetchImpl = fakeFetch(['not json', '{"relevant": false, "sentiment": null}']);
  const result = await createOllamaClient({ fetchImpl }).classifyArticle(ARTICLE);
  assert.equal(result.ok, true);
  assert.equal(result.relevant, false);
  assert.equal(result.tries, 2);
});

test('two invalid answers make the attempt fail (no guessing)', async () => {
  const fetchImpl = fakeFetch(['{"relevant": true, "sentiment": null}', 'oops']);
  const result = await createOllamaClient({ fetchImpl }).classifyArticle(ARTICLE);
  assert.equal(result.ok, false);
  assert.equal(result.tries, 2);
  assert.equal(fetchImpl.calls.length, 2);
});

test('no connection, a timeout, or an HTTP error becomes OllamaUnavailableError', async () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  await assert.rejects(createOllamaClient({ fetchImpl: fakeFetch([refused]) }).classifyArticle(ARTICLE), (error) => error instanceof OllamaUnavailableError && /ECONNREFUSED/.test(error.message));
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  await assert.rejects(createOllamaClient({ fetchImpl: fakeFetch([timeout]) }).classifyArticle(ARTICLE), /no answer within/);
  await assert.rejects(createOllamaClient({ fetchImpl: fakeFetch([{ status: 500, body: 'runner crashed' }]) }).classifyArticle(ARTICLE), (error) => error instanceof OllamaUnavailableError && error.status === 500);
  await assert.rejects(createOllamaClient({ fetchImpl: fakeFetch([{ status: 200, body: '<html>' }]) }).classifyArticle(ARTICLE), OllamaUnavailableError);
});

test('a missing model says how to pull it', async () => {
  const fetchImpl = fakeFetch([{ status: 404, body: '{"error":"model \'qwen3:4b\' not found"}' }]);
  await assert.rejects(createOllamaClient({ model: 'qwen3:4b', fetchImpl }).classifyArticle(ARTICLE), /ollama pull qwen3:4b/);
});

test('the self-check fails when the model "thinks" or answers badly, and passes otherwise', async () => {
  assert.equal((await createOllamaClient({ fetchImpl: fakeFetch([{ content: '{"relevant": true, "sentiment": "positive"}', thinking: 'hmm' }]) }).selfCheck()).ok, false);
  assert.equal((await createOllamaClient({ fetchImpl: fakeFetch(['plain text']) }).selfCheck()).ok, false);
  assert.equal((await createOllamaClient({ fetchImpl: fakeFetch(['{"relevant": true, "sentiment": "positive"}']) }).selfCheck()).ok, true);
});

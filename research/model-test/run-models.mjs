// Runs every item in dataset.json through each Ollama model, one request at a time.
// Resumable: each answer is appended as one line to results/<model>.jsonl, and items
// already in that file are skipped on the next start.
//
// Usage: node run-models.mjs <model> [<model> ...]
// Output: results/<model>.jsonl (one line per item) and results/<model>.meta.json
//         (load time, `ollama ps` output, run segments). Log lines go to stdout.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { request } from 'node:http';
import { execSync } from 'node:child_process';

const HOST = { hostname: '127.0.0.1', port: 11434 };
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000; // big models on CPU can be very slow to load

const promptFile = readFileSync(new URL('./prompt.txt', import.meta.url), 'utf8');
const [TEMPLATE, schemaPart] = promptFile.split(/^---- JSON schema.*$/m);
const SCHEMA = JSON.parse(schemaPart);
const LIMIT = Number(process.env.LIMIT ?? 0); // for smoke tests only
const OUT = process.env.OUT ?? 'results';
const allItems = JSON.parse(readFileSync(new URL('./dataset.json', import.meta.url), 'utf8')).items;
const items = LIMIT ? allItems.filter((_, i) => i % Math.ceil(allItems.length / LIMIT) === 0) : allItems;
mkdirSync(new URL(`./${OUT}/`, import.meta.url), { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const safe = (m) => m.replace(/[:/]/g, '_');
const fileFor = (m, ext) => new URL(`./${OUT}/${safe(m)}.${ext}`, import.meta.url);

// POST JSON to Ollama with a long timeout (fetch's default header timeout is 5 min).
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request({ ...HOST, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('bad JSON from Ollama: ' + text.slice(0, 200))); }
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

function fill(it) {
  return TEMPLATE.trim()
    .replace('{{company}}', it.company).replace('{{section}}', it.section)
    .replace('{{description}}', it.description).replace('{{title}}', it.title)
    .replace('{{publisher}}', it.publisher);
}

// Checks the model's text against the schema. Returns {ok, value, error}.
function validate(text) {
  let v;
  try { v = JSON.parse(text); } catch { return { ok: false, error: 'invalid JSON' }; }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, error: 'not an object' };
  if (typeof v.relevant !== 'boolean') return { ok: false, error: 'relevant not boolean' };
  if (!('sentiment' in v)) return { ok: false, error: 'sentiment missing' };
  if (![null, 'positive', 'neutral', 'negative'].includes(v.sentiment)) return { ok: false, error: 'sentiment not in enum' };
  return { ok: true, value: { relevant: v.relevant, sentiment: v.sentiment } };
}

function ollamaPs() {
  try { return execSync('ollama ps', { encoding: 'utf8', timeout: 30000 }); } catch (e) { return 'ollama ps failed: ' + e.message; }
}

async function runModel(model) {
  const jsonl = fileFor(model, 'jsonl');
  const metaFile = fileFor(model, 'meta.json');
  const done = new Set();
  if (existsSync(jsonl)) {
    for (const line of readFileSync(jsonl, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).id); } catch { /* half-written last line: redo that item */ }
    }
  }
  const todo = items.filter((it) => !done.has(it.id));
  if (todo.length === 0) { log(model, 'already complete'); return; }
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : { model, segments: [] };

  // Which thinking setting to send. gpt-oss only accepts levels, so use the lowest ("low").
  const show = await post('/api/show', { model });
  const caps = show.capabilities ?? [];
  let think;
  if (/gpt-oss/.test(model)) think = 'low';
  else if (caps.includes('thinking')) think = false;
  meta.capabilities = caps;
  meta.think = think ?? 'not sent (model has no thinking capability)';
  meta.details = show.details;

  // Load the model on its own so the load time is measured apart from the items.
  log(model, 'loading...');
  const t0 = Date.now();
  const loadRes = await post('/api/generate', { model, prompt: '', keep_alive: '60m' });
  const loadSec = (Date.now() - t0) / 1000;
  const ps = ollamaPs();
  log(model, `loaded in ${loadSec.toFixed(1)} s\n${ps}`);
  const seg = { started: new Date().toISOString(), load_wall_s: loadSec, load_duration_s: (loadRes.load_duration ?? 0) / 1e9, ollama_ps: ps, items: 0 };
  meta.segments.push(seg);
  writeFileSync(metaFile, JSON.stringify(meta, null, 1));

  const segStart = Date.now();
  let n = 0;
  for (const it of todo) {
    const body = {
      model, stream: false, format: SCHEMA, keep_alive: '60m',
      options: { temperature: 0 },
      messages: [{ role: 'user', content: fill(it) }],
    };
    if (think !== undefined) body.think = think;
    const attempts = [];
    const itemStart = Date.now();
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        const r = await post('/api/chat', body);
        const text = r.message?.content ?? '';
        const v = validate(text);
        attempts.push({ raw: text.slice(0, 500), error: v.ok ? null : v.error, eval_count: r.eval_count, prompt_eval_count: r.prompt_eval_count, thinking_chars: (r.message?.thinking ?? '').length });
        if (v.ok) result = v.value;
      } catch (e) {
        attempts.push({ raw: null, error: 'request failed: ' + e.message });
        log(model, 'request error on item', it.id, e.message);
      }
    }
    const seconds = (Date.now() - itemStart) / 1000;
    const row = { id: it.id, ok: !!result, relevant: result?.relevant ?? null, sentiment: result?.sentiment ?? null, retries: attempts.length - 1, seconds, attempts };
    appendFileSync(jsonl, JSON.stringify(row) + '\n');
    n++;
    if (n % 50 === 0) {
      const el = (Date.now() - segStart) / 1000;
      log(model, `${done.size + n}/${items.length} done, ${(n / el).toFixed(2)} items/s`);
    }
  }
  seg.items = n;
  seg.loop_wall_s = (Date.now() - segStart) / 1000;
  seg.ended = new Date().toISOString();
  seg.ollama_ps_end = ollamaPs();
  writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  log(model, `finished ${n} items in ${seg.loop_wall_s.toFixed(1)} s`);
}

for (const model of process.argv.slice(2)) {
  try {
    await runModel(model);
  } catch (e) {
    log(model, 'FAILED:', e.message); // keep going with the next model
  } finally {
    try { await post('/api/generate', { model, keep_alive: 0 }); log(model, 'unloaded'); } catch (e) { log(model, 'unload failed:', e.message); }
  }
}
log('all models processed');

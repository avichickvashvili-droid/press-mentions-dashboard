// run-parallel.mjs — the parallel-throughput test (D45, D65, issue I33).
//
// What it does: sends all 598 real headlines of research/model-test/dataset.json to Ollama with
// N requests at the same time, and records speed, errors, GPU use and every answer.
// No Google requests. The Ollama server must already be running with OLLAMA_NUM_PARALLEL = N
// (the restart is done by hand, see results.md "How the test was run").
//
// Usage: node run-parallel.mjs <N> <variant> <label>
//   N        how many requests run at the same time (1, 2, 3, 4, 6, 8)
//   variant  "new"      = the classifier's prompt (company + full section name, D58)
//            "original" = the prompt tested in research/model-test/prompt.txt (with the hand-written description)
//   label    name of the output files, e.g. n2-new
// Output: raw/<label>.jsonl (one line per headline) and raw/<label>.meta.json (timings, GPU samples, `ollama ps`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { createOllamaClient } from '../../src/classifier/ollamaClient.js';
import { buildPrompt, loadSectionNames } from '../../src/classifier/prompt.js';

const [nText, variant, label] = process.argv.slice(2);
const N = Number(nText);
if (!Number.isInteger(N) || N < 1 || !['new', 'original'].includes(variant) || !label) {
  console.error('Usage: node run-parallel.mjs <N> <new|original> <label>');
  process.exit(1);
}

const here = (file) => new URL(file, import.meta.url);
const dataset = JSON.parse(readFileSync(here('../model-test/dataset.json'), 'utf8'));
const items = dataset.items;
mkdirSync(here('./raw/'), { recursive: true });
const log = (...parts) => console.log(new Date().toISOString(), `[${label}]`, ...parts);

// ---- Prompts ----

// The dataset stores short section names ("High-Tech"); the classifier uses the full names
// from section_keywords.json ("High-Tech (Information Technology)"). Match on the start of the name.
const fullSectionNames = Object.values(loadSectionNames());
function fullSectionName(shortName) {
  const match = fullSectionNames.find((name) => name === shortName || name.startsWith(`${shortName} (`));
  if (!match) throw new Error(`No full section name for "${shortName}"`);
  return match;
}

// The original tested prompt, filled exactly like research/model-test/run-models.mjs did.
const promptFile = readFileSync(here('../model-test/prompt.txt'), 'utf8');
const ORIGINAL_TEMPLATE = promptFile.split(/^---- JSON schema.*$/m)[0];
function originalPrompt(item) {
  return ORIGINAL_TEMPLATE.trim()
    .replace('{{company}}', item.company).replace('{{section}}', item.section)
    .replace('{{description}}', item.description).replace('{{title}}', item.title)
    .replace('{{publisher}}', item.publisher);
}

// The dataset titles already have the " - Publisher" ending removed, so buildPrompt leaves them as they are.
function promptFor(item) {
  if (variant === 'original') return originalPrompt(item);
  return buildPrompt({ companyName: item.company, sectionName: fullSectionName(item.section), title: item.title, publisher: item.publisher });
}

// ---- GPU sampling ----

// Starts nvidia-smi, which prints GPU use (%) and memory used (MiB) once a second.
function startGpuSampler() {
  const samples = [];
  const child = spawn('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits', '-lms', '1000']);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const [util, mem] = line.split(',').map((part) => Number(part.trim()));
      if (Number.isFinite(util) && Number.isFinite(mem)) samples.push({ t: Date.now(), util, mem });
    }
  });
  child.on('error', (error) => log('nvidia-smi could not start:', error.message));
  return { samples, stop: () => child.kill() };
}

function summarizeGpu(samples) {
  if (samples.length === 0) return null;
  const utils = samples.map((s) => s.util);
  const mems = samples.map((s) => s.mem);
  const avg = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  return { samples: samples.length, utilAvg: avg(utils), utilMax: Math.max(...utils), memAvgMiB: avg(mems), memMaxMiB: Math.max(...mems) };
}

function ollamaPs() {
  try { return execSync('ollama ps', { encoding: 'utf8', timeout: 30000 }); } catch (error) { return `ollama ps failed: ${error.message}`; }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- The run ----

const client = createOllamaClient();
const meta = { label, N, variant, model: client.model, dataset: 'research/model-test/dataset.json', items: items.length };

// 1. GPU while idle (model not loaded yet), 8 s.
let sampler = startGpuSampler();
await sleep(8000);
sampler.stop();
meta.gpuIdleBeforeLoad = summarizeGpu(sampler.samples);

// 2. Load the model (not timed as part of the run).
const version = await client.checkReady();
meta.ollamaVersion = version.version;
const loadStart = Date.now();
await client.askOnce(promptFor(items[0]));
meta.loadSeconds = (Date.now() - loadStart) / 1000;
meta.ollamaPsStart = ollamaPs();
log(`loaded in ${meta.loadSeconds.toFixed(1)} s\n${meta.ollamaPsStart}`);

// 3. GPU with the model loaded but idle, 5 s.
sampler = startGpuSampler();
await sleep(5000);
sampler.stop();
meta.gpuIdleModelLoaded = summarizeGpu(sampler.samples);

// 4. N workers take the next headline until none are left.
const rows = new Array(items.length);
let next = 0;
let requestErrors = 0;
async function worker() {
  while (next < items.length) {
    const index = next++;
    const item = items[index];
    const start = Date.now();
    let row;
    try {
      const result = await client.classifyArticle(null, { promptText: promptFor(item) });
      row = { id: item.id, ok: result.ok, relevant: result.ok ? result.relevant : null, sentiment: result.ok ? result.sentiment : null, tries: result.tries, error: result.ok ? null : result.error, thinkingChars: result.thinkingChars ?? 0 };
    } catch (error) {
      requestErrors += 1;
      row = { id: item.id, ok: false, relevant: null, sentiment: null, tries: 0, error: `request failed: ${error.message}` };
      log('request error on item', item.id, error.message);
    }
    row.seconds = (Date.now() - start) / 1000;
    rows[index] = row;
    const done = rows.filter(Boolean).length;
    if (done % 100 === 0) log(`${done}/${items.length}`);
  }
}

sampler = startGpuSampler();
const runStart = Date.now();
await Promise.all(Array.from({ length: N }, () => worker()));
meta.wallSeconds = (Date.now() - runStart) / 1000;
sampler.stop();
meta.gpuDuringRun = summarizeGpu(sampler.samples);
meta.ollamaPsEnd = ollamaPs();
meta.articlesPerSecond = items.length / meta.wallSeconds;
meta.requestErrors = requestErrors;
meta.invalidAfterRetry = rows.filter((r) => !r.ok && r.tries > 0).length;
meta.retriedItems = rows.filter((r) => r.tries > 1).length;
meta.thinkingItems = rows.filter((r) => (r.thinkingChars ?? 0) > 0).length;
const sorted = rows.map((r) => r.seconds).sort((a, b) => a - b);
meta.latencyP50 = sorted[Math.floor(sorted.length * 0.5)];
meta.latencyP95 = sorted[Math.floor(sorted.length * 0.95)];
meta.finishedAt = new Date().toISOString();

writeFileSync(here(`./raw/${label}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(here(`./raw/${label}.meta.json`), JSON.stringify(meta, null, 1));
log(`done: ${meta.wallSeconds.toFixed(1)} s, ${meta.articlesPerSecond.toFixed(2)} articles/s, GPU avg ${meta.gpuDuringRun?.utilAvg.toFixed(0)}% max mem ${meta.gpuDuringRun?.memMaxMiB} MiB, errors ${requestErrors}, invalid ${meta.invalidAfterRetry}`);

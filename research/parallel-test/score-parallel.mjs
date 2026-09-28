// score-parallel.mjs — scores every run of the parallel-throughput test and prints the tables.
//
// Reads raw/<label>.jsonl + raw/<label>.meta.json (written by run-parallel.mjs) and the reference
// labels in research/model-test/dataset.json. Scores like research/model-test/score.mjs: an answer
// that failed is counted as "not relevant", because the pipeline would not store it.
// Agreement = share of headlines with the same answer as the first N=1 run (n1-new-a).
// Usage: node score-parallel.mjs <label> [<label> ...]   → prints Markdown tables to stdout.

import { readFileSync } from 'node:fs';

const here = (file) => new URL(file, import.meta.url);
const dataset = JSON.parse(readFileSync(here('../model-test/dataset.json'), 'utf8'));
const byId = new Map(dataset.items.map((item) => [item.id, item]));
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : 'n/a');
const div = (a, b) => (b === 0 ? NaN : a / b);

function load(label) {
  const rows = readFileSync(here(`./raw/${label}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const meta = JSON.parse(readFileSync(here(`./raw/${label}.meta.json`), 'utf8'));
  return { label, rows, meta, byId: new Map(rows.map((r) => [r.id, r])) };
}

function relevanceStats(rows) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const ref = byId.get(r.id).ref_relevant;
    const pred = r.ok ? r.relevant : false;
    if (pred && ref) tp++; else if (pred && !ref) fp++; else if (!pred && ref) fn++; else tn++;
  }
  return { tp, fp, fn, tn, precision: div(tp, tp + fp), recall: div(tp, tp + fn) };
}

function sentimentStats(rows) {
  const labels = ['positive', 'neutral', 'negative'];
  const both = rows.filter((r) => r.ok && r.relevant && byId.get(r.id).ref_relevant);
  let correct = 0;
  const counts = Object.fromEntries(labels.map((l) => [l, { tp: 0, fp: 0, fn: 0 }]));
  for (const r of both) {
    const ref = byId.get(r.id).ref_sentiment;
    if (r.sentiment === ref) { correct++; counts[ref].tp++; } else { counts[ref].fn++; if (r.sentiment) counts[r.sentiment].fp++; }
  }
  const f1 = labels.map((l) => { const { tp, fp, fn } = counts[l]; const p = div(tp, tp + fp), rc = div(tp, tp + fn); return tp === 0 ? 0 : (2 * p * rc) / (p + rc); });
  return { accuracy: div(correct, both.length), macroF1: f1.reduce((a, b) => a + b, 0) / 3 };
}

// Share of headlines where two runs gave the same relevance, and the same relevance + sentiment.
function agreement(run, baseline) {
  let sameRelevance = 0, sameAnswer = 0;
  for (const r of run.rows) {
    const b = baseline.byId.get(r.id);
    if (!b) continue;
    if (r.relevant === b.relevant) sameRelevance++;
    if (r.relevant === b.relevant && r.sentiment === b.sentiment) sameAnswer++;
  }
  return { relevance: sameRelevance / run.rows.length, full: sameAnswer / run.rows.length };
}

function processorOf(ps) {
  const line = (ps ?? '').split('\n')[1] ?? '';
  return { size: line.match(/(\d+(\.\d+)? GB)/)?.[1] ?? 'n/a', processor: line.match(/(\d+%\/\d+% CPU\/GPU|\d+% [CG]PU)/)?.[1] ?? 'n/a' };
}

const runs = process.argv.slice(2).map(load);
const baseline = runs.find((r) => r.label === 'n1-new-a') ?? runs[0];

const out = [];
out.push('| Run | N | Prompt | Total time | Articles/s | Speed-up vs N=1 | p50 / p95 s per article | Request errors | Invalid after retry | Retried | GPU use avg / max | GPU memory max (whole card) | Model size + where (ollama ps) | Same answer as N=1 (relevance / full) | Rel. precision | Rel. recall | Sent. accuracy | Sent. macro-F1 |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const run of runs) {
  const m = run.meta;
  const rel = relevanceStats(run.rows);
  const sent = sentimentStats(run.rows);
  const agree = agreement(run, baseline);
  const where = processorOf(m.ollamaPsEnd);
  out.push(`| ${run.label} | ${m.N} | ${m.variant} | ${m.wallSeconds.toFixed(0)} s | ${m.articlesPerSecond.toFixed(2)} | ${(m.articlesPerSecond / baseline.meta.articlesPerSecond).toFixed(2)}× | ${m.latencyP50.toFixed(2)} / ${m.latencyP95.toFixed(2)} | ${m.requestErrors} | ${m.invalidAfterRetry} | ${m.retriedItems} | ${m.gpuDuringRun.utilAvg.toFixed(0)}% / ${m.gpuDuringRun.utilMax}% | ${(m.gpuDuringRun.memMaxMiB / 1024).toFixed(1)} GB | ${where.size}, ${where.processor} | ${pct(agree.relevance)} / ${pct(agree.full)} | ${pct(rel.precision)} (${rel.fp} FP) | ${pct(rel.recall)} (${rel.fn} FN) | ${pct(sent.accuracy)} | ${pct(sent.macroF1)} |`);
}
out.push('');
out.push('| Run | GPU use, idle before the model loads (other programs) | GPU memory, idle before load | GPU use, model loaded but idle | GPU memory, model loaded |');
out.push('|---|---|---|---|---|');
for (const run of runs) {
  const m = run.meta;
  out.push(`| ${run.label} | ${m.gpuIdleBeforeLoad.utilAvg.toFixed(0)}% | ${(m.gpuIdleBeforeLoad.memAvgMiB / 1024).toFixed(1)} GB | ${m.gpuIdleModelLoaded.utilAvg.toFixed(0)}% | ${(m.gpuIdleModelLoaded.memAvgMiB / 1024).toFixed(1)} GB |`);
}
console.log(out.join('\n'));

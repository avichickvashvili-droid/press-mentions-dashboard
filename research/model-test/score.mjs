// Scores every results/<model>.jsonl against the reference labels in dataset.json
// and writes summary.md with all the tables.
// Usage: node score.mjs <model> [<model> ...]   (order = table order)
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';

const BACKFILL = 20000;
const ds = JSON.parse(readFileSync(new URL('./dataset.json', import.meta.url), 'utf8'));
const items = ds.items;
const byId = new Map(items.map((i) => [i.id, i]));
const companies = [...new Set(items.map((i) => i.company))];
const safe = (m) => m.replace(/[:/]/g, '_');
const pct = (x) => (x == null || Number.isNaN(x) ? 'n/a' : (100 * x).toFixed(1) + '%');
const f2 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : x.toFixed(2));
const div = (a, b) => (b === 0 ? NaN : a / b);
const dur = (s) => {
  if (!Number.isFinite(s)) return 'n/a';
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(1)} h`;
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function relStats(rows) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const ref = byId.get(r.id).ref_relevant;
    const pred = r.ok ? r.relevant : false; // a failed answer means the item would not be stored
    if (pred && ref) tp++; else if (pred && !ref) fp++; else if (!pred && ref) fn++; else tn++;
  }
  const p = div(tp, tp + fp), rc = div(tp, tp + fn);
  return { tp, fp, fn, tn, precision: p, recall: rc, f1: div(2 * p * rc, p + rc), accuracy: div(tp + tn, rows.length) };
}

function sentStats(rows) {
  const labels = ['positive', 'neutral', 'negative'];
  const both = rows.filter((r) => r.ok && r.relevant && byId.get(r.id).ref_relevant);
  let correct = 0, nullSent = 0;
  const cm = Object.fromEntries(labels.map((l) => [l, { tp: 0, fp: 0, fn: 0 }]));
  for (const r of both) {
    const ref = byId.get(r.id).ref_sentiment, pred = r.sentiment;
    if (pred == null) nullSent++;
    if (pred === ref) { correct++; cm[ref].tp++; } else { cm[ref].fn++; if (pred) cm[pred].fp++; }
  }
  const f1s = labels.map((l) => { const { tp, fp, fn } = cm[l]; const p = div(tp, tp + fp), r = div(tp, tp + fn); return tp === 0 ? 0 : (2 * p * r) / (p + r); });
  return { n: both.length, accuracy: div(correct, both.length), macroF1: f1s.reduce((a, b) => a + b, 0) / 3, nullSent };
}

function loadModel(model) {
  const f = new URL(`./results/${safe(model)}.jsonl`, import.meta.url);
  if (!existsSync(f)) return null;
  const seen = new Map();
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); seen.set(r.id, r); } catch { /* skip partial line */ }
  }
  const rows = [...seen.values()];
  const metaF = new URL(`./results/${safe(model)}.meta.json`, import.meta.url);
  const meta = existsSync(metaF) ? JSON.parse(readFileSync(metaF, 'utf8')) : { segments: [] };
  const segs = meta.segments.filter((s) => s.loop_wall_s != null);
  const loopS = segs.reduce((a, s) => a + s.loop_wall_s, 0);
  const firstValid = rows.filter((r) => r.attempts[0] && !r.attempts[0].error).length;
  const proc = (meta.segments[0]?.ollama_ps ?? '').split('\n')[1]?.match(/(\d+%\/\d+% CPU\/GPU|\d+% [CG]PU)/)?.[1] ?? 'n/a';
  const size = (meta.segments[0]?.ollama_ps ?? '').split('\n')[1]?.match(/(\d+(\.\d+)? GB)/)?.[1] ?? 'n/a';
  const rel = relStats(rows), sent = sentStats(rows);
  const perCompany = Object.fromEntries(companies.map((c) => [c, relStats(rows.filter((r) => byId.get(r.id).company === c))]));
  const rate = div(rows.length, loopS);
  return {
    model, rows, meta, n: rows.length, complete: rows.length === items.length, rel, sent, perCompany,
    validFirst: div(firstValid, rows.length), validFinal: div(rows.filter((r) => r.ok).length, rows.length),
    retries: rows.reduce((a, r) => a + r.retries, 0), failures: rows.filter((r) => !r.ok).length,
    loadS: meta.segments[0]?.load_wall_s, loopS, rate, medianS: median(rows.map((r) => r.seconds)),
    backfillS: BACKFILL / rate, proc, size, think: meta.think, segments: meta.segments.length,
  };
}

const models = process.argv.slice(2);
const res = models.map((m) => loadModel(m) ?? { model: m, missing: true });

const L = [];
L.push('# Model test results', '');
L.push(`Generated ${new Date().toISOString()} by \`score.mjs\`. Dataset: ${items.length} real Google News headlines, 6 companies (see dataset.json).`);
L.push('Reference labels are **AI-made** (Claude), written before any model ran. They are not human labels.', '');
L.push('A failed answer (invalid JSON twice) is scored as "not relevant", because the pipeline would not store it.', '');

L.push('## Dataset', '');
L.push('| Company | Section | Items | Relevant | Irrelevant | Positive | Neutral | Negative |', '|---|---|---|---|---|---|---|---|');
for (const c of companies) {
  const it = items.filter((i) => i.company === c);
  const cnt = (f) => it.filter(f).length;
  L.push(`| ${c} | ${it[0].section} | ${it.length} | ${cnt((i) => i.ref_relevant)} | ${cnt((i) => !i.ref_relevant)} | ${cnt((i) => i.ref_sentiment === 'positive')} | ${cnt((i) => i.ref_sentiment === 'neutral')} | ${cnt((i) => i.ref_sentiment === 'negative')} |`);
}
const cntAll = (f) => items.filter(f).length;
L.push(`| **Total** | | ${items.length} | ${cntAll((i) => i.ref_relevant)} | ${cntAll((i) => !i.ref_relevant)} | ${cntAll((i) => i.ref_sentiment === 'positive')} | ${cntAll((i) => i.ref_sentiment === 'neutral')} | ${cntAll((i) => i.ref_sentiment === 'negative')} |`);
L.push('', `dataset.json size: ${(statSync(new URL('./dataset.json', import.meta.url)).size / 1024).toFixed(0)} KB.`, '');

L.push('## Main table', '');
L.push('| Model | Items done | Rel. precision | Rel. recall | Rel. F1 | Rel. accuracy | Sent. accuracy | Sent. macro-F1 | JSON valid (1st try) | JSON valid (after retry) | Retries | Load time | Total runtime | Articles/s | Median s/article | Est. 20k backfill | Processor (ollama ps) |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of res) {
  if (r.missing) { L.push(`| ${r.model} | not run | | | | | | | | | | | | | | | |`); continue; }
  L.push(`| ${r.model} | ${r.n}${r.complete ? '' : ' (partial)'} | ${pct(r.rel.precision)} | ${pct(r.rel.recall)} | ${pct(r.rel.f1)} | ${pct(r.rel.accuracy)} | ${pct(r.sent.accuracy)} | ${pct(r.sent.macroF1)} | ${pct(r.validFirst)} | ${pct(r.validFinal)} | ${r.retries} | ${dur(r.loadS)} | ${dur(r.loopS)} | ${f2(r.rate)} | ${f2(r.medianS)} | ${dur(r.backfillS)} | ${r.proc} (${r.size}) |`);
}
L.push('', 'Total runtime = wall clock of the classification loop over all items (load time shown separately). Articles/s = items / total runtime. Backfill = 20,000 / articles per second.', '');

L.push('## Relevance confusion counts', '');
L.push('| Model | TP | FP | FN | TN | Sentiment items scored | Relevant answers with null sentiment | Thinking setting |', '|---|---|---|---|---|---|---|---|');
for (const r of res) if (!r.missing) L.push(`| ${r.model} | ${r.rel.tp} | ${r.rel.fp} | ${r.rel.fn} | ${r.rel.tn} | ${r.sent.n} | ${r.sent.nullSent} | ${r.think} |`);
L.push('');

L.push('## Relevance precision per company', '');
L.push('Ambiguous names: Harvey, Astra, Lemonade. Clean names: OpenEvidence, Beyond Meat, Klook.', '');
L.push(`| Model | ${companies.join(' | ')} |`, `|---|${companies.map(() => '---').join('|')}|`);
for (const r of res) if (!r.missing) L.push(`| ${r.model} | ${companies.map((c) => `${pct(r.perCompany[c].precision)} (${r.perCompany[c].fp} FP)`).join(' | ')} |`);
L.push('');
L.push('## Relevance recall per company', '');
L.push(`| Model | ${companies.join(' | ')} |`, `|---|${companies.map(() => '---').join('|')}|`);
for (const r of res) if (!r.missing) L.push(`| ${r.model} | ${companies.map((c) => `${pct(r.perCompany[c].recall)} (${r.perCompany[c].fn} FN)`).join(' | ')} |`);
L.push('');

const qualified = res.filter((r) => !r.missing && r.complete && r.rel.precision >= 0.95).sort((a, b) => b.rate - a.rate);
L.push('## Recommendation rule', '');
L.push('Fastest model with relevance precision >= 95%:', '');
if (qualified.length) L.push(`**${qualified[0].model}** (${pct(qualified[0].rel.precision)} precision, ${f2(qualified[0].rate)} articles/s). All models that pass: ${qualified.map((q) => q.model).join(', ')}.`);
else {
  const best = res.filter((r) => !r.missing).sort((a, b) => b.rel.precision - a.rel.precision)[0];
  L.push(`No model reaches 95%. Closest: **${best?.model}** at ${pct(best?.rel.precision)}.`);
}
L.push('');

L.push('## Errors seen', '');
for (const r of res) {
  if (r.missing) continue;
  const errs = {};
  for (const row of r.rows) for (const a of row.attempts) if (a.error) errs[a.error] = (errs[a.error] ?? 0) + 1;
  L.push(`- ${r.model}: ${Object.keys(errs).length ? Object.entries(errs).map(([k, v]) => `${k} x${v}`).join(', ') : 'none'}; final failures ${r.failures}; run segments ${r.segments}`);
}
writeFileSync(new URL('./summary.md', import.meta.url), L.join('\n') + '\n');
console.log(L.join('\n'));

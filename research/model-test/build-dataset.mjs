// Joins raw-items.json with the hand-written label files into dataset.json.
import { readFileSync, writeFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync('raw-items.json', 'utf8'));
const files = ['harvey', 'openevidence', 'beyondmeat', 'astra', 'lemonade', 'klook'];
const labels = new Map();
for (const f of files) {
  for (const line of readFileSync(`labels-${f}.txt`, 'utf8').split('\n')) {
    const m = line.match(/^(\d+) ([pxn-])(?: (.*))?$/);
    if (!m) { if (line.trim()) throw new Error(`bad label line in ${f}: ${line}`); continue; }
    labels.set(Number(m[1]), { code: m[2], note: m[3] ?? null });
  }
}
const SENT = { p: 'positive', x: 'neutral', n: 'negative', '-': null };
const DESC = {
  Harvey: 'Legal AI startup that builds generative AI tools for law firms and legal teams.',
  OpenEvidence: 'Medical AI company whose search and chat tool answers doctors\' clinical questions from medical literature.',
  'Beyond Meat': 'US maker of plant-based meat products (burgers, sausages, steak), listed on Nasdaq as BYND.',
  Astra: 'US space company (Astra Space) that builds small launch rockets and spacecraft engines.',
  Lemonade: 'US insurtech company selling renters, home, pet, car and life insurance through an app, listed as LMND.',
  Klook: 'Asia-based online travel platform for booking tours, attractions and travel experiences.',
};
const QUERY = JSON.parse(readFileSync('queries.json', 'utf8'));
const out = raw.map((it) => {
  const l = labels.get(it.id);
  if (!l) throw new Error(`missing label for id ${it.id}`);
  return { ...it, description: DESC[it.company], ref_relevant: l.code !== '-', ref_sentiment: SENT[l.code], label_note: l.note };
});
if (labels.size !== raw.length) throw new Error(`labels ${labels.size} != items ${raw.length}`);
writeFileSync('dataset.json', JSON.stringify({
  created: new Date().toISOString(),
  note: 'Reference labels are AI-made (Claude), written before any model ran. See labeling-rules.md.',
  queries: QUERY, items: out }, null, 1));
const by = {};
for (const x of out) {
  const b = (by[x.company] ??= { section: x.section, items: 0, relevant: 0, irrelevant: 0, positive: 0, neutral: 0, negative: 0 });
  b.items++; x.ref_relevant ? b.relevant++ : b.irrelevant++; if (x.ref_sentiment) b[x.ref_sentiment]++;
}
console.table(by);

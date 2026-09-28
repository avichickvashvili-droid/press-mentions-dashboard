// Fetches one Google News RSS search per company and saves the raw items.
// Usage: node fetch-dataset.mjs probe   -> prints item counts for candidate queries
//        node fetch-dataset.mjs build   -> writes raw-items.json for the chosen companies
import { writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull text out of a tag, handling CDATA and basic entities.
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([^]*?)</${name}>`));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export async function search(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  for (let attempt = 0; attempt < 5; attempt++) {
    let res;
    try { res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }); }
    catch (e) { console.error('network error', e.message); await sleep(5000 * (attempt + 1)); continue; }
    if (res.status === 429 || res.status >= 500) {
      const wait = 10000 * 2 ** attempt; console.error(`HTTP ${res.status}, waiting ${wait} ms`); await sleep(wait); continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${query}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
      const publisher = tag(it, 'source');
      let title = tag(it, 'title');
      const suffix = ` - ${publisher}`;
      if (publisher && title.endsWith(suffix)) title = title.slice(0, -suffix.length);
      return { title, publisher, pubDate: tag(it, 'pubDate'), guid: tag(it, 'guid'), link: tag(it, 'link') };
    });
    return items;
  }
  throw new Error('gave up after retries: ' + query);
}

const mode = process.argv[2];
const specs = JSON.parse(process.argv[3] ?? '[]');
const out = [];
for (const s of specs) {
  try {
    const items = await search(s.query);
    console.log(`${items.length}\t${s.company}\t${s.query}`);
    if (mode === 'build') for (const it of items) out.push({ company: s.company, section: s.section, ...it });
    if (mode === 'probe') console.log(items.slice(0, 8).map((i) => '   - ' + i.title).join('\n'));
  } catch (e) { console.error('FAILED', s.company, e.message); }
  await sleep(1500);
}
if (mode === 'build') { writeFileSync('raw-items.json', JSON.stringify(out, null, 1)); console.log('saved', out.length); }

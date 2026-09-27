// itemRules.js — checks each article from Google News before it may enter the queue.
//
// Where it sits: between the Google News client and the BufferQueue writer (D55).
// Reads/writes: nothing (pure checks).
//
// Rules:
//  - An item without guid, link, title or a readable date is skipped and logged
//    (the company does not fail because of one bad item).
//  - An item dated outside the run's 90 days is dropped.
//  - The whole headline is kept as Google gives it ("Headline - Publisher"). The
//    " - Publisher" ending is removed only when comparing titles for the D33 duplicate check
//    (stripPublisherSuffix in src/shared/text.js, used by bufferWriter.js).

import { dayNumberOf, isInsideRange } from './dateWindows.js';

// Checks one raw item and turns it into a row ready for the queue.
// Returns { ok: true, item } or { ok: false, reason } (reason says which field is missing).
export function prepareItem(rawItem) {
  const missing = [];
  if (!rawItem.guid) missing.push('guid');
  if (!rawItem.link) missing.push('link');
  if (!rawItem.title) missing.push('title');
  const publishedMs = rawItem.pubDate ? Date.parse(rawItem.pubDate) : Number.NaN;
  if (Number.isNaN(publishedMs)) missing.push('readable date');
  if (missing.length > 0) {
    return { ok: false, reason: `missing ${missing.join(', ')}` };
  }
  return {
    ok: true,
    item: {
      guid: rawItem.guid,
      url: rawItem.link,
      title: rawItem.title,
      publisher: rawItem.publisher ? rawItem.publisher : null,
      published_at: new Date(publishedMs).toISOString(),
    },
  };
}

// Sorts a search result into: items to store, bad items (with reasons) and items outside
// the 90 days. Returns { good, bad: [{ rawItem, reason }], outside: count }.
export function sortItems(rawItems, range) {
  const good = [];
  const bad = [];
  let outside = 0;
  for (const rawItem of rawItems) {
    const result = prepareItem(rawItem);
    if (!result.ok) {
      bad.push({ rawItem, reason: result.reason });
      continue;
    }
    if (!isInsideRange(dayNumberOf(result.item.published_at), range)) {
      outside += 1;
      continue;
    }
    good.push(result.item);
  }
  return { good, bad, outside };
}

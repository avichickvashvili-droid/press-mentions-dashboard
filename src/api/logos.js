// logos.js — which company has a logo, and its address on the dashboard (owner, Prompt 318, D112).
//
// Where it sits: used by src/api/app.js. The logos were collected once by an agent into
// web/public/logos/ (config LOGOS_DIR) with a list, logos.json:
//   { "<company id>": { "file": "<id>.png", "domain", "source", "confidence" } | null, ... }
// Reads: logos.json. Writes: nothing.
//
// A missing or broken logos.json is not an error for the page: every company then gets
// logoUrl null and the page shows a letter badge instead. Only plain image file names are
// accepted (no folders, no "..", only image extensions), so the list can't point outside the folder.

import fs from 'node:fs';
import path from 'node:path';

export const LOGO_LIST_FILE = 'logos.json';

// A logo file name that is safe to serve: letters, digits, "-", "_", "." and an image extension.
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]*\.(png|svg|ico|jpg|jpeg|webp|gif)$/i;

// Reads logos.json in `dir`. Returns a Map: company id -> "/logos/<file>" (only companies with
// a usable file that really exists). `logError(text)` is told once when the list can't be read.
export function readLogoUrls(dir, { logError = () => {} } = {}) {
  const urls = new Map();
  let list;
  try {
    list = JSON.parse(fs.readFileSync(path.join(dir, LOGO_LIST_FILE), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') logError(`WARNING: the logo list ${path.join(dir, LOGO_LIST_FILE)} could not be read (${error.message}); letter badges are shown instead.`);
    return urls;
  }
  if (!list || typeof list !== 'object') return urls;
  for (const [id, entry] of Object.entries(list)) {
    const file = entry?.file;
    if (typeof file !== 'string' || !SAFE_FILE.test(file)) continue;
    if (!fs.existsSync(path.join(dir, file))) continue;
    urls.set(id, `/logos/${file}`);
  }
  return urls;
}

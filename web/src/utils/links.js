// links.js — decides whether a mention's address may become a link on the page (NFR10).
//
// Where it sits: used by MentionsPanel.jsx for each headline. The import already refuses any
// other address (src/api/importData.js); this is the second line of defence for data that got
// into the database another way. The stored address is never changed, only how it is shown.
// Reads/writes: nothing.

// True only for a web address (http or https). Anything else (data:, file:, javascript:, a
// broken address) is shown as plain text, never as a link.
export function isWebAddress(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false; // not an address at all
  }
}

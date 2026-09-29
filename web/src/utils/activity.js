// activity.js — the words of the Recent activity column: "32 this week" and the change against
// the week before, "↑ 13 vs prev week (+68%)" (owner, Prompts 317-322, D110).
//
// Where it sits: used by the ActivityCell in the company table.
// Reads/writes: nothing.
//
// The % is shown only when the week before had at least PERCENT_MIN_PREVIOUS mentions (owner,
// Prompt 318): from 3 to 12 is "↑ 9", not a misleading "+300%".

export const PERCENT_MIN_PREVIOUS = 10;

// Formats a whole number with thousands commas: 1243 -> "1,243".
export function formatCount(n) {
  return Number(n ?? 0).toLocaleString('en-US');
}

// The change between this week (`week`) and the week before (`previous`):
//   { direction: 'up' | 'down' | 'same' | 'none', text }
// 'none' = no mention in either week (nothing to compare; text is '').
export function describeChange(week, previous) {
  const thisWeek = week ?? 0;
  const before = previous ?? 0;
  if (thisWeek === 0 && before === 0) return { direction: 'none', text: '' };
  const change = thisWeek - before;
  if (change === 0) return { direction: 'same', text: 'same as prev week' };
  const percent = before >= PERCENT_MIN_PREVIOUS ? ` (${change > 0 ? '+' : '−'}${Math.round((Math.abs(change) / before) * 100)}%)` : '';
  return {
    direction: change > 0 ? 'up' : 'down',
    text: `${change > 0 ? '↑' : '↓'} ${formatCount(Math.abs(change))} vs prev week${percent}`,
  };
}

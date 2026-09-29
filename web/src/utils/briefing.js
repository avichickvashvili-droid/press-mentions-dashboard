// briefing.js — the one-line briefing at the top of the page (owner, Prompts 367-369, D118):
// "This week: 1,664 mentions ↑ 57% vs last week. Anthropic leads with 536, SpaceX follows with
// 487. EquipmentShare turned 85% negative, and OpenEvidence spiked +475%."
//
// Where it sits: used by the Hero. A pure function (no React), so the tests check the words.
// Reads: the company list (weekCount / prevWeekCount = the last 7 days and the 7 before, D110) and
// the overview's "needs attention" items (D117).
//
// It returns parts, not one string, so the Hero can make the company names clickable:
//   { text }          plain words
//   { strong }        a number in bold
//   { up } / { down } / { negative }   a coloured change
//   { company: { id, name } }          a company name (a button)

import { formatCount } from './activity.js';
import { percentChange } from './overview.js';

// `companies` = the company list; `attention` = the overview's attention list (or []).
export function buildBriefing(companies, attention = []) {
  const parts = [];
  const text = (t) => parts.push({ text: t });
  const week = companies.reduce((sum, c) => sum + (c.weekCount ?? 0), 0);
  const previous = companies.reduce((sum, c) => sum + (c.prevWeekCount ?? 0), 0);

  if (week === 0) {
    text('A quiet week: no new mentions in the last 7 days.');
    return parts;
  }

  // 1. The week's total and its change.
  text('This week: ');
  parts.push({ strong: `${formatCount(week)} mentions` });
  const change = percentChange(week, previous);
  if (change.direction !== 'same' && change.percent !== null) {
    text(' ');
    parts.push(change.direction === 'up' ? { up: `↑ ${change.percent}%` } : { down: `↓ ${change.percent}%` });
    text(' vs last week.');
  } else {
    text('.');
  }

  // 2. Who leads this week.
  const leaders = companies.filter((c) => c.weekCount > 0).sort((a, b) => b.weekCount - a.weekCount || a.name.localeCompare(b.name)).slice(0, 2);
  if (leaders.length) {
    text(' ');
    parts.push({ company: { id: leaders[0].id, name: leaders[0].name } });
    text(' leads with ');
    parts.push({ strong: formatCount(leaders[0].weekCount) });
    if (leaders[1]) {
      text(', ');
      parts.push({ company: { id: leaders[1].id, name: leaders[1].name } });
      text(' follows with ');
      parts.push({ strong: formatCount(leaders[1].weekCount) });
    }
    text('.');
  }

  // 3. What stands out: the strongest negative week and the strongest spike (if any).
  const negative = attention.find((a) => a.kind === 'negative');
  // A spike with a % reads better than one from nothing, so it comes first.
  const spike = attention.find((a) => a.kind === 'spike' && a.value !== null) ?? attention.find((a) => a.kind === 'spike');
  const notes = [];
  if (negative) notes.push([{ company: { id: negative.companyId, name: negative.name } }, { text: ' turned ' }, { negative: `${negative.value}% negative` }]);
  if (spike) {
    notes.push(spike.value === null
      ? [{ company: { id: spike.companyId, name: spike.name } }, { text: ' jumped to ' }, { strong: formatCount(spike.week) }, { text: ' mentions from none' }]
      : [{ company: { id: spike.companyId, name: spike.name } }, { text: ' spiked ' }, { up: `+${formatCount(spike.value)}%` }]);
  }
  notes.forEach((note, index) => {
    text(index === 0 ? ' ' : ', and ');
    parts.push(...note);
  });
  if (notes.length) text('.');
  return parts;
}

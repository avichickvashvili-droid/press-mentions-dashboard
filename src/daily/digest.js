// digest.js — builds the daily Discord message(s) (D105, Prompts 293–294). Pure: no network,
// no database, so every case is easy to test.
//
// Where it sits: dailyJob.js gives it the new mentions per company (from dailyStore.js) and sends
// what it returns with discord.js.
// Reads/writes: nothing.
//
// A day with new mentions (the lean digest): one embed, title "📰 New press mentions · Tue 29 Sep"
// (the day the message is sent, in DAILY_TIMEZONE), then EVERY company with new mentions, one
// line each, most first (ties by name): bold name · count, then always all three 🟢 positive /
// ⚪ neutral / 🔴 negative counts, zeros too. At the end: "**N** new · Open the dashboard ↗".
// A long list goes on in more messages ("(2/3)" in the title), because Discord allows at most
// 4,096 characters of text in one; the total and the link are in the last one. Each message
// carries the ids of the mentions it lists, so they are marked alerted only when THAT message
// was accepted.
// A day with nothing new still gets a short, friendly message, so you know the job ran.
// A problem (buildProblemMessage, owner decision B): "⚠️ Daily job problem · Tue 29 Sep", what is
// wrong, and whether it keeps trying or waits for the next scheduled run.
// Company names come from our list, but they are escaped anyway, so a character like * or _
// can't change the formatting, and `allowed_mentions` is empty, so nobody is ever pinged.

import { config } from '../config.js';

// The line above and below the company list.
const DIVIDER = '━━━━━━━━━━━━━━';

// The date in the title, e.g. "Tue 29 Sep", in the given time zone.
export function formatTitleDate(date, timeZone = config.DAILY_TIMEZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

// The time of day of a simple daily cron ("0 3 * * *" → "03:00"), or null for any other form.
export function describeCronTime(cron = config.DAILY_CRON) {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(String(cron).trim());
  if (!match) return null;
  return `${match[2].padStart(2, '0')}:${match[1].padStart(2, '0')}`;
}

// Escapes the characters that Discord reads as formatting, so a name is shown as written.
export function escapeMarkdown(text) {
  return String(text).replace(/[\\*_~`|<>[\]()]/g, '\\$&');
}

// Formats a whole number with thousands separators (1234 → "1,234").
function formatNumber(value) {
  return value.toLocaleString('en-US');
}

// One company's line: "**CarDekho** · 2   🟢 1  ⚪ 1  🔴 0". All three circles are always shown,
// in the order 🟢 ⚪ 🔴, zeros too: when a 0 was left out, the total looked like one more count
// without a circle (owner, Prompt 325).
export function companyLine(company) {
  const maxChars = config.DISCORD_MAX_NAME_CHARS; // a safety net: one line must always fit in a message
  const name = company.name.length > maxChars ? `${company.name.slice(0, maxChars - 1)}…` : company.name;
  const counts = [['🟢', company.positive], ['⚪', company.neutral], ['🔴', company.negative]]
    .map(([icon, count]) => `${icon} ${formatNumber(count)}`)
    .join('  ');
  return `**${escapeMarkdown(name)}** · ${formatNumber(company.total)}   ${counts}`;
}

// One Discord message (the webhook's JSON body) with one embed.
function payload(title, description, color) {
  return { embeds: [{ color, title, description }], allowed_mentions: { parse: [] } };
}

// Builds the message(s) of one daily run.
//   companies        [{ name, total, positive, neutral, negative, mentionIds }], most first
//                    (summarizeByCompany in dailyStore.js); empty = a quiet day
//   companiesInList  how many companies are watched (for the quiet-day message)
//   sentAt           when the message is sent (the date in the title)
// Returns [{ payload, mentionIds }] in the order to send them.
export function buildDigestMessages({
  companies,
  companiesInList,
  sentAt = new Date(),
  timeZone = config.DAILY_TIMEZONE,
  dashboardUrl = config.DASHBOARD_URL,
  maxTextChars = config.DISCORD_MAX_TEXT_CHARS,
  color = config.DISCORD_COLOR,
  cron = config.DAILY_CRON,
}) {
  const day = formatTitleDate(new Date(sentAt), timeZone);
  const link = `[Open the dashboard ↗](${dashboardUrl})`;

  if (companies.length === 0) {
    const time = describeCronTime(cron);
    const description = [
      `No new mentions for your ${formatNumber(companiesInList)} companies today.`,
      `The daily job ran fine 🐾 and will check again tomorrow${time ? ` at ${time}` : ''}.`,
      DIVIDER,
      link,
    ].join('\n');
    return [{ payload: payload(`☕ All quiet on the press front · ${day}`, description, color), mentionIds: [] }];
  }

  // Splits the lines into messages that each fit (the total + link go in the last one).
  const totalNew = companies.reduce((sum, company) => sum + company.total, 0);
  const footer = `${DIVIDER}\n**${formatNumber(totalNew)}** new · ${link}`;
  const pages = [];
  let current = { lines: [], mentionIds: [] };
  for (const company of companies) {
    const line = companyLine(company);
    const textIfAdded = [DIVIDER, ...current.lines, line, footer].join('\n');
    if (current.lines.length > 0 && textIfAdded.length > maxTextChars) {
      pages.push(current);
      current = { lines: [], mentionIds: [] };
    }
    current.lines.push(line);
    current.mentionIds.push(...company.mentionIds);
  }
  pages.push(current);

  return pages.map((page, index) => {
    const last = index === pages.length - 1;
    const part = pages.length > 1 ? ` (${index + 1}/${pages.length})` : '';
    const description = [DIVIDER, ...page.lines, last ? footer : DIVIDER].join('\n');
    return { payload: payload(`📰 New press mentions · ${day}${part}`, description, color), mentionIds: page.mentionIds };
  });
}

// The "Daily job problem" message (owner decision B, Prompt 298). `problem` = what is wrong, in
// plain words (never the webhook address); `keepsTrying` = true while the job still retries,
// false when it waits for the next scheduled run. Returns the webhook JSON body.
export function buildProblemMessage({
  problem,
  keepsTrying,
  sentAt = new Date(),
  timeZone = config.DAILY_TIMEZONE,
  color = config.DISCORD_PROBLEM_COLOR,
  cron = config.DAILY_CRON,
  maxTextChars = config.DISCORD_MAX_TEXT_CHARS,
}) {
  const time = describeCronTime(cron);
  const next = keepsTrying
    ? 'It keeps trying by itself; you get the normal message once it is through.'
    : `It tries again at the next scheduled run${time ? ` (${time})` : ''}. Check the daily job's window or daily.log.`;
  const text = String(problem).slice(0, maxTextChars - next.length - 10);
  return payload(`⚠️ Daily job problem · ${formatTitleDate(new Date(sentAt), timeZone)}`, `${text}\n\n${next}`, color);
}

// digest.test.js — the Discord message(s) of a daily run (src/daily/digest.js, D105, Prompts 293–294):
// the lean digest, every company listed, long lists split into more messages, the quiet-day
// message, the title date, and names that can't change the formatting. Pure: no network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestMessages, companyLine, describeCronTime, escapeMarkdown, formatTitleDate } from '../../src/daily/digest.js';

// 29 Sep 2026, 01:00 Israel time (the job at 03:00 is 00:00 UTC in summer; here a bit earlier).
const SENT_AT = new Date('2026-09-28T22:00:00.000Z');
const URL = 'http://localhost:3000';

// A company summary like summarizeByCompany returns.
function company(name, positive, neutral, negative, firstId = 1) {
  const total = positive + neutral + negative;
  return { name, total, positive, neutral, negative, mentionIds: Array.from({ length: total }, (_, i) => firstId + i) };
}

test('a day with new mentions: the lean digest (title, one line per company, total and link)', () => {
  const messages = buildDigestMessages({
    companies: [company('Anthropic', 6, 7, 1, 1), company('BeeHero', 2, 1, 0, 100)],
    companiesInList: 258, sentAt: SENT_AT, dashboardUrl: URL,
  });
  assert.equal(messages.length, 1);
  const { payload, mentionIds } = messages[0];
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].title, '📰 New press mentions · Tue 29 Sep');
  assert.equal(payload.embeds[0].description, [
    '━━━━━━━━━━━━━━',
    '**Anthropic** · 14   🟢 6  ⚪ 7  🔴 1',
    '**BeeHero** · 3   🟢 2  ⚪ 1',
    '━━━━━━━━━━━━━━',
    '**17** new · [Open the dashboard ↗](http://localhost:3000)',
  ].join('\n'));
  assert.equal(mentionIds.length, 17);
});

test('the title date is the day the message is sent, in Israel time', () => {
  assert.equal(formatTitleDate(new Date('2026-09-28T22:00:00.000Z'), 'Asia/Jerusalem'), 'Tue 29 Sep');
  assert.equal(formatTitleDate(new Date('2026-09-28T22:00:00.000Z'), 'UTC'), 'Mon 28 Sep');
});

test('a quiet day still gets a short friendly message, so you know the job ran', () => {
  const [message] = buildDigestMessages({ companies: [], companiesInList: 258, sentAt: SENT_AT, dashboardUrl: URL, cron: '0 3 * * *' });
  assert.equal(message.payload.embeds[0].title, '☕ All quiet on the press front · Tue 29 Sep');
  assert.equal(message.payload.embeds[0].description, [
    'No new mentions for your 258 companies today.',
    'The daily job ran fine 🐾 and will check again tomorrow at 03:00.',
    '━━━━━━━━━━━━━━',
    '[Open the dashboard ↗](http://localhost:3000)',
  ].join('\n'));
  assert.deepEqual(message.mentionIds, []);
  assert.deepEqual(message.payload.allowed_mentions, { parse: [] });
});

test('every company is listed: a long list goes on in more messages, each under the limit', () => {
  const companies = Array.from({ length: 258 }, (_, i) => company(`Company number ${String(i).padStart(3, '0')}`, 1, 1, 1, i * 3 + 1));
  const messages = buildDigestMessages({ companies, companiesInList: 258, sentAt: SENT_AT, dashboardUrl: URL, maxTextChars: 4000 });
  assert.ok(messages.length > 1);
  const allLines = [];
  messages.forEach((message, index) => {
    const { title, description } = message.payload.embeds[0];
    assert.ok(description.length <= 4000, `message ${index + 1} is ${description.length} characters`);
    assert.equal(title, `📰 New press mentions · Tue 29 Sep (${index + 1}/${messages.length})`);
    const lines = description.split('\n').filter((line) => line.startsWith('**Company'));
    allLines.push(...lines);
    // Each message carries exactly the ids of the companies it lists (3 per company).
    assert.equal(message.mentionIds.length, lines.length * 3);
    const last = index === messages.length - 1;
    assert.equal(description.includes('new · [Open the dashboard'), last);
  });
  assert.equal(allLines.length, 258);
  assert.ok(messages.at(-1).payload.embeds[0].description.includes('**774** new'));
});

test('a line leaves out zero counts, and formats big numbers', () => {
  assert.equal(companyLine({ name: 'OpenEvidence', total: 6, positive: 6, neutral: 0, negative: 0 }), '**OpenEvidence** · 6   🟢 6');
  assert.equal(companyLine({ name: 'Big', total: 1234, positive: 1234, neutral: 0, negative: 0 }), '**Big** · 1,234   🟢 1,234');
});

test('names are escaped: a * or _ in a name can not change the formatting', () => {
  assert.equal(escapeMarkdown('A*B_C~D`E|F<G>H[I](J)\\K'), 'A\\*B\\_C\\~D\\`E\\|F\\<G\\>H\\[I\\]\\(J\\)\\\\K');
  assert.equal(escapeMarkdown('Scale AI'), 'Scale AI');
  assert.equal(companyLine({ name: '**Evil**', total: 1, positive: 1, neutral: 0, negative: 0 }), '**\\*\\*Evil\\*\\*** · 1   🟢 1');
});

test('describeCronTime: a simple daily time, or null', () => {
  assert.equal(describeCronTime('0 3 * * *'), '03:00');
  assert.equal(describeCronTime('30 14 * * *'), '14:30');
  assert.equal(describeCronTime('0 */6 * * *'), null);
});

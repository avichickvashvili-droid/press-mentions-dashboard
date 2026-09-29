// Hero.test.jsx — the top band of every page (D118; takes over the old Header's tests, D113): the
// date, the briefing (words, and names that open a company), the Live pill for each status, the
// daily run's numbers and Discord, the window the api sends (not a fixed 90), no Refresh button,
// and the ticker (each headline a link, the loop's copy hidden from screen readers). Also the
// status and "Today 05:16" rules and the briefing's words on their own.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Hero, formatHeroDate } from './Hero.jsx';
import { headlineOnly } from './Ticker.jsx';
import { buildBriefing } from '../../utils/briefing.js';
import { STALE_AFTER_MS, updateStatus } from '../../utils/updateStatus.js';
import { formatUpdateTime } from '../../utils/dates.js';
import { jsonResponse, makeQueryWrapper, stubFetch } from '../../test/testTools.jsx';

const NOW = Date.parse('2026-09-29T09:00:00.000Z'); // 12:00 in Israel
const LAST_DONE = { id: 2, finishedAt: '2026-09-29T02:16:13.802Z', newMentions: 91, companiesWithUpdates: 14, discordSent: true };
const DONE = { latest: { id: 2, status: 'done', startedAt: '2026-09-29T00:00:00.134Z', finishedAt: LAST_DONE.finishedAt }, lastDone: LAST_DONE };

const c = (id, name, weekCount, prevWeekCount) => ({ id, name, weekCount, prevWeekCount });
const COMPANIES = [c('spacex', 'SpaceX', 487, 315), c('anthropic', 'Anthropic', 536, 319), c('island', 'Island', 23, 0), c('eq', 'EquipmentShare', 13, 0)];
const ATTENTION = [
  { companyId: 'eq', name: 'EquipmentShare', kind: 'negative', value: 85, week: 13, count: 11 },
  { companyId: 'island', name: 'Island', kind: 'spike', value: null, week: 23, prev: 0 },
  { companyId: 'oe', name: 'OpenEvidence', kind: 'spike', value: 475, week: 46, prev: 8 },
];
const RECENT = [
  { id: 2, companyId: 'spacex', companyName: 'SpaceX', title: 'Starship reaches orbit - Sky News', url: 'https://news.google.com/a', publisher: 'Sky News', publishedAt: '2026-09-29T01:00:00.000Z', sentiment: 'positive' },
  { id: 1, companyId: 'spacex', companyName: 'SpaceX', title: 'Fiery end for Starship - Al Jazeera', url: 'https://news.google.com/b', publisher: 'Al Jazeera', publishedAt: '2026-09-29T00:00:00.000Z', sentiment: 'negative' },
];

// Draws the hero with a fake overview answer.
function renderHero(props = {}) {
  stubFetch(() => jsonResponse({ attention: ATTENTION, recent: RECENT, daily: [], totals: {} }));
  const { wrapper } = makeQueryWrapper();
  const onOpenCompany = vi.fn();
  render(
    <Hero title="Overview" briefing companies={COMPANIES} dailyRun={DONE} asOf="2026-09-29T09:00:00.000Z" windowStart="2026-07-01T09:00:00.000Z" windowDays={90} onOpenCompany={onOpenCompany} now={NOW} {...props} />,
    { wrapper },
  );
  return onOpenCompany;
}

describe('Hero', () => {
  it('the date, the title, the pills (Live · update time, the run, Discord, the window) and no Refresh', () => {
    renderHero();
    expect(screen.getByText('Tuesday 29 September')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Last data update' })).toHaveTextContent('Live · updated today 05:16 IST');
    expect(screen.getByText('91 new mentions · 14 companies')).toBeInTheDocument();
    expect(screen.getByText('Discord sent')).toBeInTheDocument();
    expect(screen.getByText('1 Jul 2026 – 29 Sep 2026 · 90 days')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('the briefing: the week, the leaders and what stands out; a name opens the company', async () => {
    const onOpenCompany = renderHero();
    const brief = await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent.includes('spiked'));
    expect(brief).toHaveTextContent('This week: 1,059 mentions ↑ 67% vs last week. Anthropic leads with 536, SpaceX follows with 487. EquipmentShare turned 85% negative, and OpenEvidence spiked +475%.');
    fireEvent.click(within(brief).getByRole('button', { name: 'EquipmentShare' }));
    expect(onOpenCompany).toHaveBeenCalledWith('eq');
  });

  it('the ticker: every headline is a link (without its " - Publisher"), the loop copy is hidden', async () => {
    renderHero();
    const ticker = await screen.findByLabelText('Latest headlines');
    const links = within(ticker).getAllByRole('link');
    expect(links).toHaveLength(2); // the copy has aria-hidden
    expect(links[0]).toHaveTextContent('SpaceX Starship reaches orbit · Sky News');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(headlineOnly('A - Reuters', 'Reuters')).toBe('A');
    expect(headlineOnly('A - Reuters', 'Other')).toBe('A - Reuters');
  });

  it('the window the api sends (30 days), not a fixed 90; a page without a briefing shows its line', () => {
    renderHero({ title: 'Companies', briefing: false, subtitle: 'News coverage of 4 portfolio companies', windowStart: '2026-08-30T09:00:00.000Z', windowDays: 30 });
    expect(screen.getByText('30 Aug 2026 – 29 Sep 2026 · 30 days')).toBeInTheDocument();
    expect(screen.queryByText(/90/)).not.toBeInTheDocument();
    expect(screen.getByText('News coverage of 4 portfolio companies')).toBeInTheDocument();
  });

  it('the Live pill for each status; Discord not sent; no daily run yet', () => {
    renderHero({ dailyRun: { ...DONE, latest: { ...DONE.latest, id: 3, status: 'failed' }, lastDone: { ...LAST_DONE, discordSent: false } } });
    expect(screen.getByRole('status', { name: 'The last daily run failed' })).toHaveTextContent('Last run failed · data from Today 05:16 IST');
    expect(screen.getByText('Discord not sent')).toBeInTheDocument();
  });

  it('no daily run yet: says the data is from the 90-day collection, no run numbers', () => {
    renderHero({ dailyRun: { latest: null, lastDone: null } });
    expect(screen.getByRole('status', { name: 'No daily run yet' })).toHaveTextContent('data from the 90-day collection');
    expect(screen.queryByText(/new mentions ·/)).not.toBeInTheDocument();
  });
});

describe('status, times and briefing words', () => {
  it('the status: ok, running, failed, stale, no run yet', () => {
    expect(updateStatus(DONE, NOW).tone).toBe('ok');
    expect(updateStatus({ ...DONE, latest: { ...DONE.latest, id: 3, status: 'running' } }, NOW).tone).toBe('running');
    expect(updateStatus({ ...DONE, latest: { ...DONE.latest, id: 3, status: 'failed' } }, NOW).tone).toBe('failed');
    expect(updateStatus(DONE, Date.parse(LAST_DONE.finishedAt) + STALE_AFTER_MS + 1).tone).toBe('stale');
    expect(updateStatus({ latest: null, lastDone: null }, NOW).tone).toBe('none');
  });

  it('update times and the date, in Israel time', () => {
    expect(formatUpdateTime('2026-09-29T02:16:00.000Z', 'Asia/Jerusalem', NOW)).toBe('Today 05:16');
    expect(formatUpdateTime('2026-09-28T02:16:00.000Z', 'Asia/Jerusalem', NOW)).toBe('Yesterday 05:16');
    expect(formatUpdateTime('2026-09-26T02:16:00.000Z', 'Asia/Jerusalem', NOW)).toBe('Sat 26 Sep 05:16');
    expect(formatHeroDate(Date.parse('2026-09-29T22:30:00.000Z'))).toBe('Wednesday 30 September'); // after midnight in Israel
  });

  it('briefing: a quiet week; a spike from nothing; no change', () => {
    expect(buildBriefing([c('a', 'A', 0, 5)], [])).toEqual([{ text: 'A quiet week: no new mentions in the last 7 days.' }]);
    const words = (parts) => parts.map((p) => p.text ?? p.strong ?? p.up ?? p.down ?? p.negative ?? p.company.name).join('');
    expect(words(buildBriefing([c('a', 'A', 5, 5)], []))).toBe('This week: 5 mentions. A leads with 5.');
    expect(words(buildBriefing([c('a', 'A', 23, 0)], [ATTENTION[1]]))).toBe('This week: 23 mentions. A leads with 23. Island jumped to 23 mentions from none.');
  });
});

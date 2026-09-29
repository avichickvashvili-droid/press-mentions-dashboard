// App.overview.test.jsx — the Overview page (owner, Prompt 364, D117), through the whole App with a
// fake api: the page opens on the Overview; the number cards (total + trend, companies mentioned,
// the sentiment split, the last daily run); Top companies and its tabs; Needs attention; Recent
// mentions with the sentiment buttons; a company click opens it on the Companies page (and Back
// returns); the side menu; the dark / light switch; an overview error shows Try again.
// The charts are drawn by Recharts, which needs a size: jsdom has none, so only their titles and
// switches are checked here (the pictures are checked in the browser, headless).

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.jsx';
import { COMPANIES_ANSWER, jsonResponse, makeQueryWrapper, stubFetch } from './test/testTools.jsx';

// 91 days of numbers, the last day busiest.
const DAILY = Array.from({ length: 91 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 5, 29) + i * 86400000).toISOString().slice(0, 10);
  return { day: date, positive: i === 90 ? 9 : 1, neutral: 0, negative: 1 };
});

const OVERVIEW = {
  asOf: '2026-09-27T10:00:00.000Z',
  windowStart: '2026-06-29T10:00:00.000Z',
  windowDays: 90,
  timeZone: 'Asia/Jerusalem',
  totals: { mentions: 1200, positive: 700, neutral: 200, negative: 300, companies: 2, companiesMentioned: 1 },
  trend: { current: 500, previous: 400, days: 30 },
  daily: DAILY,
  monthly: [{ month: '2026-08', positive: 400, neutral: 100, negative: 150 }, { month: '2026-09', positive: 300, neutral: 100, negative: 150 }],
  attention: [
    { companyId: 'harvey', name: 'Harvey', logoUrl: null, kind: 'negative', value: 85, week: 13, prev: null, count: 11, lastAt: null, spark: Array(14).fill(1) },
  ],
  recent: [
    { id: 2, companyId: 'harvey', companyName: 'Harvey', logoUrl: null, title: 'Harvey raises money - Example News', url: 'https://news.google.com/a', publisher: 'Example News', publishedAt: '2026-09-27T08:00:00.000Z', sentiment: 'positive' },
    { id: 1, companyId: 'harvey', companyName: 'Harvey', logoUrl: null, title: 'Harvey sued - Other News', url: 'https://news.google.com/b', publisher: 'Other News', publishedAt: '2026-09-26T08:00:00.000Z', sentiment: 'negative' },
  ],
};

const LIST = {
  ...COMPANIES_ANSWER,
  dailyRun: { latest: { id: 2, status: 'done', startedAt: '2026-09-27T00:00:00.000Z', finishedAt: '2026-09-27T02:16:00.000Z' }, lastDone: { id: 2, finishedAt: '2026-09-27T02:16:00.000Z', newMentions: 91, companiesWithUpdates: 14, discordSent: true } },
};

// A ResizeObserver that never reports a size (enough for the chart library to start in jsdom).
class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoResize);
  window.scrollTo = vi.fn();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

// Draws the page with a fake api; `overview` = the overview answer (or a function url -> Response).
async function renderApp(overview = () => jsonResponse(OVERVIEW)) {
  stubFetch((url) => {
    if (url.includes('/api/overview')) return overview(url);
    if (url.includes('/mentions')) return jsonResponse({ company: { id: 'harvey', name: 'Harvey' }, asOf: LIST.asOf, mentions: [] });
    return jsonResponse(LIST);
  });
  const { wrapper } = makeQueryWrapper();
  render(<App />, { wrapper });
}

describe('Overview page', () => {
  it('opens on the Overview: the number cards with their numbers', async () => {
    await renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    const total = await screen.findByRole('region', { name: 'Total mentions' });
    expect(within(total).getByText('1,200')).toBeInTheDocument();
    expect(within(total).getByText(/25%/)).toBeInTheDocument();
    const covered = screen.getByRole('region', { name: 'Companies mentioned' });
    expect(within(covered).getByText('1')).toBeInTheDocument();
    expect(within(covered).getByText('/ 2')).toBeInTheDocument();
    expect(within(covered).getByRole('img', { name: '50% of the companies' })).toBeInTheDocument();
    const split = screen.getByRole('region', { name: 'Sentiment breakdown' });
    expect(within(split).getByText('58%')).toBeInTheDocument();
    expect(within(split).getByText('Positive')).toBeInTheDocument();
    const daily = screen.getByRole('region', { name: 'Last daily run' });
    expect(within(daily).getByText('91')).toBeInTheDocument();
    expect(within(daily).getByText(/14 companies/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('the charts have their titles, the peak and the Daily / Weekly switch', async () => {
    await renderApp();
    const chart = await screen.findByRole('region', { name: 'Mentions over time' });
    expect(within(chart).getByText(/Per day/)).toHaveTextContent('Per day, by sentiment · peak 10 on 27 Sep');
    fireEvent.click(within(chart).getByRole('button', { name: 'Weekly' }));
    expect(within(chart).getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(chart).getByText(/Per week/)).toBeInTheDocument();
    const negative = within(chart).getByRole('button', { name: 'Negative' });
    fireEvent.click(negative);
    expect(negative).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('region', { name: 'Mentions by month' })).toBeInTheDocument();
  });

  it('Top companies, Needs attention and Recent mentions; the sentiment buttons filter', async () => {
    await renderApp();
    const top = await screen.findByRole('region', { name: 'Top companies' });
    expect(within(top).getAllByRole('row')).toHaveLength(2); // the header + Harvey (Ukko has no mentions)
    fireEvent.click(within(top).getByRole('tab', { name: 'Most positive' }));
    expect(within(top).getByText('No company fits this list right now.')).toBeInTheDocument();
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(attention).getByRole('button', { name: /Harvey: Negative week\. 11 of its 13 mentions this week are negative/ })).toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Recent mentions' });
    expect(within(recent).getByRole('link', { name: 'Harvey raises money - Example News' })).toHaveAttribute('target', '_blank');
    expect(within(recent).getByText('2h ago')).toBeInTheDocument();
    fireEvent.click(within(recent).getByRole('button', { name: /Negative 1/ }));
    expect(within(recent).queryByText('Harvey raises money - Example News')).not.toBeInTheDocument();
    expect(within(recent).getByText('Harvey sued - Other News')).toBeInTheDocument();
  });

  it('a company click opens it on the Companies page; Back returns to the Overview', async () => {
    await renderApp();
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    fireEvent.click(within(attention).getByRole('button', { name: /Harvey/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Companies' })).toBeInTheDocument();
    expect(window.location.search).toBe('?page=companies&company=harvey');
    expect(await screen.findByRole('heading', { name: 'Harvey' })).toBeInTheDocument(); // the mentions panel
    window.history.back();
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
  });

  it('going to the Overview closes the open company: back on Companies, none is selected (Prompt 366)', async () => {
    await renderApp();
    const top = await screen.findByRole('region', { name: 'Top companies' });
    fireEvent.click(within(top).getByRole('button', { name: 'Harvey' }));
    expect(await screen.findByRole('heading', { name: 'Harvey' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    await screen.findByRole('region', { name: 'Total mentions' });
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));
    expect(await screen.findByText('Click a company to see its mentions.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Harvey' })).not.toBeInTheDocument();
    expect(window.location.search).toBe('?page=companies');
  });

  it('from the Overview, the company\'s row is scrolled to, selected and glows for a moment (Prompt 370)', async () => {
    const scrolled = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this); };
    try {
      await renderApp();
      const attention = await screen.findByRole('region', { name: 'Needs attention' });
      fireEvent.click(within(attention).getByRole('button', { name: /Harvey/ }));
      const name = await screen.findByRole('button', { name: 'Harvey', current: true });
      const row = name.closest('tr');
      expect(row).toHaveAttribute('data-company-id', 'harvey');
      expect(row.className).toMatch(/flash/);
      await waitFor(() => expect(scrolled.length).toBeGreaterThan(0));
      // The glow ends (the row is drawn anew then, so it is looked up again).
      await waitFor(() => expect(document.querySelector('[data-company-id="harvey"]').className).not.toMatch(/flash/), { timeout: 3000 });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('Back to the Overview right after a jump: no old jump later, and Back also clears the search (code review #1, #4)', async () => {
    await renderApp();
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    fireEvent.click(within(attention).getByRole('button', { name: /Harvey/ }));
    const search = await screen.findByRole('searchbox', { name: 'Search companies' });
    fireEvent.change(search, { target: { value: 'harv' } });
    window.history.back(); // within the 2.2 s glow
    await screen.findByRole('region', { name: 'Total mentions' });
    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));
    expect(await screen.findByRole('searchbox', { name: 'Search companies' })).toHaveValue('');
    expect(screen.getByText('Click a company to see its mentions.')).toBeInTheDocument();
    for (const row of document.querySelectorAll('[data-company-id]')) expect(row.className).not.toMatch(/flash/);
  });

  it('clicking the page you are on adds no Back step (code review #5)', async () => {
    await renderApp();
    await screen.findByRole('region', { name: 'Total mentions' });
    const steps = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(window.history.length).toBe(steps);
  });

  it('going to the Overview clears the Companies search, filter and sort (Prompt 370)', async () => {
    await renderApp();
    await screen.findByRole('region', { name: 'Total mentions' });
    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));
    const search = await screen.findByRole('searchbox', { name: 'Search companies' });
    fireEvent.change(search, { target: { value: 'harv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    await screen.findByRole('region', { name: 'Total mentions' });
    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));
    expect(await screen.findByRole('searchbox', { name: 'Search companies' })).toHaveValue('');
    expect(screen.getByText('Sort: Most mentions')).toBeInTheDocument();
  });

  it('the side menu goes to Companies and back; the theme switch', async () => {
    await renderApp();
    await screen.findByRole('region', { name: 'Total mentions' });
    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));
    expect(await screen.findByRole('button', { name: 'Klook' }).catch(() => null)).toBeNull(); // no Klook in this list
    expect(screen.getByRole('table')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(await screen.findByRole('region', { name: 'Total mentions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('an overview error shows the message and Try again', async () => {
    await renderApp(() => jsonResponse({ error: 'The database could not be read.' }, 500));
    expect(await screen.findByText('The database could not be read.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });
});

// MentionsPanel.filters.test.jsx — the new panel (owner's design, Prompts 319-320, D111): the
// logo and title, the × close, the Time range and Sentiment icon menus with counts (Prompts
// 331-332), their dots and removable pills, the headline search, the list grouped by day with
// "10:35 IST", page 1 again after a filter change, and the defaults again for another company.
// The fetch is a fake.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MentionsPanel } from './MentionsPanel.jsx';
import { jsonResponse, makeQueryWrapper, stubFetch } from '../../test/testTools.jsx';

const AS_OF = '2026-09-30T12:00:00.000Z';
const HOUR = 60 * 60 * 1000;

// A mention `hoursAgo` hours before AS_OF.
function mention(hoursAgo, sentiment, title) {
  return { title, url: `https://news.example/${encodeURIComponent(title)}`, publisher: 'Example News', sentiment, publishedAt: new Date(Date.parse(AS_OF) - hoursAgo * HOUR).toISOString() };
}

const ANTHROPIC = {
  company: { id: 'anthropic', name: 'Anthropic' },
  asOf: AS_OF,
  mentions: [
    mention(1.5, 'positive', 'Anthropic launches a new model'), // 30 Sep 13:30 IST
    mention(4, 'negative', 'Former employee files lawsuit'), // 30 Sep 11:00 IST
    mention(30, 'neutral', 'How Anthropic approaches safety'), // 29 Sep
    mention(10 * 24, 'positive', 'Enterprise adoption grows'), // 20 Sep
  ],
};

// Many mentions (for the pages): `count` neutral ones, one per hour.
function many(id, count) {
  return { company: { id, name: id }, asOf: AS_OF, mentions: Array.from({ length: count }, (_, i) => mention(i + 1, i % 2 ? 'negative' : 'neutral', `${id} story ${i + 1}`)) };
}

function fakeApi() {
  stubFetch((url) => {
    if (url.includes('/anthropic/')) return jsonResponse(ANTHROPIC);
    return jsonResponse(many('harvey', 45));
  });
}

// Draws the panel; returns the rerender function.
function renderPanel(props) {
  const { wrapper } = makeQueryWrapper();
  return render(<MentionsPanel windowDays={90} {...props} />, { wrapper });
}

const button = (name) => screen.getByRole('button', { name });

// Opens the icon menu `menu` ("Time range" / "Sentiment") and chooses `name` ("7d (3)").
function choose(menu, name) {
  fireEvent.click(button(menu));
  fireEvent.click(screen.getByRole('menuitemradio', { name }));
}

// The items of the icon menu `menu` ("24h (2)", with " ✓" on the current one), then closes it.
function items(menu) {
  fireEvent.click(button(menu));
  const list = screen.getAllByRole('menuitemradio').map((item) => `${item.getAttribute('aria-label')}${item.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  return list;
}
const headlines = () => screen.getAllByRole('link').map((link) => link.textContent);

describe('MentionsPanel filters', () => {
  it('title, logo, "N mentions in last 90 days", and the × closes it', async () => {
    fakeApi();
    const onClose = vi.fn();
    const { container } = renderPanel({ companyId: 'anthropic', companyName: 'Anthropic', logoUrl: '/logos/anthropic.png', onClose });
    expect(await screen.findByText('4 mentions in last 90 days')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Anthropic' })).toBeInTheDocument();
    expect(container.querySelector('img[src="/logos/anthropic.png"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close the mentions' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens on 90d / All with counts; grouped by day in Israel time with "HH:MM IST"', async () => {
    fakeApi();
    renderPanel({ companyId: 'anthropic', companyName: 'Anthropic' });
    await screen.findByText('Wed 30 Sep');
    expect(items('Time range')).toEqual(['24h (2)', '7d (3)', '30d (4)', '90d (4) ✓']);
    expect(items('Sentiment')).toEqual(['All (4) ✓', 'Positive (2)', 'Neutral (1)', 'Negative (1)']);
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(button('Time range').children).toHaveLength(1); // no dot
    expect(screen.queryByRole('button', { name: /sort/i })).not.toBeInTheDocument(); // always newest first

    const days = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(days).toEqual(['Wed 30 Sep (2)', 'Tue 29 Sep (1)', 'Sun 20 Sep (1)']);
    const today = screen.getByRole('region', { name: 'Wed 30 Sep' });
    expect(within(today).getAllByRole('link').map((l) => l.textContent)).toEqual(['Anthropic launches a new model', 'Former employee files lawsuit']);
    expect(within(today).getByText('Example News · 13:30 IST')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anthropic launches a new model' })).toHaveAttribute('title', 'Anthropic launches a new model');
  });

  it('time + sentiment + headline search together; counts follow; nothing left says so', async () => {
    fakeApi();
    renderPanel({ companyId: 'anthropic', companyName: 'Anthropic' });
    await screen.findByText('Wed 30 Sep');
    choose('Time range', '7d (3)');
    expect(headlines()).toEqual(['Anthropic launches a new model', 'Former employee files lawsuit', 'How Anthropic approaches safety']);
    expect(items('Sentiment')[0]).toBe('All (3) ✓');
    choose('Sentiment', 'Negative (1)');
    expect(headlines()).toEqual(['Former employee files lawsuit']);
    expect(items('Time range')[0]).toBe('24h (1)');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search headlines' }), { target: { value: 'model' } });
    expect(screen.getByText('No mentions match these filters.')).toBeInTheDocument();
  });

  it('a non-default choice: a dot on its icon and a pill; the pill brings back the default', async () => {
    fakeApi();
    renderPanel({ companyId: 'anthropic', companyName: 'Anthropic' });
    await screen.findByText('Wed 30 Sep');
    choose('Time range', '24h (2)');
    choose('Sentiment', 'Positive (1)');
    expect(headlines()).toEqual(['Anthropic launches a new model']);
    expect(button('Time range').children).toHaveLength(2); // icon + dot
    expect(button('Sentiment').children).toHaveLength(2);
    fireEvent.click(button('Remove 24h'));
    expect(headlines()).toEqual(['Anthropic launches a new model', 'Enterprise adoption grows']);
    expect(button('Time range').children).toHaveLength(1);
    fireEvent.click(button('Remove Positive'));
    expect(headlines()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('a filter change goes back to page 1; another company starts from the defaults again', async () => {
    fakeApi();
    const { rerender } = renderPanel({ companyId: 'harvey', companyName: 'harvey' });
    await screen.findByText('1 / 3');
    fireEvent.click(button('Next page'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    choose('Sentiment', 'Negative (22)');
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    choose('Time range', '7d (22)');

    rerender(<MentionsPanel companyId="anthropic" companyName="Anthropic" windowDays={90} />);
    await screen.findByText('Wed 30 Sep');
    expect(items('Sentiment')[0]).toBe('All (4) ✓');
    expect(items('Time range')[3]).toBe('90d (4) ✓');
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('a day split over two pages shows its heading, with the full count, on both', async () => {
    fakeApi();
    renderPanel({ companyId: 'harvey', companyName: 'harvey' });
    await screen.findByText('1 / 3');
    // 45 mentions one hour apart back from 30 Sep 15:00 IST: 15 on 30 Sep, 24 on 29 Sep, 6 on 28 Sep.
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Wed 30 Sep (15)', 'Tue 29 Sep (24)']);
    fireEvent.click(button('Next page'));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Tue 29 Sep (24)', 'Mon 28 Sep (6)']);
  });
});

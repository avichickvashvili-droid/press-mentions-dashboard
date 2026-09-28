// App.sort.test.jsx — click-to-sort on the whole page (owner, Prompt 282, D104): the default
// order, a click sorts and a second click reverses, aria-sort and the arrow, the sentiment
// headers are not clickable, sort + search together, and the sort survives a reload. Fake fetch.

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.jsx';
import { jsonResponse, makeQueryWrapper, stubFetch } from './test/testTools.jsx';

// A company as the api sends it (`last` = date of its latest mention, or null = no coverage).
function company(name, mentionCount, last) {
  return {
    id: name.toLowerCase(), name, section: 1, sectionName: 'High-Tech', hint: null,
    status: mentionCount > 0 ? 'mentioned' : 'no_coverage', lastMentionAt: last, daysAgo: last ? 1 : null,
    mentionCount, sentimentCounts: { positive: mentionCount, neutral: 0, negative: 0 },
  };
}

const LIST = {
  asOf: '2026-09-27T10:00:00.000Z',
  windowStart: '2026-06-29T10:00:00.000Z',
  companies: [
    company('Alamo', 5, '2026-09-01T08:00:00.000Z'),
    company('Lambda', 50, '2026-09-20T08:00:00.000Z'),
    company('Klook', 62, '2026-09-10T08:00:00.000Z'),
    company('Ukko', 0, null),
    company('Beta', 5, '2026-09-26T08:00:00.000Z'),
  ],
};

// Draws the page with a fake api (counting list loads) and waits for the table.
async function renderApp() {
  const calls = { list: 0 };
  stubFetch(() => { calls.list += 1; return jsonResponse(LIST); });
  const { wrapper } = makeQueryWrapper();
  render(<App />, { wrapper });
  await screen.findByRole('button', { name: 'Klook' });
  return calls;
}

// The company names in the table, top to bottom.
function tableNames() {
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  return rows.map((row) => within(row).queryByRole('button')?.textContent).filter(Boolean);
}

// The header cell of a column, found by its visible text.
const header = (text) => screen.getAllByRole('columnheader').find((cell) => cell.textContent.startsWith(text));
const headerButton = (text) => within(header(text)).getByRole('button');

describe('click-to-sort', () => {
  it('opens in the default order (Mentions most first, no coverage last) with no arrow and no aria-sort', async () => {
    await renderApp();
    expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo', 'Beta', 'Ukko']);
    for (const text of ['Company', 'Status', 'Mentions']) {
      expect(header(text)).not.toHaveAttribute('aria-sort');
      expect(header(text)).not.toHaveTextContent(/[▲▼]/);
    }
  });

  it('the first click on Mentions shows ▼ with most first; the second shows ▲ with fewest first', async () => {
    await renderApp();
    fireEvent.click(headerButton('Mentions'));
    expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo', 'Beta', 'Ukko']);
    expect(header('Mentions')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Mentions')).toHaveTextContent('▼');
    fireEvent.click(headerButton('Mentions'));
    expect(tableNames()).toEqual(['Alamo', 'Beta', 'Lambda', 'Klook', 'Ukko']);
    expect(header('Mentions')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Mentions')).toHaveTextContent('▲');
  });

  it('a click sorts, a second click reverses; no coverage stays at the bottom except for Company', async () => {
    await renderApp();
    fireEvent.click(headerButton('Status'));
    expect(tableNames()).toEqual(['Beta', 'Lambda', 'Klook', 'Alamo', 'Ukko']);
    fireEvent.click(headerButton('Status'));
    expect(tableNames()).toEqual(['Alamo', 'Klook', 'Lambda', 'Beta', 'Ukko']);

    fireEvent.click(headerButton('Company'));
    expect(tableNames()).toEqual(['Alamo', 'Beta', 'Klook', 'Lambda', 'Ukko']);
    expect(header('Company')).toHaveTextContent('▲');
    fireEvent.click(headerButton('Company'));
    expect(tableNames()).toEqual(['Ukko', 'Lambda', 'Klook', 'Beta', 'Alamo']);
  });

  it('the Positive / Negative / Neutral headers are plain text, not buttons', async () => {
    await renderApp();
    for (const text of ['Positive', 'Negative', 'Neutral']) {
      expect(within(header(text)).queryByRole('button')).toBeNull();
    }
  });

  it('sort and search together: the search narrows the sorted list', async () => {
    await renderApp();
    fireEvent.click(headerButton('Company'));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search companies' }), { target: { value: 'la' } });
    expect(tableNames()).toEqual(['Alamo', 'Lambda']);
    fireEvent.click(headerButton('Company'));
    expect(tableNames()).toEqual(['Lambda', 'Alamo']);
  });

  it('the chosen sort survives a reload of the data (Refresh)', async () => {
    const calls = await renderApp();
    fireEvent.click(headerButton('Status'));
    await act(() => fireEvent.click(screen.getByRole('button', { name: 'Refresh' })));
    await screen.findByRole('button', { name: 'Refresh' });
    expect(calls.list).toBe(2);
    expect(header('Status')).toHaveAttribute('aria-sort', 'descending');
    expect(tableNames()).toEqual(['Beta', 'Lambda', 'Klook', 'Alamo', 'Ukko']);
  });
});

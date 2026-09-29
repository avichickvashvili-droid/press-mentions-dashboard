// App.search.test.jsx — the company search on the whole page (owner, Prompt 273, D103): the table
// narrows on every keystroke with no button, the order stays "most mentions first", a clear
// message when nothing matches, the text survives a reload of the data, and the open company's
// mentions stay open while its row is hidden. The fetch is a fake.

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.jsx';
import { jsonResponse, makeQueryWrapper, stubFetch } from './test/testTools.jsx';

// A company as the api sends it.
function company(id, name, mentionCount) {
  return {
    id, name, section: 1, sectionName: 'High-Tech', hint: null,
    status: mentionCount > 0 ? 'mentioned' : 'no_coverage', lastMentionAt: mentionCount > 0 ? '2026-09-27T08:00:00.000Z' : null,
    daysAgo: mentionCount > 0 ? 0 : null, mentionCount, sentimentCounts: { positive: mentionCount, neutral: 0, negative: 0 },
  };
}

const LIST = {
  asOf: '2026-09-27T10:00:00.000Z',
  windowStart: '2026-06-29T10:00:00.000Z',
  windowDays: 90,
  companies: [company('alamo', 'Alamo', 5), company('lambda', 'Lambda', 50), company('klook', 'Klook', 62), company('ukko', 'Ukko', 0)],
};

// A fake api; counts how often the list was loaded.
function fakeApi() {
  const calls = { list: 0 };
  stubFetch((url) => {
    if (url.includes('/mentions')) return jsonResponse({ company: { id: 'klook', name: 'Klook' }, mentions: [] });
    if (url.includes('/api/overview')) return jsonResponse({ daily: [], recent: [], attention: [], totals: {} }); // the hero's (D118)
    calls.list += 1;
    return jsonResponse(LIST);
  });
  return calls;
}

// The company names in the table, top to bottom.
function tableNames() {
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  return rows.map((row) => within(row).queryByRole('button')?.textContent).filter(Boolean);
}

// Types one character more (one keystroke = one change event).
function typeInto(input, text) {
  for (let length = 1; length <= text.length; length += 1) {
    fireEvent.change(input, { target: { value: text.slice(0, length) } });
  }
}

// Draws the Companies page (?page=companies, D117) and waits for the list.
async function renderApp() {
  window.history.replaceState(null, '', '/?page=companies');
  const calls = fakeApi();
  const { queryClient, wrapper } = makeQueryWrapper();
  render(<App />, { wrapper });
  await screen.findByRole('button', { name: 'Klook' });
  return { calls, queryClient, input: screen.getByRole('searchbox', { name: 'Search companies' }) };
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('company search', () => {
  it('narrows the table on every keystroke, with no button, keeping the most-mentions order', async () => {
    const { input } = await renderApp();
    expect(input).toHaveAttribute('type', 'search');
    expect(input.closest('form')).toBeNull();
    expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo', 'Ukko']);

    fireEvent.change(input, { target: { value: 'l' } });
    expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo']);
    fireEvent.change(input, { target: { value: 'la' } });
    expect(tableNames()).toEqual(['Lambda', 'Alamo']);
    fireEvent.change(input, { target: { value: 'lam' } });
    expect(tableNames()).toEqual(['Lambda', 'Alamo'], '"contains": A-lam-o matches too');
    fireEvent.change(input, { target: { value: 'lamb' } });
    expect(tableNames()).toEqual(['Lambda']);

    fireEvent.change(input, { target: { value: '' } });
    expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo', 'Ukko']);
  });

  it('no match: "No companies match "xyz"" in the table', async () => {
    const { input } = await renderApp();
    typeInto(input, 'xyz');
    expect(within(screen.getByRole('table')).getByText('No companies match "xyz"')).toBeInTheDocument();
  });

  it('the search text survives a reload of the data (a live update)', async () => {
    const { input, calls, queryClient } = await renderApp();
    typeInto(input, 'lamb');
    await act(() => queryClient.invalidateQueries({ queryKey: ['companies'] })); // what a live update does
    expect(calls.list).toBe(2);
    expect(input).toHaveValue('lamb');
    expect(tableNames()).toEqual(['Lambda']);
  });

  it('the open company stays open when the search hides its row', async () => {
    const { input } = await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Klook' }));
    await screen.findByText('No coverage found in the last 90 days.');
    typeInto(input, 'lamb');
    expect(tableNames()).toEqual(['Lambda']);
    expect(screen.getByRole('complementary', { name: 'Mentions of Klook' })).toBeInTheDocument();
  });
});

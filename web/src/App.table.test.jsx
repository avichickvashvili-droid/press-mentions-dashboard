// App.table.test.jsx — the company table on the whole page (owner's design, Prompts 317-322,
// D110; icon menus, Prompt 331): the default order (Most mentions), the Sort menu, the Filter
// menu with counts that follow the search, both together, the dot and pill of a non-default
// choice (and removing it), the choices kept through a reload, the logos (a letter badge when missing or broken) and the panel's × close.
// Fake fetch.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.jsx';
import { badgeColour, initials } from './components/CompanyLogo/CompanyLogo.jsx';
import { jsonResponse, makeQueryWrapper, stubFetch } from './test/testTools.jsx';

// A company as the api sends it (`last` = date of its latest mention, or null = no coverage).
function company(name, mentionCount, last, weekCount = 0, logoUrl = null) {
  return {
    id: name.toLowerCase(), name, section: 1, sectionName: 'High-Tech', hint: null,
    status: mentionCount > 0 ? 'mentioned' : 'no_coverage', lastMentionAt: last, daysAgo: last ? 1 : null,
    mentionCount, sentimentCounts: { positive: mentionCount, neutral: 0, negative: 0 },
    weekCount, prevWeekCount: 0, logoUrl,
  };
}

const LIST = {
  asOf: '2026-09-27T10:00:00.000Z',
  windowStart: '2026-06-29T10:00:00.000Z',
  windowDays: 90,
  companies: [
    company('Alamo', 5, '2026-09-01T08:00:00.000Z'),
    company('Lambda', 50, '2026-09-20T08:00:00.000Z', 3, '/logos/lambda.png'),
    company('Klook', 62, '2026-09-10T08:00:00.000Z'),
    company('Ukko', 0, null),
    company('Beta', 5, '2026-09-26T08:00:00.000Z', 1),
  ],
};

afterEach(() => window.history.replaceState(null, '', '/'));

// Draws the page with a fake api (counting list loads) and waits for the table.
async function renderApp() {
  const calls = { list: 0 };
  stubFetch((url) => {
    if (url.includes('/mentions')) return jsonResponse({ company: { id: 'klook', name: 'Klook' }, asOf: LIST.asOf, mentions: [] });
    calls.list += 1;
    return jsonResponse(LIST);
  });
  const { wrapper, queryClient } = makeQueryWrapper();
  calls.queryClient = queryClient;
  render(<App />, { wrapper });
  await screen.findByRole('button', { name: 'Klook' });
  return calls;
}

// The company names in the table, top to bottom.
function tableNames() {
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  return rows.map((row) => within(row).queryByRole('button')?.textContent).filter(Boolean);
}

// Opens the Sort menu and chooses `name` ("Last mentioned (newest)").
function sortBy(name) {
  fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name }));
}

// Opens the Filter menu and chooses `name` ("Mentioned (4)"), which must be there.
function filterBy(name) {
  fireEvent.click(screen.getByRole('button', { name: 'Filter companies' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name }));
}

// The Filter menu's items (name, with " ✓" on the current one), then closes it with Esc.
function filterItems() {
  fireEvent.click(screen.getByRole('button', { name: 'Filter companies' }));
  const items = screen.getAllByRole('menuitemradio').map((item) => `${item.getAttribute('aria-label')}${item.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  return items;
}

describe('company table', () => {
  it('opens on Most mentions and All (no dot; the sort pill shows it, without ×; no coverage last); the headers are not buttons', async () => {
    await renderApp();
    expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo', 'Beta', 'Ukko']);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); // the old "Sort by" list is gone
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    expect(screen.getAllByRole('menuitemradio').map((item) => [item.textContent, item.getAttribute('aria-checked')]))
      .toEqual([['Most mentions', 'true'], ['Last mentioned (newest)', 'false'], ['Company A–Z', 'false']]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(filterItems()).toEqual(['All (5) ✓', 'Mentioned this week (2)', 'Mentioned (4)', 'No coverage (1)']);
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText('Sort: Most mentions')).toBeInTheDocument(); // Prompt 335: always shown
    for (const cell of screen.getAllByRole('columnheader')) expect(within(cell).queryByRole('button')).toBeNull();
  });

  it('Sort menu: Last mentioned, then Company A–Z; the pill brings back Most mentions', async () => {
    await renderApp();
    sortBy('Last mentioned (newest)');
    expect(tableNames()).toEqual(['Beta', 'Lambda', 'Klook', 'Alamo', 'Ukko']);
    sortBy('Company A–Z');
    expect(tableNames()).toEqual(['Alamo', 'Beta', 'Klook', 'Lambda', 'Ukko']);
    expect(screen.getByRole('button', { name: 'Sort' }).children).toHaveLength(2); // icon + dot
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sort: Company A–Z' }));
    expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo', 'Beta', 'Ukko']);
    expect(screen.getByRole('button', { name: 'Sort' }).children).toHaveLength(1);
    expect(screen.getByText('Sort: Most mentions')).toBeInTheDocument();
  });

  it('choosing the current sort again reverses it (Fewest mentions, oldest first, Z–A), shown in the menu and the pill (Prompt 335)', async () => {
    await renderApp();
    sortBy('Most mentions');
    expect(tableNames()).toEqual(['Alamo', 'Beta', 'Lambda', 'Klook', 'Ukko']); // fewest first, no coverage still last
    expect(screen.getByRole('button', { name: 'Remove Sort: Fewest mentions' })).toBeInTheDocument();
    sortBy('Fewest mentions');
    expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo', 'Beta', 'Ukko']);
    expect(screen.getByText('Sort: Most mentions')).toBeInTheDocument();
    sortBy('Last mentioned (newest)');
    sortBy('Last mentioned (newest)');
    expect(tableNames()).toEqual(['Alamo', 'Klook', 'Lambda', 'Beta', 'Ukko']);
    expect(screen.getByRole('button', { name: 'Remove Sort: Last mentioned (oldest)' })).toBeInTheDocument();
    sortBy('Company A–Z');
    sortBy('Company A–Z');
    expect(tableNames()).toEqual(['Ukko', 'Lambda', 'Klook', 'Beta', 'Alamo']);
    expect(screen.getByRole('button', { name: 'Remove Sort: Company Z–A' })).toBeInTheDocument();
  });

  it('Filter menu with counts; the counts follow the search; search + filter together; the pill removes it', async () => {
    await renderApp();
    filterBy('Mentioned this week (2)');
    expect(tableNames()).toEqual(['Lambda', 'Beta']);
    expect(screen.getByRole('button', { name: 'Remove Mentioned this week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter companies' }).children).toHaveLength(2); // icon + dot
    filterBy('No coverage (1)');
    expect(tableNames()).toEqual(['Ukko']);
    filterBy('Mentioned (4)');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search companies' }), { target: { value: 'l' } });
    await waitFor(() => expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo']));
    expect(filterItems()).toEqual(['All (3)', 'Mentioned this week (1)', 'Mentioned (3) ✓', 'No coverage (0)']);
    filterBy('No coverage (0)');
    expect(screen.getByText('No companies match "l"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove No coverage' }));
    expect(tableNames()).toEqual(['Klook', 'Lambda', 'Alamo']);
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('the sort choice and the filter survive a reload of the data (a live update)', async () => {
    const calls = await renderApp();
    sortBy('Company A–Z');
    filterBy('Mentioned (4)');
    await act(() => calls.queryClient.invalidateQueries({ queryKey: ['companies'] })); // what a live update does
    expect(calls.list).toBe(2);
    expect(tableNames()).toEqual(['Alamo', 'Beta', 'Klook', 'Lambda']);
  });

  it('a logo when the api has one (lazy); a letter badge when not, or when the image fails', async () => {
    await renderApp();
    const lambdaRow = screen.getByRole('button', { name: 'Lambda' }).closest('tr');
    const img = lambdaRow.querySelector('img');
    expect(img).toHaveAttribute('src', '/logos/lambda.png');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('alt', '');
    fireEvent.error(img);
    expect(within(lambdaRow).getByTestId('logo-badge')).toHaveTextContent('LA');
    expect(within(screen.getByRole('button', { name: 'Klook' }).closest('tr')).getByTestId('logo-badge')).toHaveTextContent('KL');
  });

  it('opening a company from a row, and the panel × closes it (and clears ?company)', async () => {
    await renderApp();
    fireEvent.click(screen.getByText('62'));
    expect(window.location.search).toBe('?company=klook');
    expect(await screen.findByRole('heading', { level: 2, name: 'Klook' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close the mentions' }));
    expect(window.location.search).toBe('');
    expect(screen.getByText('Click a company to see its mentions.')).toBeInTheDocument();
  });
});

describe('letter badges', () => {
  it('two letters from the name, and always the same colour for the same name', () => {
    expect(initials('SpaceX')).toBe('SP');
    expect(initials('Scale AI')).toBe('SA');
    expect(initials('  (d)  ')).toBe('D');
    expect(initials('')).toBe('?');
    expect(badgeColour('SpaceX')).toBe(badgeColour('SpaceX'));
  });
});

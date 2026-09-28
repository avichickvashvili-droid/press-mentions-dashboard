// components.test.jsx — the main components, kept short for the sample (owner, Phase 2):
// StatusText wording (FR5), SentimentBadge, CompanyTable (every company, click selects),
// MentionsPanel states and link attributes (FR2-FR4), ErrorBoundary. The fetch is a fake.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { statusWords, StatusText } from './StatusText/StatusText.jsx';
import { SentimentBadge } from './SentimentBadge/SentimentBadge.jsx';
import { CompanyTable } from './CompanyTable/CompanyTable.jsx';
import { MentionsPanel } from './MentionsPanel/MentionsPanel.jsx';
import { ErrorBoundary } from './common/ErrorBoundary.jsx';
import { COMPANIES_ANSWER, HARVEY_MENTIONS, jsonResponse, makeQueryWrapper, stubFetch } from '../test/testTools.jsx';

// Draws a component inside a fresh TanStack Query cache.
function renderWithQuery(element) {
  const { wrapper } = makeQueryWrapper();
  return render(element, { wrapper });
}

describe('StatusText', () => {
  it('says today / 1 day / N days / no coverage found', () => {
    expect(statusWords('mentioned', 0)).toBe('last mentioned today');
    expect(statusWords('mentioned', 1)).toBe('last mentioned 1 day ago');
    expect(statusWords('mentioned', 12)).toBe('last mentioned 12 days ago');
    expect(statusWords('no_coverage', null)).toBe('no coverage found');
    render(<StatusText status="no_coverage" daysAgo={null} />);
    expect(screen.getByText('no coverage found')).toBeInTheDocument();
  });
});

describe('SentimentBadge', () => {
  it('shows the sentiment with its colour class', () => {
    render(<SentimentBadge sentiment="negative" />);
    expect(screen.getByText('negative')).toHaveClass('negative');
  });
});

describe('CompanyTable', () => {
  it('shows every company with its status and totals (no section column); clicking a name selects it', () => {
    const onSelect = vi.fn();
    render(<CompanyTable companies={COMPANIES_ANSWER.companies} selectedId={null} onSelect={onSelect} />);
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 companies
    expect(screen.queryByText('Health')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Section' })).not.toBeInTheDocument();
    expect(screen.getByText('no coverage found')).toBeInTheDocument();
    expect(screen.getByText('last mentioned 2 days ago')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Harvey' }));
    expect(onSelect).toHaveBeenCalledWith('harvey');
  });
});

describe('MentionsPanel', () => {
  it('asks to click a company when none is selected (and loads nothing)', () => {
    const fetchMock = stubFetch(() => jsonResponse(HARVEY_MENTIONS));
    renderWithQuery(<MentionsPanel companyId={null} />);
    expect(screen.getByText(/Click a company/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loading, then the mentions newest first, each linking to its article in a new tab', async () => {
    stubFetch(() => jsonResponse(HARVEY_MENTIONS));
    renderWithQuery(<MentionsPanel companyId="harvey" companyName="Harvey" />);
    expect(screen.getByText(/Loading mentions/)).toBeInTheDocument();
    const links = await screen.findAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Harvey raises money - Example News', 'Harvey sued - Other News']);
    expect(links[0]).toHaveAttribute('href', 'https://news.google.com/a');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('positive')).toBeInTheDocument();
  });

  it('no mentions: "No coverage found in the last 90 days."', async () => {
    stubFetch(() => jsonResponse({ company: { id: 'ukko', name: 'Ukko' }, mentions: [] }));
    renderWithQuery(<MentionsPanel companyId="ukko" companyName="Ukko" />);
    expect(await screen.findByText('No coverage found in the last 90 days.')).toBeInTheDocument();
  });

  it('an error: the message and a working "Try again"', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: 'The dashboard data could not be read.' }, 500) : jsonResponse(HARVEY_MENTIONS);
    });
    renderWithQuery(<MentionsPanel companyId="harvey" companyName="Harvey" />);
    expect(await screen.findByText('The dashboard data could not be read.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('link')).toHaveLength(2);
  });

  it('a company that is not found (404): a message, not a crash', async () => {
    stubFetch(() => jsonResponse({ error: 'No company with the id "gone".' }, 404));
    renderWithQuery(<MentionsPanel companyId="gone" companyName="Gone" />);
    expect(await screen.findByText(/This company was not found/)).toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  it('shows a message instead of a blank page when drawing fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => { throw new Error('render bug'); };
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong/);
  });
});

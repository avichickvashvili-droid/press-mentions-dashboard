// components.test.jsx — the main components, kept short for the sample (owner, Phase 2):
// StatusText wording (FR5, Prompt 332), SentimentBadge, CompanyTable (every company, the D110 columns, click
// selects),
// MentionsPanel states and link attributes (FR2-FR4) (the window length from the api is in Hero.test.jsx),
// ErrorBoundary. The fetch is a fake.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { freshness, lastMentionTitle, statusWords, StatusText } from './StatusText/StatusText.jsx';
import { SentimentBadge } from './SentimentBadge/SentimentBadge.jsx';
import { CompanyTable } from './CompanyTable/CompanyTable.jsx';
import { MentionsPanel } from './MentionsPanel/MentionsPanel.jsx';
import { ErrorBoundary } from './common/ErrorBoundary.jsx';
import { COMPANIES_ANSWER, HARVEY_MENTIONS, jsonResponse, makeQueryWrapper, stubFetch } from '../test/testTools.jsx';

// Draws a component inside a fresh TanStack Query cache (`options` go to makeQueryWrapper).
function renderWithQuery(element, options) {
  const { wrapper } = makeQueryWrapper(options);
  return render(element, { wrapper });
}

describe('StatusText', () => {
  it('says < 24h / Nd ago / Nw ago / Nmo ago / No coverage (Prompt 332), with a freshness colour', () => {
    expect(freshness(0)).toBe('fresh');
    expect(freshness(1)).toBe('fresh');
    expect(freshness(7)).toBe('recent');
    expect(freshness(8)).toBe('old');
    const words = [0, 1, 6, 7, 13, 14, 29, 30, 59, 60, 89].map((days) => statusWords('mentioned', days));
    expect(words).toEqual(['< 24h', '1d ago', '6d ago', '1w ago', '1w ago', '2w ago', '4w ago', '1mo ago', '1mo ago', '2mo ago', '2mo ago']);
    expect(statusWords('no_coverage', null)).toBe('No coverage');
    expect(statusWords('mentioned', null)).toBe('No coverage');
    render(<StatusText status="no_coverage" daysAgo={null} />);
    expect(screen.getByText('No coverage')).toBeInTheDocument();
    expect(screen.getByText('No coverage')).not.toHaveAttribute('title');
  });

  it('the label keeps its colour and shows the exact last mention in Israel time on hover', () => {
    render(<StatusText status="mentioned" daysAgo={3} lastMentionAt="2026-09-28T23:53:00.000Z" />);
    const label = screen.getByText('3d ago');
    expect(label).toHaveClass('recent');
    expect(label).toHaveAttribute('title', 'Last mention: 29 Sep 2026, 02:53 IST');
    expect(lastMentionTitle(null)).toBe('');
  });
});

describe('SentimentBadge', () => {
  it('shows the sentiment with its icon and colour class; an unknown value plainly', () => {
    const { container } = render(<><SentimentBadge sentiment="negative" /><SentimentBadge sentiment="odd" /></>);
    expect(screen.getByText('Negative')).toHaveClass('negative');
    expect(screen.getByText('Negative')).toHaveTextContent('!Negative');
    expect(screen.getByText('odd')).not.toHaveClass('negative');
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });
});

describe('CompanyTable', () => {
  it('shows every company with the D110 columns (no section column); clicking a name or the row selects it', () => {
    const onSelect = vi.fn();
    render(<CompanyTable companies={COMPANIES_ANSWER.companies} selectedId={null} onSelect={onSelect} />);
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 companies
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers.slice(0, 5)).toEqual(['Company', 'Recent activityⓘ', 'Mentions (90 days)', 'Sentiment (90 days)', 'Last mentioned']);
    expect(screen.queryByText('Health')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Positive' })).not.toBeInTheDocument();
    expect(screen.getByText('No coverage')).toBeInTheDocument();
    expect(screen.getByText('2d ago')).toHaveAttribute('title', 'Last mention: 25 Sep 2026, 12:00 IST');
    expect(screen.getByText('1 this week')).toBeInTheDocument();
    // The arrow is drawn (plus a hidden ↓ for screen readers), so the text is in two pieces.
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '↓ 1 vs prev week')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Positive 1 · Neutral 1 · Negative 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Harvey' }));
    expect(onSelect).toHaveBeenLastCalledWith('harvey');
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('No coverage'));
    expect(onSelect).toHaveBeenLastCalledWith('ukko');
  });

  it('the open company is marked on its name button (aria-current), not with aria-selected on the row', () => {
    render(<CompanyTable companies={COMPANIES_ANSWER.companies} selectedId="harvey" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'Harvey' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Ukko' })).not.toHaveAttribute('aria-current');
    for (const row of screen.getAllByRole('row')) expect(row).not.toHaveAttribute('aria-selected');
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
    expect(screen.getByText('Positive')).toBeInTheDocument();
  });

  it('no mentions: "No coverage found in the last N days." with N from the api', async () => {
    stubFetch(() => jsonResponse({ company: { id: 'ukko', name: 'Ukko' }, mentions: [] }));
    const { rerender } = renderWithQuery(<MentionsPanel companyId="ukko" companyName="Ukko" windowDays={90} />);
    expect(await screen.findByText('No coverage found in the last 90 days.')).toBeInTheDocument();
    rerender(<MentionsPanel companyId="ukko" companyName="Ukko" windowDays={30} />);
    expect(screen.getByText('No coverage found in the last 30 days.')).toBeInTheDocument();
  });

  it('the title is the name, and under it "1 mention" / "N mentions" in the last N days', async () => {
    stubFetch((url) => jsonResponse(url.includes('/one/')
      ? { company: { id: 'one', name: 'One' }, mentions: HARVEY_MENTIONS.mentions.slice(0, 1) }
      : HARVEY_MENTIONS));
    const { rerender } = renderWithQuery(<MentionsPanel companyId="one" companyName="One" />);
    expect(await screen.findByText('1 mention in last 90 days')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'One' })).toBeInTheDocument();
    rerender(<MentionsPanel companyId="harvey" companyName="Harvey" windowDays={90} />);
    expect(await screen.findByText('2 mentions in last 90 days')).toBeInTheDocument();
  });

  it('only an http(s) address becomes a link; any other shows the headline as plain text, unchanged', async () => {
    const mentions = [
      { ...HARVEY_MENTIONS.mentions[0], title: 'Web story', url: 'https://news.google.com/a' },
      { ...HARVEY_MENTIONS.mentions[0], title: 'Data story', url: 'data:text/html,<b>x</b>' },
      { ...HARVEY_MENTIONS.mentions[0], title: 'Script story', url: 'javascript:alert(1)' },
    ];
    stubFetch(() => jsonResponse({ company: { id: 'harvey', name: 'Harvey' }, mentions }));
    renderWithQuery(<MentionsPanel companyId="harvey" companyName="Harvey" />);
    const links = await screen.findAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Web story']);
    for (const title of ['Data story', 'Script story']) {
      const text = screen.getByText(title);
      expect(text.closest('a')).toBeNull();
      expect(text).not.toHaveAttribute('href');
    }
  });

  it('an error (with the real retry settings): tried 3 times, then the message and a working "Try again"', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls <= 3 ? jsonResponse({ error: 'The dashboard data could not be read.' }, 500) : jsonResponse(HARVEY_MENTIONS);
    });
    renderWithQuery(<MentionsPanel companyId="harvey" companyName="Harvey" />, { realDefaults: true });
    expect(await screen.findByText('The dashboard data could not be read.')).toBeInTheDocument();
    expect(calls).toBe(3); // the first try + 2 retries (QUERY_DEFAULTS)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('link')).toHaveLength(2);
  });

  it('a company that is not found (404, with the real retry settings): a message at once, never retried', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ error: 'No company with the id "gone".' }, 404));
    renderWithQuery(<MentionsPanel companyId="gone" companyName="Gone" />, { realDefaults: true });
    expect(await screen.findByText(/This company was not found/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

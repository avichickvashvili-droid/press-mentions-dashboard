// Header.test.jsx — the top of the page (owner, Prompt 333, D113): the last update = the daily
// job's finish time in Israel time, its numbers (the same as its Discord message), the status
// mark for running / failed / stale / no run yet, and no Refresh button.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Header, STALE_AFTER_MS, updateStatus } from './Header.jsx';
import { formatUpdateTime } from '../../utils/dates.js';

const NOW = Date.parse('2026-09-29T09:00:00.000Z'); // 12:00 in Israel
const LAST_DONE = { id: 2, finishedAt: '2026-09-29T02:16:13.802Z', newMentions: 91, companiesWithUpdates: 14, discordSent: true };
const DONE = { latest: { id: 2, status: 'done', startedAt: '2026-09-29T00:00:00.134Z', finishedAt: LAST_DONE.finishedAt }, lastDone: LAST_DONE };

// Draws the header with the standard window and 258 companies.
function renderHeader(dailyRun) {
  return render(<Header asOf="2026-09-29T09:00:00.000Z" windowStart="2026-07-01T09:00:00.000Z" windowDays={90} companyCount={258} coveredCount={138} dailyRun={dailyRun} now={NOW} />);
}

describe('Header', () => {
  it('the last update is the daily run\'s finish time in Israel time, with its Discord numbers', () => {
    renderHeader(DONE);
    expect(screen.getByRole('status', { name: 'Last data update' })).toBeInTheDocument();
    expect(screen.getByText('Today 05:16')).toBeInTheDocument();
    expect(screen.getByText('91 new mentions · 14 companies with updates · Discord sent')).toBeInTheDocument();
    expect(screen.getByText('91')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('out of 258')).toBeInTheDocument();
    expect(screen.getByText('News coverage of 258 portfolio companies')).toBeInTheDocument();
    expect(screen.getByText('Last 90 days')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.queryByText(/negative/i)).not.toBeInTheDocument();
  });

  it('the coverage card: companies mentioned out of all, in the window, with no arrow (Prompt 334)', () => {
    renderHeader(DONE);
    expect(screen.getByText('138')).toBeInTheDocument();
    expect(screen.getByText('/ 258', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('companies mentioned')).toBeInTheDocument();
    expect(screen.getByText('in the last 90 days')).toBeInTheDocument();
    expect(screen.queryByText(/↑|↓/)).not.toBeInTheDocument();
  });

  it('the status: running, failed, stale, no run yet', () => {
    expect(updateStatus(DONE, NOW).tone).toBe('ok');
    expect(updateStatus({ ...DONE, latest: { ...DONE.latest, id: 3, status: 'running' } }, NOW).tone).toBe('running');
    expect(updateStatus({ ...DONE, latest: { ...DONE.latest, id: 3, status: 'failed' } }, NOW).tone).toBe('failed');
    expect(updateStatus(DONE, Date.parse(LAST_DONE.finishedAt) + STALE_AFTER_MS + 1).tone).toBe('stale');
    expect(updateStatus({ latest: null, lastDone: null }, NOW).tone).toBe('none');
  });

  it('no daily run yet: says the data is from the 90-day collection, and shows no cards', () => {
    renderHeader({ latest: null, lastDone: null });
    expect(screen.getByRole('status', { name: 'No daily run yet' })).toBeInTheDocument();
    expect(screen.getByText('The data is from the 90-day collection')).toBeInTheDocument();
    expect(screen.queryByText('new mentions')).not.toBeInTheDocument();
    expect(screen.getByText('companies mentioned')).toBeInTheDocument(); // coverage needs no daily run
  });

  it('a run whose Discord message was not sent says so', () => {
    renderHeader({ ...DONE, lastDone: { ...LAST_DONE, discordSent: false } });
    expect(screen.getByText(/Discord not sent/)).toBeInTheDocument();
  });

  it('update times: Today / Yesterday / a date, in Israel time', () => {
    expect(formatUpdateTime('2026-09-29T02:16:00.000Z', 'Asia/Jerusalem', NOW)).toBe('Today 05:16');
    expect(formatUpdateTime('2026-09-28T02:16:00.000Z', 'Asia/Jerusalem', NOW)).toBe('Yesterday 05:16');
    expect(formatUpdateTime('2026-09-26T02:16:00.000Z', 'Asia/Jerusalem', NOW)).toBe('Sat 26 Sep 05:16');
  });
});

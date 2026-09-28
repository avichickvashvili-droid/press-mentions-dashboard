// MentionsPanel.pages.test.jsx — the panel's pages (owner, Prompt 265, D101): 20 per page, the
// page nav and its disabled buttons, no nav for 20 or fewer, page 1 again for another company,
// and that a page change really brings the panel back to its top. The fetch is a fake.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MENTIONS_PER_PAGE, MentionsPanel } from './MentionsPanel.jsx';
import { jsonResponse, makeQueryWrapper, stubFetch } from '../../test/testTools.jsx';

// An api answer with `count` mentions for the company; headlines "<id> story 1", "<id> story 2", ...
function mentionsAnswer(id, count) {
  return {
    company: { id, name: id },
    mentions: Array.from({ length: count }, (_, index) => ({
      title: `${id} story ${index + 1}`,
      url: `https://news.google.com/${id}/${index + 1}`,
      publisher: 'Example News',
      publishedAt: '2026-09-20T09:00:00.000Z',
      sentiment: 'neutral',
    })),
  };
}

// A fake api: harvey has 45 mentions, ukko 20, anthropic 61.
function fakeApi() {
  const counts = { harvey: 45, ukko: 20, anthropic: 61 };
  stubFetch((url) => {
    const id = url.split('/')[3];
    return jsonResponse(mentionsAnswer(id, counts[id]));
  });
}

// The headlines on screen.
const headlines = () => screen.getAllByRole('link').map((link) => link.textContent);
const button = (name) => screen.getByRole('button', { name });

describe('MentionsPanel pages', () => {
  it('20 per page, with First / Previous / Next / Last and the right buttons disabled', async () => {
    fakeApi();
    const { wrapper } = makeQueryWrapper();
    render(<MentionsPanel companyId="harvey" companyName="harvey" />, { wrapper });
    await screen.findByText('Page 1 of 3');
    expect(MENTIONS_PER_PAGE).toBe(20);
    expect(headlines()).toHaveLength(20);
    expect(headlines()[0]).toBe('harvey story 1');
    expect(button('« First')).toBeDisabled();
    expect(button('‹ Previous')).toBeDisabled();
    expect(button('Next ›')).toBeEnabled();

    fireEvent.click(button('Next ›'));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(headlines()[0]).toBe('harvey story 21');

    fireEvent.click(button('Last »'));
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(headlines()).toEqual(['harvey story 41', 'harvey story 42', 'harvey story 43', 'harvey story 44', 'harvey story 45']);
    expect(button('Next ›')).toBeDisabled();
    expect(button('Last »')).toBeDisabled();

    fireEvent.click(button('‹ Previous'));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    fireEvent.click(button('« First'));
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('20 or fewer mentions: no page nav', async () => {
    fakeApi();
    const { wrapper } = makeQueryWrapper();
    render(<MentionsPanel companyId="ukko" companyName="ukko" />, { wrapper });
    expect(await screen.findAllByRole('link')).toHaveLength(20);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('another company starts again at page 1', async () => {
    fakeApi();
    const { wrapper } = makeQueryWrapper();
    const { rerender } = render(<MentionsPanel companyId="harvey" companyName="harvey" />, { wrapper });
    await screen.findByText('Page 1 of 3');
    fireEvent.click(button('Last »'));
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();

    rerender(<MentionsPanel companyId="anthropic" companyName="anthropic" />);
    expect(await screen.findByText('Page 1 of 4')).toBeInTheDocument();
    expect(headlines()[0]).toBe('anthropic story 1');
  });

  it('wide screen: changing the page puts the scroll area around the panel back at its top', async () => {
    fakeApi();
    const { wrapper } = makeQueryWrapper();
    // The panel inside a scroll area, like App's .panelArea. jsdom has no layout, so the scroll
    // position is a plain value on this one element (nothing global is changed).
    const scrollArea = document.createElement('section');
    document.body.appendChild(scrollArea);
    Object.defineProperty(scrollArea, 'scrollTop', { value: 0, writable: true, configurable: true });
    try {
      render(<MentionsPanel companyId="harvey" companyName="harvey" />, { wrapper, container: scrollArea });
      await screen.findByText('Page 1 of 3');
      scrollArea.scrollTop = 750; // the user scrolled down the list
      fireEvent.click(button('Next ›'));
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
      expect(scrollArea.scrollTop).toBe(0);
    } finally {
      scrollArea.remove();
    }
  });

  it('narrow screen: when the panel top is above the screen, the page scrolls up to it; otherwise it does not move', async () => {
    fakeApi();
    const { wrapper } = makeQueryWrapper();
    render(<MentionsPanel companyId="harvey" companyName="harvey" />, { wrapper });
    await screen.findByText('Page 1 of 3');
    const panel = screen.getByRole('complementary', { name: 'Mentions of harvey' });
    // Only this element gets the fake layout and scroll method (jsdom has neither), so nothing
    // leaks into other tests even if an assertion fails.
    let top = -400;
    panel.getBoundingClientRect = () => ({ top, bottom: top + 2000, left: 0, right: 0, width: 0, height: 2000 });
    panel.scrollIntoView = vi.fn(() => { top = 0; });

    fireEvent.click(button('Next ›'));
    expect(panel.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(panel.getBoundingClientRect().top).toBe(0);

    panel.scrollIntoView.mockClear();
    fireEvent.click(button('Next ›'));
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(panel.scrollIntoView).not.toHaveBeenCalled();
  });
});

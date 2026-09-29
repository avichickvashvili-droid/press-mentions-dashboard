// IconMenu.test.jsx — the icon button with its small menu (owner, Prompt 331): the button's
// accessible name and aria attributes, opening, choosing (the menu closes, focus back on the
// button), Esc, a click outside, the arrow keys, the counts and ✓ on the current choice, the dot
// of a non-default choice, the removable pill, and where the menu is placed.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivePill, FilterIcon, IconMenu, menuPosition } from './IconMenu.jsx';

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'pos', label: 'Positive', tone: 'positive' },
  { value: 'neg', label: 'Negative', tone: 'negative' },
];

// Draws a menu with the value 'all' (or `value`) and returns the onChange spy.
function renderMenu({ value = 'all', active = false } = {}) {
  const onChange = vi.fn();
  render(
    <>
      <p>Outside</p>
      <IconMenu label="Sentiment" icon={<FilterIcon />} active={active} sections={[{ options: OPTIONS, counts: { all: 1200, pos: 3, neg: 0 }, value, onChange }]} />
    </>,
  );
  return onChange;
}

const iconButton = () => screen.getByRole('button', { name: 'Sentiment' });

describe('IconMenu', () => {
  it('a named icon button with aria-haspopup / aria-expanded; opens a menu of radio items with counts', () => {
    renderMenu();
    const button = iconButton();
    expect(button).toHaveAttribute('title', 'Sentiment');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Sentiment' })).toBeInTheDocument();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(['All (1,200)', 'Positive (3)', 'Negative (0)']);
    expect(screen.getByRole('menuitemradio', { name: 'All (1,200)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Positive (3)' })).toHaveAttribute('aria-checked', 'false');
    expect(document.activeElement).toBe(items[0]); // the current choice gets the focus
  });

  it('choosing an item reports it, closes the menu and puts the focus back on the button', () => {
    const onChange = renderMenu();
    fireEvent.click(iconButton());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Negative (0)' }));
    expect(onChange).toHaveBeenCalledWith('neg');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(iconButton());
  });

  it('choosing the current item again closes the menu without a change', () => {
    const onChange = renderMenu();
    fireEvent.click(iconButton());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All (1,200)' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a section with reselect reports a click on the current item too (the sort reverses, Prompt 335)', () => {
    const onChange = vi.fn();
    render(<IconMenu label="Sort" icon={<FilterIcon />} sections={[{ options: OPTIONS, value: 'all', reselect: true, onChange }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(screen.getAllByRole('menuitemradio')[0]);
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('Esc closes it (focus back on the button); a click outside closes it; the button toggles it', () => {
    renderMenu();
    fireEvent.click(iconButton());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(iconButton());

    fireEvent.click(iconButton());
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(iconButton());
    fireEvent.pointerDown(screen.getByRole('menuitemradio', { name: 'Positive (3)' })); // inside: stays open
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(iconButton());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keyboard: ↓ on the button opens it; ↓ / ↑ / End / Home move; Enter chooses', () => {
    const onChange = renderMenu({ value: 'pos' });
    fireEvent.keyDown(iconButton(), { key: 'ArrowDown' });
    const items = screen.getAllByRole('menuitemradio');
    expect(document.activeElement).toBe(items[1]); // the current choice
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]); // wraps round
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document.activeElement, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.click(document.activeElement); // what Enter / Space do on a button
    expect(onChange).toHaveBeenCalledWith('neg');
  });

  it('a dot on the icon only when a non-default choice is on', () => {
    const { rerender } = render(<IconMenu label="Sort" icon={<FilterIcon />} active={false} sections={[{ options: OPTIONS, value: 'all', onChange: () => {} }]} />);
    const button = screen.getByRole('button', { name: 'Sort' });
    expect(button.children).toHaveLength(1); // only the icon
    rerender(<IconMenu label="Sort" icon={<FilterIcon />} active sections={[{ options: OPTIONS, value: 'pos', onChange: () => {} }]} />);
    expect(button.children).toHaveLength(2); // icon + dot
  });

  it('section titles label their groups', () => {
    render(<IconMenu label="Filter" icon={<FilterIcon />} sections={[{ title: 'Time', options: OPTIONS, value: 'all', onChange: () => {} }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByRole('group', { name: 'Time' })).toBeInTheDocument();
    expect(screen.getByText('Time')).toBeInTheDocument();
  });

  it('the pill shows the choice; clicking it removes it', () => {
    const onRemove = vi.fn();
    render(<ActivePill label="Negative" onRemove={onRemove} />);
    const pill = screen.getByRole('button', { name: 'Remove Negative' });
    expect(pill).toHaveTextContent('Negative');
    fireEvent.click(pill);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('menuPosition', () => {
  const rect = { top: 100, bottom: 136, right: 900 };

  it('under the button, right edges lined up', () => {
    expect(menuPosition(rect, 240, 200, 1440, 900)).toEqual({ top: 142, left: 660 });
  });

  it('above the button when there is no room below; never off the left or right edge', () => {
    expect(menuPosition({ top: 700, bottom: 736, right: 900 }, 240, 300, 1440, 900)).toEqual({ top: 394, left: 660 });
    expect(menuPosition({ top: 100, bottom: 136, right: 120 }, 240, 200, 390, 800).left).toBe(8);
    expect(menuPosition({ top: 100, bottom: 136, right: 1500 }, 240, 200, 1440, 800).left).toBe(1192);
  });
});

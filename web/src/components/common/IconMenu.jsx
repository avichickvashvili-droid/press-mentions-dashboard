// IconMenu.jsx — a small icon button that opens a menu of choices (owner, Prompt 331): the sort
// and the filter of the company table, and the time range and sentiment of the mentions panel
// (Prompt 332). Also the small
// removable "pill" that shows a choice that is not the default (e.g. "Mentioned this week ×"),
// and the icons they use (drawn as inline SVG: the page's CSP allows no image data).
//
// Where it sits: in TableControls (above the company table) and in the MentionsPanel.
// Reads/writes: nothing itself; a choice is reported with the section's onChange(value).
//
// The menu is drawn at the end of the page (a React portal) with a fixed position under the
// button, right-aligned (above it when there is no room below), so no card, scroll area or
// sticky table header can cut it off or cover it. It follows the button when the page scrolls.
// It closes when a choice is made, on Esc or Tab (focus goes back to the button), and on a click
// anywhere outside it. Keys: ↓ / ↑ / Home / End move between the choices, Enter / Space choose.
// Screen readers: the button has aria-haspopup / aria-expanded; the menu is role="menu" with one
// role="group" per section and role="menuitemradio" + aria-checked items.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './IconMenu.module.css';

// Space (px) between the button and the menu, and the menu and the edge of the window.
const GAP = 6;
const EDGE = 8;

// The up/down arrows of the sort button.
export function SortIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M5 13V3M2.5 5.5L5 3l2.5 2.5M11 3v10M8.5 10.5L11 13l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The owner's filter icon: three centred lines, each shorter (a funnel made of lines).
export function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M2 4h12M4.5 8h7M6.75 12h2.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

// A clock: the time range of the mentions panel.
export function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The ✓ in front of the current choice.
function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A choice that is not the default, e.g. "Mentioned this week ×". Clicking it goes back to the
// default (`onRemove()`); its name for screen readers says so.
export function ActivePill({ label, onRemove }) {
  // Without onRemove it only shows the choice (e.g. the default sort): no ×, not a button.
  if (!onRemove) return <span className={`${styles.pill} ${styles.pillPlain}`}>{label}</span>;
  return (
    <button type="button" className={styles.pill} onClick={onRemove} aria-label={`Remove ${label}`} title={`Remove ${label}`}>
      <span>{label}</span>
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
        <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// "Mentioned this week (2)" — the item's name, with its count when there is one.
function itemName(option, counts) {
  if (!counts) return option.label;
  return `${option.label} (${(counts[option.value] ?? 0).toLocaleString('en-US')})`;
}

// Where the menu goes (fixed, in window pixels): under the button, its right edge on the
// button's right edge; above the button when it does not fit below; never past the window's
// left edge.
export function menuPosition(buttonRect, menuWidth, menuHeight, viewWidth, viewHeight) {
  let top = buttonRect.bottom + GAP;
  const above = buttonRect.top - GAP - menuHeight;
  if (top + menuHeight > viewHeight - EDGE && above >= EDGE) top = above;
  const left = Math.max(EDGE, Math.min(buttonRect.right - menuWidth, viewWidth - EDGE - menuWidth));
  return { top, left };
}

// `label` = the button's name and tooltip ("Sort", "Filter companies"); `icon` = its picture;
// `active` = a non-default choice is on (a small dot on the icon);
// `sections` = [{ title?, options: [{ value, label, tone? }], value, counts?, onChange(value), reselect? }]
// (`reselect`: a click on the current choice is reported too — the sort uses it to reverse, Prompt 335)
// (a `tone` — positive / neutral / negative — gives the item the page's sentiment colours).
export function IconMenu({ label, icon, active = false, sections }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  // Closes the menu; with `refocus`, the focus goes back to the button (Esc, Tab, a choice).
  const close = useCallback((refocus) => {
    setOpen(false);
    setPosition(null);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // Puts the menu under its button (again after a scroll or a resize of the window).
  const place = useCallback(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const view = document.documentElement;
    setPosition(menuPosition(button.getBoundingClientRect(), menu.offsetWidth, menu.offsetHeight, view.clientWidth || window.innerWidth, window.innerHeight));
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // On open: the focus goes to the current choice. A press outside the button and the menu closes it.
  useEffect(() => {
    if (!open) return undefined;
    const items = menuItems(menuRef.current);
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
    const onPointerDown = (event) => {
      if (buttonRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, close]);

  // The keys inside the open menu.
  const onMenuKeyDown = (event) => {
    const items = menuItems(menuRef.current);
    const at = items.indexOf(document.activeElement);
    const moves = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 };
    if (event.key in moves && items.length > 0) {
      event.preventDefault();
      items[(moves[event.key] + items.length) % items.length].focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close(true);
    }
  };

  // ↓ on the closed button opens the menu too (like a select box).
  const onButtonKeyDown = (event) => {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      setOpen(true);
    }
  };

  // A choice: report it, then close the menu.
  const choose = (section, value) => {
    close(true);
    if (value !== section.value || section.reselect) section.onChange(value);
  };

  const menu = open && createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className={styles.menu}
      style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' }}
      onKeyDown={onMenuKeyDown}
    >
      {sections.map((section, index) => (
        <div key={section.title ?? index} role="group" aria-label={section.title ?? label} className={styles.section}>
          {section.title && <div className={styles.sectionTitle} aria-hidden="true">{section.title}</div>}
          {section.options.map((option) => {
            const checked = option.value === section.value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                aria-label={itemName(option, section.counts)}
                tabIndex={-1}
                className={`${styles.item} ${checked ? styles.checked : ''}`}
                onClick={() => choose(section, option.value)}
              >
                <span className={styles.check}>{checked && <CheckIcon />}</span>
                <span className={`${styles.itemLabel} ${option.tone ? styles[option.tone] : ''}`}>
                  {option.tone && <span className={styles.dot} aria-hidden="true" />}
                  {option.label}
                </span>
                {section.counts && <span className={styles.count}>{(section.counts[option.value] ?? 0).toLocaleString('en-US')}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.iconButton} ${open ? styles.open : ''} ${active ? styles.active : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onButtonKeyDown}
      >
        {icon}
        {active && <span className={styles.badge} aria-hidden="true" />}
      </button>
      {menu}
    </>
  );
}

// The choices of an open menu, top to bottom.
function menuItems(menu) {
  return menu ? [...menu.querySelectorAll('[role="menuitemradio"]')] : [];
}

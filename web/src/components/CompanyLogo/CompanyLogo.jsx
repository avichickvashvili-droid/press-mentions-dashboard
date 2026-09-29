// CompanyLogo.jsx — a company's small logo, or a coloured letter badge ("SX") when there is none
// or it can't be loaded (owner, Prompt 318, D112).
//
// Where it sits: in each row of the company table and at the top of the mentions panel.
// Reads: the logo address the api sends (logoUrl, "/logos/<file>"), or null.
// The image loads only when its row comes into view (loading="lazy"); the browser then keeps it
// in its cache for 30 days (the api's Cache-Control). The logo is decoration next to the name,
// so screen readers skip it (alt="").

import { useState } from 'react';
import styles from './CompanyLogo.module.css';

// The badge colours: a company always gets the same one (picked from its name).
const BADGE_COLOURS = ['#0969da', '#8250df', '#bf3989', '#cf222e', '#bc4c00', '#4d2d00', '#1a7f37', '#0a3069'];

// Up to two letters for the badge: the first letters of the first two words ("Scale AI" -> "SA"),
// or the first two letters of a one-word name ("SpaceX" -> "SP"). Only letters and digits count.
export function initials(name) {
  const words = String(name ?? '').split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// The badge colour for a name (always the same for the same name).
export function badgeColour(name) {
  let sum = 0;
  for (const ch of String(name ?? '')) sum = (sum * 31 + ch.codePointAt(0)) % 1000003;
  return BADGE_COLOURS[sum % BADGE_COLOURS.length];
}

// `name` = the company name; `logoUrl` = its logo or null; `size` = 'small' (table) or 'large' (panel).
export function CompanyLogo({ name, logoUrl, size = 'small' }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const className = `${styles.logo} ${styles[size]}`;
  if (logoUrl && failedUrl !== logoUrl) {
    return <img className={className} src={logoUrl} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(logoUrl)} />;
  }
  return (
    <span className={`${className} ${styles.badge}`} style={{ backgroundColor: badgeColour(name) }} aria-hidden="true" data-testid="logo-badge">
      {initials(name)}
    </span>
  );
}

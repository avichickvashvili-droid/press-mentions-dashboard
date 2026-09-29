// visuals.jsx — small drawing pieces of the Overview page (D117): a number that counts up when it
// first shows, a mini line chart (sparkline), a progress ring, a three-part sentiment bar, and the
// chart colours of the current theme.
//
// Where it sits: used by the Overview components. No data loading here.
// The count-up and the charts' own animations are skipped when the viewer asked the system for
// less motion (prefers-reduced-motion), and in the tests (the final number shows at once).

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatCount } from '../../utils/activity.js';
import styles from './Overview.module.css';

// True when animations should be skipped: the viewer's "reduce motion" setting, or the tests.
export function prefersLessMotion() {
  if (import.meta.env?.MODE === 'test') return true;
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

// A whole number that counts up from 0 (or from its last value) to `value` in `durationMs`.
export function CountUp({ value, durationMs = 900 }) {
  const target = Number(value ?? 0);
  const [shown, setShown] = useState(() => (prefersLessMotion() ? target : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (prefersLessMotion() || typeof window.requestAnimationFrame !== 'function') {
      setShown(target);
      return undefined;
    }
    const start = performance.now();
    const begin = from.current;
    let frame;
    const step = (time) => {
      const t = Math.min(1, (time - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(begin + (target - begin) * eased);
      from.current = next;
      setShown(next);
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return <span className={styles.tabular}>{formatCount(shown)}</span>;
}

// A mini line chart with a soft fill under it. `values` = numbers, oldest first; `tone` = a colour
// class (positive / negative / accent / muted): the line uses the text colour of that class.
export function Sparkline({ values, tone = 'accent', width = 120, height = 34, label }) {
  const id = `spark${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!values?.length) return null;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => [i * step, height - 3 - (v / max) * (height - 6)]);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg className={`${styles.spark} ${styles[tone]}`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// A progress ring: `part` of `whole`, with the percent in the middle.
export function Ring({ part, whole, size = 64 }) {
  const share = whole > 0 ? part / whole : 0;
  const r = size / 2 - 5;
  const length = 2 * Math.PI * r;
  return (
    <svg className={styles.ring} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(share * 100)}% of the companies`}>
      <circle className={styles.ringTrack} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="7" />
      <circle
        className={styles.ringValue}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(share * length).toFixed(1)} ${length.toFixed(1)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text className={styles.ringText} x="50%" y="50%" dominantBaseline="central" textAnchor="middle">{Math.round(share * 100)}%</text>
    </svg>
  );
}

// A three-part bar: positive / neutral / negative, by count.
export function SplitBar({ positive = 0, neutral = 0, negative = 0, thin = false }) {
  const total = positive + neutral + negative;
  if (!total) return <div className={`${styles.split} ${thin ? styles.splitThin : ''}`} />;
  const part = (n) => `${(n / total) * 100}%`;
  return (
    <div className={`${styles.split} ${thin ? styles.splitThin : ''}`} title={`${positive} positive · ${neutral} neutral · ${negative} negative`}>
      <span className={styles.bgPositive} style={{ width: part(positive) }} />
      <span className={styles.bgNeutral} style={{ width: part(neutral) }} />
      <span className={styles.bgNegative} style={{ width: part(negative) }} />
    </div>
  );
}

// The chart colours of the current theme, read from the colour variables of styles/global.css
// (the chart library needs real colours, not var(--...)). `theme` = 'dark' | 'light': read again
// when it changes. Falls back to fixed colours where the variables can't be read (the tests).
export function useChartColors(theme) {
  return useMemo(() => {
    const css = typeof window !== 'undefined' ? window.getComputedStyle(document.documentElement) : null;
    const read = (name, fallback) => (css?.getPropertyValue(name).trim() || fallback);
    return {
      positive: read('--positive', '#34d399'),
      neutral: read('--neutral', '#8b9bb4'),
      negative: read('--negative', '#f87171'),
      accent: read('--accent', '#6c8cff'),
      grid: read('--grid-line', '#1c2740'),
      muted: read('--muted', '#8d9ab3'),
      card: read('--card-bg', '#111a2d'),
      text: read('--text', '#e8edf6'),
      theme,
    };
  }, [theme]);
}

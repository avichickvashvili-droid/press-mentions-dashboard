// MentionsOverTime.jsx — "Mentions over time" (D117): mentions per Israel day (or per week) of the
// 90 days, stacked by sentiment, with glowing gradient areas, a Daily / Weekly switch, a legend
// that hides or shows each sentiment, and a tooltip with the day's numbers.
//
// Where it sits: in OverviewPage. Reads: its props (the overview's `daily`). Draws with Recharts.

import { useId, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount } from '../../utils/activity.js';
import { chartPoints } from '../../utils/overview.js';
import { prefersLessMotion } from './visuals.jsx';
import styles from './Overview.module.css';

const SERIES = [
  { key: 'positive', label: 'Positive' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'negative', label: 'Negative' },
];

// The hover box: the day (or week), each sentiment and the total.
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{label}</div>
      {SERIES.map((s) => (
        <div key={s.key} className={styles.tooltipRow}>
          <span className={`${styles.dot} ${styles[`bg${s.label}`]}`} />{s.label}<b>{formatCount(point[s.key])}</b>
        </div>
      ))}
      <div className={`${styles.tooltipRow} ${styles.tooltipTotal}`}>Total<b>{formatCount(point.total)}</b></div>
    </div>
  );
}

// `daily` = [{ day, positive, neutral, negative }]; `colors` = useChartColors().
export function MentionsOverTime({ daily, colors }) {
  const [mode, setMode] = useState('daily');
  const [hidden, setHidden] = useState(() => new Set());
  const gradientId = `mot${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const points = useMemo(() => chartPoints(daily, mode), [daily, mode]);
  const peak = points.reduce((best, p) => (p.total > (best?.total ?? -1) ? p : best), null);
  const animate = !prefersLessMotion();

  // Hides or shows one sentiment (never all three).
  const toggle = (key) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else if (next.size < SERIES.length - 1) next.add(key);
    return next;
  });

  return (
    <section className={`${styles.card} ${styles.chartCard}`} aria-label="Mentions over time">
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Mentions over time</h2>
          <p className={styles.cardSub}>
            {mode === 'daily' ? 'Per day' : 'Per week'}, by sentiment
            {peak && <> · peak <b>{formatCount(peak.total)}</b> on {peak.label}</>}
          </p>
        </div>
        <div className={styles.segmented} role="group" aria-label="Chart period">
          {['daily', 'weekly'].map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? styles.segOn : ''} onClick={() => setMode(m)}>
              {m === 'daily' ? 'Daily' : 'Weekly'}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.chartBox}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <defs>
              {SERIES.map((s) => (
                <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={colors[s.key]} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={colors[s.key]} stopOpacity={0.04} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: colors.muted, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis tick={{ fill: colors.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={52} tickFormatter={formatCount} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.accent, strokeOpacity: 0.4 }} />
            {SERIES.filter((s) => !hidden.has(s.key)).map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId="all"
                stroke={colors[s.key]}
                strokeWidth={2}
                fill={`url(#${gradientId}-${s.key})`}
                isAnimationActive={animate}
                animationDuration={900}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.legend} role="group" aria-label="Show or hide a sentiment">
        {SERIES.map((s) => (
          <button key={s.key} type="button" className={styles.legendItem} aria-pressed={!hidden.has(s.key)} onClick={() => toggle(s.key)}>
            <span className={`${styles.dot} ${styles[`bg${s.label}`]}`} />{s.label}
          </button>
        ))}
      </div>
    </section>
  );
}

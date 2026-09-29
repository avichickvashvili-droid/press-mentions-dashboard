// SentimentByMonth.jsx — "Mentions by month" (D117): one stacked bar per month of the window
// (Israel months), positive / neutral / negative, with the month's total on top.
//
// Where it sits: in OverviewPage, beside Mentions over time. Reads: the overview's `monthly`.
// Note: the first and the last month of a rolling 90-day window are usually not whole months.

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount } from '../../utils/activity.js';
import { formatMonthLabel, sentimentShares } from '../../utils/overview.js';
import { prefersLessMotion } from './visuals.jsx';
import styles from './Overview.module.css';

// The hover box: the month with each sentiment's count and share.
function MonthTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const shares = sentimentShares(point);
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{point.label}</div>
      {[['positive', 'Positive'], ['neutral', 'Neutral'], ['negative', 'Negative']].map(([key, label]) => (
        <div key={key} className={styles.tooltipRow}>
          <span className={`${styles.dot} ${styles[`bg${label}`]}`} />{label}<b>{formatCount(point[key])} · {shares[key]}%</b>
        </div>
      ))}
      <div className={`${styles.tooltipRow} ${styles.tooltipTotal}`}>Total<b>{formatCount(point.total)}</b></div>
    </div>
  );
}

// `monthly` = [{ month, positive, neutral, negative }]; `colors` = useChartColors().
export function SentimentByMonth({ monthly, colors }) {
  const data = monthly.map((m) => ({ ...m, label: formatMonthLabel(m.month), total: m.positive + m.neutral + m.negative }));
  const animate = !prefersLessMotion();
  return (
    <section className={`${styles.card} ${styles.chartCard}`} aria-label="Mentions by month">
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>Mentions by month</h2>
          <p className={styles.cardSub}>By sentiment, Israel time</p>
        </div>
      </div>
      <div className={styles.chartBox}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: colors.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: colors.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={52} tickFormatter={formatCount} />
            <Tooltip content={<MonthTooltip />} cursor={{ fill: colors.accent, fillOpacity: 0.08 }} />
            <Bar dataKey="positive" stackId="m" fill={colors.positive} isAnimationActive={animate} animationDuration={800} />
            <Bar dataKey="neutral" stackId="m" fill={colors.neutral} isAnimationActive={animate} animationDuration={800} />
            <Bar dataKey="negative" stackId="m" fill={colors.negative} radius={[6, 6, 0, 0]} isAnimationActive={animate} animationDuration={800}>
              <LabelList dataKey="total" position="top" formatter={formatCount} fill={colors.text} fontSize={12} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}><span className={`${styles.dot} ${styles.bgPositive}`} />Positive</span>
        <span className={styles.legendItem}><span className={`${styles.dot} ${styles.bgNeutral}`} />Neutral</span>
        <span className={styles.legendItem}><span className={`${styles.dot} ${styles.bgNegative}`} />Negative</span>
      </div>
    </section>
  );
}

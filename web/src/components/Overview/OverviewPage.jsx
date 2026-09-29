// OverviewPage.jsx — the Overview page (owner, Prompt 364, D117): the page opens here. The number
// cards, Mentions over time + by month, Top companies + Needs attention, and Recent mentions.
// Clicking a company anywhere opens it on the Companies page.
//
// Where it sits: drawn by App.jsx when the page is 'overview'.
// Reads: GET /api/overview through useOverview; the company list (for Top companies and the
// daily run) comes from App.jsx, which already loads it.

import { useOverview } from '../../hooks/useOverview.js';
import { Loading } from '../common/Loading.jsx';
import { ErrorMessage } from '../common/ErrorMessage.jsx';
import { KpiCards } from './KpiCards.jsx';
import { MentionsOverTime } from './MentionsOverTime.jsx';
import { SentimentByMonth } from './SentimentByMonth.jsx';
import { TopCompanies } from './TopCompanies.jsx';
import { NeedsAttention } from './NeedsAttention.jsx';
import { RecentMentions } from './RecentMentions.jsx';
import { useChartColors } from './visuals.jsx';
import styles from './Overview.module.css';

// `companies` = the company list; `dailyRun` = its dailyRun; `theme` = 'dark' | 'light' (the
// charts' colours follow it); `onOpenCompany(id)`; `onViewCompanies()`.
export function OverviewPage({ companies, dailyRun, theme, onOpenCompany, onViewCompanies }) {
  const query = useOverview();
  const colors = useChartColors(theme);
  if (query.isPending) return <Loading text="Loading the overview ..." />;
  if (query.isError) return <ErrorMessage message={query.error?.message ?? 'The overview could not be loaded.'} onRetry={query.refetch} />;
  const overview = query.data;
  const now = Date.parse(overview.asOf) || Date.now();
  return (
    <div className={styles.overview}>
      <KpiCards overview={overview} dailyRun={dailyRun} now={now} />
      <div className={`${styles.grid} ${styles.gridCharts}`}>
        <MentionsOverTime daily={overview.daily} colors={colors} />
        <SentimentByMonth monthly={overview.monthly} colors={colors} />
      </div>
      <div className={`${styles.grid} ${styles.gridLists}`}>
        <TopCompanies companies={companies} onOpen={onOpenCompany} onViewAll={onViewCompanies} />
        <NeedsAttention items={overview.attention} onOpen={onOpenCompany} />
      </div>
      <RecentMentions mentions={overview.recent} onOpen={onOpenCompany} now={now} />
    </div>
  );
}

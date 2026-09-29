// App.jsx — the page frame: the side menu and one of two pages (owner, Prompt 364, D117):
//   Overview   (the default) the number cards, charts and lists (components/Overview/)
//   Companies  the company table and the selected company's mentions beside it (stacked when the
//              space is narrow)
//
// Where it sits: drawn by src/main.jsx inside the error boundary and the TanStack Query provider.
// Reads: the company list through the useCompanies hook (never fetch directly, D100). Both pages
// use it (the Overview for Top companies and the daily run).
//
// State (D98, D100): no router. The page is ?page=companies in the address (usePage, D117; the
// Overview has no ?page=), the selected company ?company=<id> (useSelectedCompany, D109), so F5
// keeps both and Back goes to the page before. Clicking a company on the Overview opens it on the
// Companies page. Going to the Overview closes the open company (Prompts 365-366): its address
// has no ?company=, and Companies opens with no company selected. The theme (dark by default) is useTheme's.
// The table order is worked out with useMemo over the loaded list (src/utils/sortCompanies.js).
// Search (D103): the search text is useState here, so a reload of the data never clears it. The
// table is narrowed with useMemo on top of the sorted list (src/utils/filterCompanies.js), on
// every keystroke; useDeferredValue keeps typing smooth. The open company's mentions stay open
// even when the search hides that company's row.
// The table's controls (owner's design, Prompts 317-322, D110; icons, Prompt 331): the sort
// choice and the filter (All / Mentioned this week / Mentioned / No coverage) are state here too,
// so a reload keeps them. The list is sorted first, then the search narrows it, then the filter;
// the filter counts follow the search. The × of the mentions panel closes it.
// Live updates (D106): useDataUpdates reloads every 'companies' query (the list, the overview and
// the open mentions) when the daily job has added new data. There is no Refresh button (owner,
// Prompt 330): the page also reloads when you come back to its tab and at midnight.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanies } from './hooks/useCompanies.js';
import { useSelectedCompany } from './hooks/useSelectedCompany.js';
import { useDataUpdates } from './hooks/useDataUpdates.js';
import { usePage } from './hooks/usePage.js';
import { useTheme } from './hooks/useTheme.js';
import { DEFAULT_SORT_CHOICE, sortCompanies, sortForChoice } from './utils/sortCompanies.js';
import { filterCompanies } from './utils/filterCompanies.js';
import { applyCompanyFilter, countCompanyFilters } from './utils/companyFilters.js';
import { Hero } from './components/Hero/Hero.jsx';
import { Sidebar } from './components/Sidebar/Sidebar.jsx';
import { OverviewPage } from './components/Overview/OverviewPage.jsx';
import { CompanyTable } from './components/CompanyTable/CompanyTable.jsx';
import { TableControls } from './components/TableControls/TableControls.jsx';
import { MentionsPanel } from './components/MentionsPanel/MentionsPanel.jsx';
import { Loading } from './components/common/Loading.jsx';
import { ErrorMessage } from './components/common/ErrorMessage.jsx';
import styles from './App.module.css';

// The company list part of the page, for each state of the query.
// `allCount` = companies before the search; `companies` = the ones that match it and the filter.
function CompanyListArea({ query, allCount, companies, searchText, selectedId, onSelect, flashId, flashAt }) {
  if (query.isPending) return <Loading text="Loading companies ..." />;
  if (query.isError) return <ErrorMessage message={query.error?.message ?? 'The company list could not be loaded.'} onRetry={query.refetch} />;
  if (allCount === 0) {
    return <p>No companies to show yet. The database has no data; see the api window for why (e.g. data/ could not be imported).</p>;
  }
  return (
    <CompanyTable
      companies={companies}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyMessage={searchText.trim() ? `No companies match "${searchText.trim()}"` : 'No companies in this group.'}
      windowDays={query.data?.windowDays}
      flashId={flashId}
      flashAt={flashAt}
    />
  );
}

// How long the row of a company opened from the Overview glows (two 0.9 s pulses, then a moment).
const JUMP_GLOW_MS = 2200;

// True when the Companies page shows the table and the panel stacked (one column): then the
// panel sits above the table and the page scrolls up to it when a company is opened.
function isStacked(columns) {
  if (!columns) return false;
  try {
    return window.getComputedStyle(columns).gridTemplateColumns.trim().split(/\s+/).length < 2;
  } catch {
    return false;
  }
}

// The whole page.
export function App() {
  const [page, goTo] = usePage();
  const [theme, toggleTheme] = useTheme();
  const [selectedId, setSelectedId] = useSelectedCompany();
  const columnsRef = useRef(null);
  const panelAreaRef = useRef(null);
  const [searchText, setSearchText] = useState('');
  const deferredSearchText = useDeferredValue(searchText);
  const [sortChoice, setSortChoice] = useState(DEFAULT_SORT_CHOICE);
  const [filter, setFilter] = useState('all');
  // A company just opened from the Overview: its row is scrolled to and glows (Prompt 370).
  const [jump, setJump] = useState(null);
  const companiesQuery = useCompanies();
  useDataUpdates();

  const companies = useMemo(() => sortCompanies(companiesQuery.data?.companies ?? [], sortForChoice(sortChoice)), [companiesQuery.data, sortChoice]);
  const searchedCompanies = useMemo(() => filterCompanies(companies, deferredSearchText), [companies, deferredSearchText]);
  const filterCounts = useMemo(() => countCompanyFilters(searchedCompanies), [searchedCompanies]);
  const visibleCompanies = useMemo(() => applyCompanyFilter(searchedCompanies, filter), [searchedCompanies, filter]);
  // Looked up in the whole list, so the panel keeps its title while the search hides the row.
  const selectedCompany = companies.find((company) => company.id === selectedId);
  const data = companiesQuery.data;

  // Opens a company on the Companies page. When the page is stacked (narrow), the panel sits
  // above the table, so the page scrolls up to it; on a wide screen it is already in view.
  const openCompany = (id) => {
    setSelectedId(id);
    const area = panelAreaRef.current;
    if (area && isStacked(columnsRef.current)) {
      window.requestAnimationFrame(() => area.scrollIntoView?.({ block: 'start' }));
    }
  };

  // From the Overview: go to the Companies page with that company open (one Back step), and jump
  // to its row in the table (Prompt 370).
  const openFromOverview = (id) => {
    goTo('companies', { company: id });
    setSelectedId(id);
    setJump({ id, at: Date.now() });
  };

  // The jump, once the Companies page is drawn: side by side, the table scrolls so the row is in
  // the middle of the screen (the panel stays in view beside it); stacked (narrow), the panel is
  // above the table, so the page scrolls to the panel. The row's glow ends after JUMP_GLOW_MS.
  useEffect(() => {
    if (!jump || page !== 'companies') return undefined;
    const frame = window.requestAnimationFrame(() => {
      const rows = columnsRef.current?.querySelectorAll('[data-company-id]') ?? [];
      const row = [...rows].find((element) => element.dataset.companyId === jump.id);
      const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (isStacked(columnsRef.current)) panelAreaRef.current?.scrollIntoView?.({ block: 'start' });
      else row?.scrollIntoView?.({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    });
    const timer = window.setTimeout(() => setJump(null), JUMP_GLOW_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [jump, page]);

  // On the Overview, the Companies page starts fresh next time: no open company (owner, Prompt
  // 366), no search, filter or sort (Prompt 370), and no jump still waiting. Done on the page
  // change itself, so the menu, Back and Forward all do it (code review #1, #4).
  useEffect(() => {
    if (page !== 'overview') return;
    setJump(null);
    setSearchText('');
    setFilter('all');
    setSortChoice(DEFAULT_SORT_CHOICE);
    if (selectedId) setSelectedId(null);
    // Only when the page changes (selectedId is read, not followed).
  }, [page]);

  // The side menu. The Overview's address has no ?company= (the effect above clears the rest).
  const navigate = (next) => {
    if (next === 'overview') goTo('overview', { company: null });
    else goTo(next, { company: selectedId });
  };

  // The hero band at the top of each page (D118): the Overview has the week's briefing, Companies
  // a plain line under its title.
  const header = (title) => (
    <Hero
      title={title}
      briefing={title === 'Overview'}
      subtitle={data?.companies ? `News coverage of ${data.companies.length} portfolio companies · click one to see its mentions` : null}
      companies={data?.companies ?? []}
      dailyRun={data?.dailyRun}
      asOf={data?.asOf}
      windowStart={data?.windowStart}
      windowDays={data?.windowDays}
      onOpenCompany={openFromOverview}
    />
  );

  return (
    <div className={styles.shell}>
      <Sidebar page={page} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} dailyRun={data?.dailyRun} />
      <div className={styles.page}>
        {page === 'overview' ? (
          <>
            {header('Overview')}
            <OverviewPage
              companies={data?.companies ?? []}
              dailyRun={data?.dailyRun}
              theme={theme}
              onOpenCompany={openFromOverview}
              onViewCompanies={() => navigate('companies')}
            />
          </>
        ) : (
          <>
            {header('Companies')}
            <main ref={columnsRef} className={styles.columns}>
              <section className={styles.tableArea}>
                <TableControls
                  searchText={searchText}
                  onSearch={setSearchText}
                  filter={filter}
                  filterCounts={filterCounts}
                  onFilter={setFilter}
                  sortChoice={sortChoice}
                  onSort={setSortChoice}
                />
                <CompanyListArea
                  flashId={jump?.id ?? null}
                  flashAt={jump?.at ?? null}
                  query={companiesQuery}
                  allCount={companies.length}
                  companies={visibleCompanies}
                  searchText={deferredSearchText}
                  selectedId={selectedId}
                  onSelect={openCompany}
                />
              </section>
              <section ref={panelAreaRef} className={`${styles.panelArea} ${selectedId ? styles.panelOpen : styles.panelEmpty}`}>
                <MentionsPanel
                  companyId={selectedId}
                  companyName={selectedCompany?.name}
                  logoUrl={selectedCompany?.logoUrl ?? null}
                  windowDays={data?.windowDays}
                  onClose={() => setSelectedId(null)}
                />
              </section>
            </main>
          </>
        )}
      </div>
    </div>
  );
}

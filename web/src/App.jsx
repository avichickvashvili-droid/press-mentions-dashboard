// App.jsx — the page layout: the header, the company table, and the selected company's mentions
// beside it (stacked on narrow screens).
//
// Where it sits: drawn by src/main.jsx inside the error boundary and the TanStack Query provider.
// Reads: the company list through the useCompanies hook (never fetch directly, D100).
//
// State (D98, D100): no router. The selected company is kept in the address as ?company=<id>
// (useSelectedCompany, D109), so F5 keeps it open and the link opens the same company. The table order is
// worked out with useMemo over the loaded list (src/utils/sortCompanies.js).
// Search (D103): the search text is useState here, so a reload of the data never clears it. The
// table is narrowed with useMemo on top of the sorted list (src/utils/filterCompanies.js), on
// every keystroke; useDeferredValue keeps typing smooth. The open company's mentions stay open
// even when the search hides that company's row.
// The table's controls (owner's design, Prompts 317-322, D110; icons, Prompt 331): the sort
// choice and the filter (All / Mentioned this week / Mentioned / No coverage) are state here too,
// so a reload keeps them. The list is sorted first, then the search narrows it, then the filter;
// the filter counts follow the search. The × of the mentions panel closes it.
// Live updates (D106): useDataUpdates reloads the same 'companies' queries when the daily job has
// added new data: every 'companies' query, the list and the open mentions. There is no Refresh
// button (owner, Prompt 330): the page also reloads when you come back to its tab and at midnight.

import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useCompanies } from './hooks/useCompanies.js';
import { useSelectedCompany } from './hooks/useSelectedCompany.js';
import { useDataUpdates } from './hooks/useDataUpdates.js';
import { DEFAULT_SORT_CHOICE, sortCompanies, sortForChoice } from './utils/sortCompanies.js';
import { filterCompanies } from './utils/filterCompanies.js';
import { applyCompanyFilter, countCompanyFilters } from './utils/companyFilters.js';
import { Header } from './components/Header/Header.jsx';
import { CompanyTable } from './components/CompanyTable/CompanyTable.jsx';
import { TableControls } from './components/TableControls/TableControls.jsx';
import { MentionsPanel } from './components/MentionsPanel/MentionsPanel.jsx';
import { Loading } from './components/common/Loading.jsx';
import { ErrorMessage } from './components/common/ErrorMessage.jsx';
import styles from './App.module.css';

// The company list part of the page, for each state of the query.
// `allCount` = companies before the search; `companies` = the ones that match it and the filter.
function CompanyListArea({ query, allCount, companies, searchText, selectedId, onSelect }) {
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
    />
  );
}

// The whole page.
export function App() {
  const [selectedId, setSelectedId] = useSelectedCompany();
  const panelAreaRef = useRef(null);
  const [searchText, setSearchText] = useState('');
  const deferredSearchText = useDeferredValue(searchText);
  const [sortChoice, setSortChoice] = useState(DEFAULT_SORT_CHOICE);
  const [filter, setFilter] = useState('all');
  const companiesQuery = useCompanies();
  useDataUpdates();

  const companies = useMemo(() => sortCompanies(companiesQuery.data?.companies ?? [], sortForChoice(sortChoice)), [companiesQuery.data, sortChoice]);
  const searchedCompanies = useMemo(() => filterCompanies(companies, deferredSearchText), [companies, deferredSearchText]);
  const filterCounts = useMemo(() => countCompanyFilters(searchedCompanies), [searchedCompanies]);
  const visibleCompanies = useMemo(() => applyCompanyFilter(searchedCompanies, filter), [searchedCompanies, filter]);
  // Looked up in the whole list, so the panel keeps its title while the search hides the row.
  const selectedCompany = companies.find((company) => company.id === selectedId);

  // Opens a company. When the page is stacked (narrow screen), the panel sits above the table, so
  // the page scrolls up to it; on a wide screen it is already in view beside the table.
  const openCompany = (id) => {
    setSelectedId(id);
    const area = panelAreaRef.current;
    if (area && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1199px)').matches) {
      window.requestAnimationFrame(() => area.scrollIntoView?.({ block: 'start' }));
    }
  };


  return (
    <div className={styles.page}>
      <Header
        asOf={companiesQuery.data?.asOf}
        windowStart={companiesQuery.data?.windowStart}
        windowDays={companiesQuery.data?.windowDays}
        companyCount={companiesQuery.data?.companies?.length}
        coveredCount={companiesQuery.data?.companies?.filter((company) => company.mentionCount > 0).length}
        dailyRun={companiesQuery.data?.dailyRun}
      />
      <main className={styles.columns}>
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
            windowDays={companiesQuery.data?.windowDays}
            onClose={() => setSelectedId(null)}
          />
        </section>
      </main>
    </div>
  );
}

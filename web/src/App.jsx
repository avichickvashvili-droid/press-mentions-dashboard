// App.jsx — the page layout: the header, the company table, and the selected company's mentions
// beside it (stacked on narrow screens).
//
// Where it sits: drawn by src/main.jsx inside the error boundary and the TanStack Query provider.
// Reads: the company list through the useCompanies hook (never fetch directly, D100).
//
// State (D98, D100): the selected company is plain useState (no router). The table order is
// worked out with useMemo over the loaded list (src/utils/sortCompanies.js). Refresh reloads
// everything that starts with the 'companies' query key: the list and the open mentions.
// Search (D103): the search text is useState here, so a reload of the data never clears it. The
// table is narrowed with useMemo on top of the sorted list (src/utils/filterCompanies.js), on
// every keystroke; useDeferredValue keeps typing smooth. The open company's mentions stay open
// even when the search hides that company's row.
// Click-to-sort (D104): the chosen sort is state here too (useTableSort), so a reload keeps it;
// the list is sorted first, then the search narrows it.

import { useDeferredValue, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCompanies, COMPANIES_KEY } from './hooks/useCompanies.js';
import { useTableSort } from './hooks/useTableSort.js';
import { sortCompanies } from './utils/sortCompanies.js';
import { filterCompanies } from './utils/filterCompanies.js';
import { Header } from './components/Header/Header.jsx';
import { CompanyTable } from './components/CompanyTable/CompanyTable.jsx';
import { CompanySearch } from './components/CompanySearch/CompanySearch.jsx';
import { MentionsPanel } from './components/MentionsPanel/MentionsPanel.jsx';
import { Loading } from './components/common/Loading.jsx';
import { ErrorMessage } from './components/common/ErrorMessage.jsx';
import styles from './App.module.css';

// The company list part of the page, for each state of the query.
// `allCount` = companies before the search; `companies` = the ones that match it.
function CompanyListArea({ query, allCount, companies, searchText, selectedId, onSelect, sort, onSort }) {
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
      emptyMessage={`No companies match "${searchText.trim()}"`}
      sort={sort}
      onSort={onSort}
    />
  );
}

// The whole page.
export function App() {
  const [selectedId, setSelectedId] = useState(null);
  const [searchText, setSearchText] = useState('');
  const deferredSearchText = useDeferredValue(searchText);
  const { sort, sortBy } = useTableSort();
  const companiesQuery = useCompanies();
  const queryClient = useQueryClient();

  const companies = useMemo(() => sortCompanies(companiesQuery.data?.companies ?? [], sort), [companiesQuery.data, sort]);
  const visibleCompanies = useMemo(() => filterCompanies(companies, deferredSearchText), [companies, deferredSearchText]);
  // Looked up in the whole list, so the panel keeps its title while the search hides the row.
  const selectedName = companies.find((company) => company.id === selectedId)?.name;

  // Reloads the list and the open company's mentions: one invalidate for every 'companies' key.
  const refresh = () => queryClient.invalidateQueries({ queryKey: [COMPANIES_KEY] });

  return (
    <div className={styles.page}>
      <Header
        asOf={companiesQuery.data?.asOf}
        windowStart={companiesQuery.data?.windowStart}
        windowDays={companiesQuery.data?.windowDays}
        onRefresh={refresh}
        isRefreshing={companiesQuery.isFetching}
      />
      <main className={styles.columns}>
        <section className={styles.tableArea}>
          <CompanySearch value={searchText} onChange={setSearchText} />
          <CompanyListArea
            query={companiesQuery}
            allCount={companies.length}
            companies={visibleCompanies}
            searchText={deferredSearchText}
            selectedId={selectedId}
            onSelect={setSelectedId}
            sort={sort}
            onSort={sortBy}
          />
        </section>
        <section className={styles.panelArea}>
          <MentionsPanel companyId={selectedId} companyName={selectedName} windowDays={companiesQuery.data?.windowDays} />
        </section>
      </main>
    </div>
  );
}

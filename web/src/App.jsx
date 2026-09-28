// App.jsx — the page layout: the header, the company table, and the selected company's mentions
// beside it (stacked on narrow screens).
//
// Where it sits: drawn by src/main.jsx inside the error boundary and the TanStack Query provider.
// Reads: the company list through the useCompanies hook (never fetch directly, D100).
//
// State (D98, D100): the selected company is plain useState (no router). The table order is
// worked out with useMemo over the loaded list (src/utils/sortCompanies.js). Refresh reloads
// everything that starts with the 'companies' query key: the list and the open mentions.

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCompanies, COMPANIES_KEY } from './hooks/useCompanies.js';
import { sortCompanies } from './utils/sortCompanies.js';
import { Header } from './components/Header/Header.jsx';
import { CompanyTable } from './components/CompanyTable/CompanyTable.jsx';
import { MentionsPanel } from './components/MentionsPanel/MentionsPanel.jsx';
import { Loading } from './components/common/Loading.jsx';
import { ErrorMessage } from './components/common/ErrorMessage.jsx';
import styles from './App.module.css';

// The company list part of the page, for each state of the query.
function CompanyListArea({ query, companies, selectedId, onSelect }) {
  if (query.isPending) return <Loading text="Loading companies ..." />;
  if (query.isError) return <ErrorMessage message={query.error?.message ?? 'The company list could not be loaded.'} onRetry={query.refetch} />;
  if (companies.length === 0) {
    return <p>No companies to show yet. The database has no data; see the api window for why (e.g. data/ could not be imported).</p>;
  }
  return <CompanyTable companies={companies} selectedId={selectedId} onSelect={onSelect} />;
}

// The whole page.
export function App() {
  const [selectedId, setSelectedId] = useState(null);
  const companiesQuery = useCompanies();
  const queryClient = useQueryClient();

  const companies = useMemo(() => sortCompanies(companiesQuery.data?.companies ?? []), [companiesQuery.data]);
  const selectedName = companies.find((company) => company.id === selectedId)?.name;

  // Reloads the list and the open company's mentions: one invalidate for every 'companies' key.
  const refresh = () => queryClient.invalidateQueries({ queryKey: [COMPANIES_KEY] });

  return (
    <div className={styles.page}>
      <Header
        asOf={companiesQuery.data?.asOf}
        windowStart={companiesQuery.data?.windowStart}
        onRefresh={refresh}
        isRefreshing={companiesQuery.isFetching}
      />
      <main className={styles.columns}>
        <section className={styles.tableArea}>
          <CompanyListArea query={companiesQuery} companies={companies} selectedId={selectedId} onSelect={setSelectedId} />
        </section>
        <section className={styles.panelArea}>
          <MentionsPanel companyId={selectedId} companyName={selectedName} />
        </section>
      </main>
    </div>
  );
}

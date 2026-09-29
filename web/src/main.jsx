// main.jsx — the start of the page: draws <App /> inside the error boundary (so a bug never
// leaves a blank page) and the TanStack Query provider (the page's data cache, D100).
//
// Where it sits: loaded by web/index.html.
// Reads/writes: the #root element of the page.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from './api/queryClient.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.jsx';
import { App } from './App.jsx';
import { applyStoredTheme } from './hooks/useTheme.js';
// Inter, a modern font, bundled with the page (owner, Prompt 330: the system font looked old).
import '@fontsource-variable/inter';
import './styles/global.css';

// One cache for the whole page. The daily job (Step 6) will later call
// queryClient.invalidateQueries({ queryKey: ['companies'] }) on it to refresh the page.
const queryClient = new QueryClient({ defaultOptions: QUERY_DEFAULTS });

// Dark (the default) or the theme this browser chose last, before the first paint (D117).
applyStoredTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

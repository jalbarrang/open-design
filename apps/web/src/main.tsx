import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRouter,
  ErrorComponent,
  RouterProvider,
} from '@tanstack/react-router';
import { createMemoryHistory } from '@tanstack/history';

import { AnalyticsProvider } from './analytics/provider';
import { setActiveLocationNotifier } from './tanstack-bridge';
import { I18nProvider } from './i18n';
import { routeTree } from './routeTree.gen';

const router = createRouter({
  routeTree,
  // The app's navigation coordinator (`src/router.ts`) owns `window.history`:
  // guards, odIndex depth tracking, and popstate repair. TanStack rides on a
  // memory history and is kept in sync through `src/tanstack-bridge.ts`, so
  // the two routers can never fight over the browser history stack.
  history: createMemoryHistory({
    initialEntries: [`${window.location.pathname}${window.location.search}`],
  }),
  defaultPreload: 'intent',
  defaultPendingComponent: () => (
    <div className='od-loading-shell'>
      <span>Loading…</span>
    </div>
  ),
  defaultErrorComponent: ({ error }) => <ErrorComponent error={error} />,
  notFoundMode: 'fuzzy',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Mirror every coordinator-committed location into the router's memory
// history so matched-route state (and future loader/preload work) stays
// current. Memory history never writes to `window.history` itself.
setActiveLocationNotifier((pathname) => {
  if (router.history.location.pathname !== pathname) {
    router.history.push(pathname);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AnalyticsProvider>
        <RouterProvider router={router} />
      </AnalyticsProvider>
    </I18nProvider>
  </StrictMode>,
);

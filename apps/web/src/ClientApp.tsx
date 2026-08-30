'use client';

import { lazy, Suspense } from 'react';

import { installErrorHandlers } from './analytics/error-tracking';
import { MatrixLoader } from './components/MatrixLoader';
import { installWebObservability } from './observability/install';

// Install browser exception handlers at module-load time, before any other
// client code can throw. The hooks buffer events until AnalyticsProvider
// finishes `bootstrapExceptionTracking()` with the PostHog key, so even
// errors thrown during the lazy import of `App` are captured.
installErrorHandlers();

// Install the rest of the observability surface (long tasks, white-screen
// detector, resource-error capture, boot timing, visibility tracking).
// Same buffer + consent-bypass transport as the exception handler above
// so events fired before AnalyticsProvider initialises still flush.
installWebObservability();

// The product is a fully client-driven SPA — every component reads
// localStorage, window.location, etc. — so the app tree is lazy-loaded on the
// client only. This keeps the initial chunk small and gives the same
// loading-shell behavior while the main product chunk loads.
const App = lazy(() => import('./App').then((m) => ({ default: m.App })));

// Keeps the `od-loading-shell` class on the outer node: the white-screen
// detector filters this whole subtree out by that class when deciding
// whether the app really mounted (`src/observability/white-screen.ts`).
function BootShell() {
  return (
    <div className='od-loading-shell'>
      <MatrixLoader />
      <span>Loading OpenDesign…</span>
    </div>
  );
}

export function ClientApp() {
  return (
    <Suspense fallback={<BootShell />}>
      <App />
    </Suspense>
  );
}

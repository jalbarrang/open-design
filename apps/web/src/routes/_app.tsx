import { createFileRoute, useSearch } from '@tanstack/react-router';

import { AppSearchProvider } from '../app-search-context';
import { ClientApp } from '../ClientApp';

/**
 * Pathless layout wrapping every product URL. It mounts the client SPA once;
 * the leaf routes below it only contribute URL semantics and loaders.
 */
function AppLayout() {
  const search = useSearch({ from: '__root__' });
  return (
    <AppSearchProvider value={search}>
      <ClientApp />
    </AppSearchProvider>
  );
}

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

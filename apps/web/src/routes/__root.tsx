import { createRootRoute, Outlet } from '@tanstack/react-router';

import { validateAppSearch } from '../app-search';

/**
 * Root of the TanStack route tree. It renders no product UI of its own: the
 * SPA shell lives in the `/_app` pathless layout (which renders ClientApp for
 * every product URL) and the `/desktop-pet` window has its own route. Leaf
 * routes intentionally ship no components — they own the URL grammar, typed
 * params, and deep-link loaders; App.tsx keeps rendering the actual views.
 */
export const Route = createRootRoute({
  validateSearch: validateAppSearch,
  component: Outlet,
});

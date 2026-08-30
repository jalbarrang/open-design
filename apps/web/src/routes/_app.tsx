import { createFileRoute } from '@tanstack/react-router';

import { ClientApp } from '../ClientApp';

/**
 * Pathless layout wrapping every product URL. It mounts the client SPA once;
 * the leaf routes below it only contribute URL semantics and loaders.
 */
export const Route = createFileRoute('/_app')({
  component: ClientApp,
});

import { createFileRoute } from '@tanstack/react-router';

import { bootstrapProjectRoute } from '../../state/projects';

// Leaf route: owns the URL so the generated route tree matches the product's
// deep-link grammar; App.tsx renders the actual view from its Route union.
export const Route = createFileRoute('/_app/projects/$projectId/conversations/$conversationId/files/$')({
  loader: ({ params }) => bootstrapProjectRoute(params.projectId),
});

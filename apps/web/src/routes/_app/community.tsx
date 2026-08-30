import { createFileRoute } from '@tanstack/react-router';

// Leaf route: owns the URL so the generated route tree matches the product's
// deep-link grammar; App.tsx renders the actual view from its Route union.
export const Route = createFileRoute('/_app/community')({});

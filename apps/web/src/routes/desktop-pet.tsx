import { lazy, Suspense } from 'react';
import { createFileRoute } from '@tanstack/react-router';

// The desktop pet renders in its own dedicated route/window. It shares the
// SPA shell's HTML but
// never mounts the product App.
const DesktopPetSurface = lazy(
  () => import('../components/pet/DesktopPetSurface').then((m) => ({ default: m.DesktopPetSurface })),
);

export const Route = createFileRoute('/desktop-pet')({
  component: () => (
    <Suspense fallback={null}>
      <DesktopPetSurface />
    </Suspense>
  ),
});

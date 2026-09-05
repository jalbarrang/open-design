import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from '@tanstack/history';
import { createRouter } from '@tanstack/react-router';

import { buildPath, parseRoute, type Route } from '../../src/router';
import { routeTree } from '../../src/routeTree.gen';

/**
 * Consistency contract between the two URL grammars:
 *
 * 1. `src/router.ts` owns navigation (`parseRoute`/`buildPath`, pinned by
 *    tests/router.test.ts) and App.tsx renders from its Route union.
 * 2. The TanStack route tree (`src/routes/`, compiled into
 *    `src/routeTree.gen.ts`) owns rendering shells, deep-link loaders, and
 *    preloading.
 *
 * This suite pins the TanStack tree to the same grammar: every path the
 * coordinator builds must match a route in the generated tree, and each
 * matched route must expose its typed params. Drift in either direction
 * fails here.
 */

const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ['/'] }),
});

/** Pathless layout ids are not URLs; map each grammar case to its `to`. */
const CASES: Array<{ route: Route; to: string }> = [
  { route: { kind: 'home', view: 'home' }, to: '/_app/' },
  { route: { kind: 'home', view: 'onboarding' }, to: '/_app/onboarding' },
  { route: { kind: 'home', view: 'projects' }, to: '/_app/projects/' },
  { route: { kind: 'home', view: 'tasks' }, to: '/_app/automations' },
  { route: { kind: 'home', view: 'plugins' }, to: '/_app/plugins/' },
  { route: { kind: 'home', view: 'design-systems' }, to: '/_app/design-systems/' },
  { route: { kind: 'home', view: 'integrations' }, to: '/_app/integrations' },
  { route: { kind: 'home', view: 'settings' }, to: '/_app/settings' },
  { route: { kind: 'home', view: 'community' }, to: '/_app/community' },
  { route: { kind: 'home', view: 'drafts' }, to: '/_app/drafts' },
  { route: { kind: 'home', view: 'all-projects' }, to: '/_app/all-projects' },
  { route: { kind: 'home', view: 'members' }, to: '/_app/members' },
  { route: { kind: 'home', view: 'board' }, to: '/_app/board' },
  { route: { kind: 'home', view: 'workspace-settings' }, to: '/_app/workspace-settings' },
  { route: { kind: 'design-system-create' }, to: '/_app/design-systems/create' },
  {
    route: { kind: 'design-system-detail', designSystemId: 'ds-1' },
    to: '/_app/design-systems/$designSystemId',
  },
  {
    route: { kind: 'project', projectId: 'p-1', conversationId: null, fileName: null },
    to: '/_app/projects/$projectId',
  },
  {
    route: { kind: 'project', projectId: 'p-1', conversationId: 'c-1', fileName: null },
    to: '/_app/projects/$projectId/conversations/$conversationId',
  },
  {
    route: { kind: 'project', projectId: 'p-1', conversationId: null, fileName: 'src/index.tsx' },
    to: '/_app/projects/$projectId/files/$',
  },
  {
    route: {
      kind: 'project',
      projectId: 'p-1',
      conversationId: 'c-1',
      fileName: 'deep/dir/file.html',
    },
    to: '/_app/projects/$projectId/conversations/$conversationId/files/$',
  },
  { route: { kind: 'marketplace' }, to: '/_app/marketplace/' },
  { route: { kind: 'marketplace-detail', pluginId: 'plug-1' }, to: '/_app/marketplace/$pluginId' },
  { route: { kind: 'collab-demo', projectId: null }, to: '/_app/collab-demo/' },
  { route: { kind: 'collab-demo', projectId: 'p-2' }, to: '/_app/collab-demo/$projectId' },
  { route: { kind: 'community' }, to: '/_app/community' },
];

describe('TanStack route tree matches the navigation grammar', () => {
  function deepestMatch(pathname: string): { routeId: string; params: Record<string, unknown> } {
    // `matchRoute` is designed for current-location checks; `matchRoutes`
    // matches an arbitrary location against the tree and exposes params.
    const matches = (
      router as unknown as {
        matchRoutes: (location: { pathname: string }) => Array<{
          routeId: string;
          params: Record<string, unknown>;
        }>;
      }
    ).matchRoutes({ pathname });
    return matches[matches.length - 1]!;
  }

  it.each(CASES)('$to matches buildPath output', ({ route, to }) => {
    const path = buildPath(route);
    const match = deepestMatch(path);
    expect(match.routeId, `${path} should match ${to}`).toBe(to);
  });

  it('exposes typed params for project deep links', () => {
    const match = deepestMatch('/projects/p-1/files/src/index.tsx');
    expect(match.routeId).toBe('/_app/projects/$projectId/files/$');
    expect(match.params.projectId).toBe('p-1');
    expect(match.params._splat).toBe('src/index.tsx');
  });

  it('falls unknown paths through to the SPA splat route', () => {
    const match = deepestMatch('/totally/unknown/path');
    expect(match.routeId).toBe('/_app/$');
  });

  it('round-trips every case through the coordinator grammar', () => {
    for (const { route } of CASES) {
      // `kind: 'community'` is a legacy alias; parseRoute canonicalizes
      // /community to `home view: 'community'` (see src/router.ts).
      if (route.kind === 'community') continue;
      expect(parseRoute(buildPath(route))).toEqual(route);
    }
  });
});

import { describe, expect, it } from 'vitest';

import config from '../../vite.config';

/**
 * Pins the build contract the daemon and packaged sidecar rely on: a static
 * `dist/` directory served with root-relative asset URLs and browser
 * sourcemaps (uploaded by `tools/pack/src/web-sourcemaps.ts` then deleted).
 */
describe('vite build contract', () => {
  it('emits a root-relative static build into dist/', async () => {
    const resolved = await (config as { default: unknown }).default !== undefined
      ? (config as { default: Record<string, unknown> }).default
      : (config as Record<string, unknown>);
    expect(resolved.base).toBe('/');
    expect((resolved.build as { outDir?: string }).outDir).toBe('dist/web');
    expect((resolved.build as { sourcemap?: boolean }).sourcemap).toBe(true);
  });

  it('proxies daemon-routed pathnames to OD_PORT in dev', async () => {
    const resolved = await (config as { default: unknown }).default !== undefined
      ? (config as { default: Record<string, unknown> }).default
      : (config as Record<string, unknown>);
    const proxy = (resolved.server as { proxy?: Record<string, unknown> }).proxy ?? {};
    expect(Object.keys(proxy).sort()).toEqual(['/api', '/artifacts', '/frames']);
  });
});

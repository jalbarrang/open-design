import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalizeDaemonProxyOriginHeader,
  resolveDaemonProxyTarget,
  startWebSidecar,
} from '../sidecar/server';

describe('resolveDaemonProxyTarget', () => {
  it('proxies allowlisted relative paths to the daemon origin', () => {
    const target = resolveDaemonProxyTarget('http://127.0.0.1:7456', '/api/projects?limit=10');

    expect(target?.href).toBe('http://127.0.0.1:7456/api/projects?limit=10');
  });

  it('does not let absolute request URLs replace the daemon origin', () => {
    const target = resolveDaemonProxyTarget(
      'http://127.0.0.1:7456',
      'http://169.254.169.254/api/latest/meta-data?token=1',
    );

    expect(target?.href).toBe('http://127.0.0.1:7456/api/latest/meta-data?token=1');
  });

  it('rejects non-daemon paths', () => {
    expect(resolveDaemonProxyTarget('http://127.0.0.1:7456', '/settings')).toBeNull();
  });
});

describe('static Vite sidecar', () => {
  it('serves assets and the SPA fallback from the configured dist root', async () => {
    const previousDistDir = process.env.OD_WEB_DIST_DIR;
    const previousWebProd = process.env.OD_WEB_PROD;
    const previousWebPort = process.env.OD_WEB_PORT;
    const previousDaemonPort = process.env.OD_PORT;
    const staticRoot = await mkdtemp(join(tmpdir(), 'open-design-vite-static-'));
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'open-design-web-runtime-'));
    let handle: Awaited<ReturnType<typeof startWebSidecar>> | undefined;

    try {
      await mkdir(join(staticRoot, 'assets'), { recursive: true });
      await writeFile(join(staticRoot, 'index.html'), '<main id="vite-shell">OpenDesign</main>', 'utf8');
      await writeFile(join(staticRoot, 'assets', 'entry.js'), 'window.__OD_VITE__ = true;', 'utf8');
      process.env.OD_WEB_DIST_DIR = staticRoot;
      process.env.OD_WEB_PROD = '1';
      process.env.OD_WEB_PORT = '0';
      delete process.env.OD_PORT;

      handle = await startWebSidecar({
        app: 'web',
        base: runtimeRoot,
        ipc: join(runtimeRoot, 'web.sock'),
        mode: 'runtime',
        namespace: 'vite-static',
        source: 'tools-pack',
      });
      const status = await handle.status();
      expect(status.url).not.toBeNull();

      const deepLink = await fetch(`${status.url}/projects/project-1/files/index.html`);
      expect(deepLink.status).toBe(200);
      expect(await deepLink.text()).toContain('vite-shell');

      const asset = await fetch(`${status.url}/assets/entry.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('text/javascript');
      expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(await asset.text()).toContain('__OD_VITE__');

      const unavailableApi = await fetch(`${status.url}/api/health`);
      expect(unavailableApi.status).toBe(502);
      expect(await unavailableApi.text()).toContain('ECONNREFUSED');
    } finally {
      await handle?.stop();
      if (previousDistDir == null) delete process.env.OD_WEB_DIST_DIR;
      else process.env.OD_WEB_DIST_DIR = previousDistDir;
      if (previousWebProd == null) delete process.env.OD_WEB_PROD;
      else process.env.OD_WEB_PROD = previousWebProd;
      if (previousWebPort == null) delete process.env.OD_WEB_PORT;
      else process.env.OD_WEB_PORT = previousWebPort;
      if (previousDaemonPort == null) delete process.env.OD_PORT;
      else process.env.OD_PORT = previousDaemonPort;
      await rm(staticRoot, { force: true, recursive: true });
      await rm(runtimeRoot, { force: true, recursive: true });
    }
  });
});

describe('normalizeDaemonProxyOriginHeader', () => {
  it('normalizes the current web origin to the daemon origin', () => {
    expect(
      normalizeDaemonProxyOriginHeader({
        daemonOrigin: 'http://127.0.0.1:7456',
        origin: 'http://127.0.0.1:3000',
        webPort: 3000,
      }),
    ).toBe('http://127.0.0.1:7456');
  });

  it('accepts localhost as an equivalent loopback web origin', () => {
    expect(
      normalizeDaemonProxyOriginHeader({
        daemonOrigin: 'http://127.0.0.1:7456',
        origin: 'http://localhost:3000',
        webPort: 3000,
      }),
    ).toBe('http://127.0.0.1:7456');
  });

  it('normalizes matching private LAN browser origins to the daemon origin', () => {
    expect(
      normalizeDaemonProxyOriginHeader({
        daemonOrigin: 'http://127.0.0.1:7456',
        origin: 'http://192.168.3.23:8085',
        requestHost: '192.168.3.23:8085',
        webPort: 8085,
      }),
    ).toBe('http://127.0.0.1:7456');
  });

  it('does not normalize mismatched private LAN origins', () => {
    expect(
      normalizeDaemonProxyOriginHeader({
        daemonOrigin: 'http://127.0.0.1:7456',
        origin: 'http://192.168.3.23:8085',
        requestHost: '192.168.3.24:8085',
        webPort: 8085,
      }),
    ).toBe('http://192.168.3.23:8085');
  });

  it('normalizes matching wildcard configured dev origins to the daemon origin', () => {
    const previous = process.env.OD_ALLOWED_DEV_ORIGINS;
    process.env.OD_ALLOWED_DEV_ORIGINS = '*.local-origin.dev';
    try {
      expect(
        normalizeDaemonProxyOriginHeader({
          daemonOrigin: 'http://127.0.0.1:7456',
          origin: 'http://app.local-origin.dev:8085',
          requestHost: 'app.local-origin.dev:8085',
          webPort: 8085,
        }),
      ).toBe('http://127.0.0.1:7456');
    } finally {
      if (previous == null) delete process.env.OD_ALLOWED_DEV_ORIGINS;
      else process.env.OD_ALLOWED_DEV_ORIGINS = previous;
    }
  });

  it('does not rewrite unrelated browser origins', () => {
    expect(
      normalizeDaemonProxyOriginHeader({
        daemonOrigin: 'http://127.0.0.1:7456',
        origin: 'https://example.com',
        webPort: 3000,
      }),
    ).toBe('https://example.com');
  });

  it('preserves absent and null origins for daemon policy to handle', () => {
    expect(
      normalizeDaemonProxyOriginHeader({
        daemonOrigin: 'http://127.0.0.1:7456',
        origin: undefined,
        webPort: 3000,
      }),
    ).toBeUndefined();
    expect(
      normalizeDaemonProxyOriginHeader({
        daemonOrigin: 'http://127.0.0.1:7456',
        origin: 'null',
        webPort: 3000,
      }),
    ).toBe('null');
  });
});

import { fileURLToPath, URL } from 'node:url';

import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Daemon port the local Express server binds to (see apps/daemon/src/cli.ts).
// The tools-dev launcher exports OD_PORT after probing for a free port; the
// dev server proxies /api, /artifacts, and /frames to that origin so the SPA
// can reach the daemon without CORS gymnastics. SSE on /api/chat streams
// through the proxy unbuffered.
const DAEMON_PORT = Number(process.env.OD_PORT) || 7456;
const DAEMON_ORIGIN = `http://127.0.0.1:${DAEMON_PORT}`;

function parseAllowedDevHost(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`http://${trimmed}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

// Mirrors the origin allowlist the old next.config.ts enforced for dev-server
// host headers: loopback always, plus configured or LAN hosts.
function configuredAllowedDevHosts(): string[] {
  const configured = (process.env.OD_ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map(parseAllowedDevHost)
    .filter((host): host is string => host != null);
  const allowedOrigins = (process.env.OD_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(parseAllowedDevHost)
    .filter((host): host is string => host != null);
  const bindHost = parseAllowedDevHost(process.env.OD_HOST ?? '');
  return Array.from(new Set([
    '127.0.0.1',
    'localhost',
    ...configured,
    ...allowedOrigins,
    ...(bindHost != null && bindHost !== '0.0.0.0' && bindHost !== '::' ? [bindHost] : []),
  ]));
}

const webRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Route tree generation must run before the React plugin so route files
  // are transformed with the generated `routeTree.gen.ts` in place.
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      enableRouteTreeFormatting: false,
    }),
    react(),
  ],
  resolve: {
    // The shared components package ships a `development` condition pointing
    // at its TypeScript source; importing source keeps one React instance and
    // lets Vite transpile shared component source during development.
    conditions: ['development'],
  },
  server: {
    host: process.env.OD_HOST || '127.0.0.1',
    port: Number(process.env.OD_WEB_PORT) || 5173,
    allowedHosts: configuredAllowedDevHosts(),
    proxy: {
      '/api': { target: DAEMON_ORIGIN, changeOrigin: false },
      '/artifacts': { target: DAEMON_ORIGIN, changeOrigin: false },
      '/frames': { target: DAEMON_ORIGIN, changeOrigin: false },
    },
  },
  build: {
    // `dist/web` keeps the static build next to (but not over) the sidecar
    // entry `dist/sidecar/` that `build:sidecar` emits into the same dist root.
    outDir: 'dist/web',
    emptyOutDir: true,
    // Emit browser sourcemaps so packaged-runtime exceptions can be
    // symbolicated by PostHog. `tools/pack/src/web-sourcemaps.ts` runs after
    // the build to upload to PostHog and ALWAYS delete the .map files before
    // packaging so source never ships inside an installer.
    sourcemap: true,
  },
  // Paths resolve relative to apps/web so the daemon and web sidecar can
  // serve the built `dist/` with root-relative asset URLs.
  base: '/',
  root: webRoot,
});

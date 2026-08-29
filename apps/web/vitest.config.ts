import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@excalidraw/excalidraw': resolve(__dirname, 'tests/helpers/excalidraw-mock.tsx'),
      'motion/react': resolve(__dirname, 'tests/helpers/motion-mock.tsx'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Node 26 exposes Web Storage as a built-in global. Vitest's jsdom
    // environment only copies window keys that are not already on
    // globalThis, so Node's `localStorage` (which reads as `undefined`
    // unless --localstorage-file is passed) wins and jsdom's real Storage
    // never lands. Turning the built-in off in the worker hands the name
    // back to jsdom, where these tests expect it.
    execArgv: ['--no-experimental-webstorage'],
    // Keep this above the shared Testing Library asyncUtilTimeout so failed
    // waits retain Testing Library's assertion/DOM diagnostics.
    testTimeout: 5_000,
    setupFiles: ['./tests/setup/jsdom-lexical.ts', './tests/setup/coalesced-get-reset.ts'],
  },
});

// @vitest-environment jsdom
//
// The theme setting ships again (light / dark / system). These specs pin the
// theme invariant at all three places a persisted theme can reach the
// document: the config parser, the runtime appearance applier, and the
// pre-hydration inline script that paints before React mounts.
//
// The invariant: `data-theme` carries the EXPLICIT choice ('light'/'dark');
// the attribute is absent ONLY in system mode, where the CSS tokens'
// `html:not([data-theme])` + `prefers-color-scheme` blocks resolve it. An
// unstamped document outside system mode is a bug — every JS theme reader
// (shiki, ConnectorLogo, SketchEditor, TerminalViewer, connectorBrandColor…)
// falls back to `prefers-color-scheme` when the attribute is absent, so a
// forgotten stamp leaks the OS appearance in unintentionally.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyAppearanceToDocument } from '../../src/state/appearance';
import { DEFAULT_CONFIG, loadConfig } from '../../src/state/config';
import type { AppConfig } from '../../src/types';

const STORAGE_KEY = 'open-design:config';
const store = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key);
  }),
  clear: vi.fn(() => {
    store.clear();
  }),
});

function persist(config: Partial<AppConfig>): void {
  store.set(STORAGE_KEY, JSON.stringify(config));
}

/** Pretend the OS is in dark mode, the way a dark-desktop user's browser is. */
function stubSystemPrefersDark(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-color-scheme: dark'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe('app theme — persisted config', () => {
  beforeEach(() => {
    store.clear();
  });

  it('defaults a fresh install to the light theme', () => {
    expect(DEFAULT_CONFIG.theme).toBe('light');
    expect(loadConfig().theme).toBe('light');
  });

  it('honors an already-persisted dark theme on read', () => {
    persist({ theme: 'dark', accentColor: '#4F46E5' });

    const config = loadConfig();

    expect(config.theme).toBe('dark');
    // Unrelated preferences must survive the parse.
    expect(config.accentColor).toBe('#4f46e5');
  });

  it('honors a persisted system theme even when the OS prefers dark', () => {
    stubSystemPrefersDark();
    persist({ theme: 'system' });

    expect(loadConfig().theme).toBe('system');
  });

  it('falls back to light for an invalid persisted theme', () => {
    persist({ theme: 'sepia' as AppConfig['theme'] });

    expect(loadConfig().theme).toBe('light');
  });
});

describe('app theme — document', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('stamps data-theme=light for the explicit light theme', () => {
    applyAppearanceToDocument({ theme: 'light', accentColor: '#059669' });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('stamps data-theme=dark for the explicit dark theme', () => {
    document.documentElement.setAttribute('data-theme', 'light');

    applyAppearanceToDocument({ theme: 'dark', accentColor: '#059669' });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('defaults to the light theme when none is given', () => {
    document.documentElement.setAttribute('data-theme', 'dark');

    applyAppearanceToDocument({ accentColor: '#10B981' });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('removes the attribute in system mode so the CSS media query resolves', () => {
    stubSystemPrefersDark();
    document.documentElement.setAttribute('data-theme', 'light');

    applyAppearanceToDocument({ theme: 'system', accentColor: '#10B981' });

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('app theme — pre-hydration script', () => {
  const layoutPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../app/layout.tsx',
  );

  function runThemeInitScript(): void {
    const source = readFileSync(layoutPath, 'utf8');
    const match = /const themeInitScript = `([^`]*)`;/.exec(source);
    if (!match?.[1]) throw new Error('themeInitScript not found in app/layout.tsx');
    // eslint-disable-next-line no-new-func
    new Function(match[1])();
  }

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    store.clear();
  });

  it('paints dark before hydration when the stored theme is dark', () => {
    persist({ theme: 'dark' });

    runThemeInitScript();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('paints light before hydration for a stored light theme', () => {
    persist({ theme: 'light' });

    runThemeInitScript();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('leaves the attribute absent for a stored system theme (CSS resolves it)', () => {
    persist({ theme: 'system' });

    runThemeInitScript();

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('paints light before hydration when nothing is stored', () => {
    runThemeInitScript();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

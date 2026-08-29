import { getOpenDesignHost } from '@open-design/host';
import type { AppTheme } from '../types';

const ACCENT_VARS = [
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-tint',
  '--accent-hover',
] as const;

export const DEFAULT_ACCENT_COLOR = '#353535';
export const ACCENT_SWATCHES = [
  DEFAULT_ACCENT_COLOR,
  '#202020',
  '#848484',
  '#87ea5c',
  '#0d5400',
  '#1A74FF',
  '#FFBA12',
  '#FF7528',
  '#F04142',
] as const;

export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function resolveAccentColor(value: unknown): string {
  return normalizeAccentColor(value) ?? DEFAULT_ACCENT_COLOR;
}

function accentVars(accentColor: string): Record<(typeof ACCENT_VARS)[number], string> {
  return {
    '--accent': accentColor,
    // Keep these mix ratios in sync with the pre-hydration script in app/layout.tsx.
    '--accent-strong': `color-mix(in srgb, ${accentColor} 82%, var(--text-strong))`,
    '--accent-soft': `color-mix(in srgb, ${accentColor} 12%, var(--bg-subtle))`,
    '--accent-tint': `color-mix(in srgb, ${accentColor} 6%, var(--bg-panel))`,
    '--accent-hover': `color-mix(in srgb, ${accentColor} 86%, var(--text-strong))`,
  };
}

export const APP_THEMES = ['system', 'light', 'dark'] as const;

export const DEFAULT_APP_THEME = 'light' as const;

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && (APP_THEMES as readonly string[]).includes(value);
}

/**
 * Resolve a persisted theme to a usable one.
 *
 * Dark mode is back, so stored values are honored again — but a fresh install
 * (or a corrupted value) starts light, which is the shipped brand appearance.
 */
export function resolveAppTheme(persisted?: AppTheme | null): AppTheme {
  return isAppTheme(persisted) ? persisted : DEFAULT_APP_THEME;
}

/**
 * The theme currently live on the document, resolved to a concrete value.
 *
 * `data-theme` carries the EXPLICIT choice ('light'/'dark'); the attribute is
 * absent in system mode, where the CSS tokens' `html:not([data-theme])` +
 * `prefers-color-scheme` blocks take over. Anything reading the theme outside
 * CSS (shiki, connector logos, Excalidraw, …) should go through here so
 * system mode resolves consistently instead of silently reading light.
 */
export function resolveCurrentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Stamp the app appearance onto `<html>`.
 *
 * Theme semantics: an explicit 'light'/'dark' sets `data-theme`; 'system'
 * REMOVES the attribute so the CSS prefers-color-scheme blocks apply. The
 * attribute must always reflect a deliberate state — an unstamped system
 * mode is the intended system behavior, never an accident, which is what
 * the old light-only pinning guarded against.
 *
 * The desktop host bridge keeps the native window material (macOS vibrancy
 * glass) in step with the theme; 'system' restores following the OS.
 * Feature-detected — browsers and older host builds have no appearance
 * capability.
 */
export function applyAppearanceToDocument({
  theme = DEFAULT_APP_THEME,
  accentColor,
}: {
  theme?: AppTheme;
  accentColor?: string;
}): void {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
  getOpenDesignHost()?.appearance?.setTheme(theme);

  const normalized = resolveAccentColor(accentColor);
  const vars = accentVars(normalized);
  for (const name of ACCENT_VARS) {
    root.style.setProperty(name, vars[name]);
  }
}

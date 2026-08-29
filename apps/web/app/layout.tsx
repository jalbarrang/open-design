import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '../src/i18n';
import { AnalyticsProvider } from '../src/analytics/provider';
import '@excalidraw/excalidraw/index.css';
import '../src/index.css';
import '../src/styles/home/index.css';

export const metadata: Metadata = {
  title: 'OpenDesign',
  icons: {
    icon: '/app-icon.png',
    apple: '/app-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#f7f7f7',
};

/**
 * Inline script that runs before React hydrates so the first paint already
 * carries the app's appearance — no flash of unstyled content.
 *
 * The stored theme decides the attribute, and the stamping is deliberately
 * OUTSIDE the try/catch: an explicit 'dark' stamps dark, 'system' leaves the
 * attribute absent (the CSS prefers-color-scheme blocks resolve it), and
 * everything else stamps 'light' — the shipped default. A broken storage
 * read must still leave the attribute stamped so a dark OS never leaks in
 * unintentionally. Keep the accent variable mix ratios in sync with
 * `accentVars()` in `src/state/appearance.ts`; this script cannot import
 * application modules.
 */
const themeInitScript = `(function(){var t='light';try{var c=JSON.parse(localStorage.getItem('open-design:config')||'{}');if(c.theme==='dark')t='dark';else if(c.theme==='system')t=null;}catch(e){}if(t===null){document.documentElement.removeAttribute('data-theme');}else{document.documentElement.setAttribute('data-theme',t);}try{var c2=JSON.parse(localStorage.getItem('open-design:config')||'{}');var a=typeof c2.accentColor==='string'&&/^#[0-9a-fA-F]{6}$/.test(c2.accentColor.trim())?c2.accentColor.trim().toLowerCase():'#353535';if(c2.configMigrationVersion!==3&&(a==='#87ea5c'||a==='#c96442'))a='#353535';var s=document.documentElement.style;s.setProperty('--accent',a);s.setProperty('--accent-strong','color-mix(in srgb, '+a+' 82%, var(--text-strong))');s.setProperty('--accent-soft','color-mix(in srgb, '+a+' 12%, var(--bg-subtle))');s.setProperty('--accent-tint','color-mix(in srgb, '+a+' 6%, var(--bg-panel))');s.setProperty('--accent-hover','color-mix(in srgb, '+a+' 86%, var(--text-strong))');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: intentional theme-init inline script to prevent FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <I18nProvider>
          <AnalyticsProvider>{children}</AnalyticsProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

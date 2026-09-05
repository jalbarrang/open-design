import { defineConfig } from "oxlint";

// Vendored from dmmulroy/anti-slop (MIT). Per that project's guidance the
// rules are ours to read and adapt; do not treat the copy as a fixed
// dependency. Generic rules only — this workspace does not use Effect.
export default defineConfig({
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    // Vendored plugin source: maintained upstream-first, linting it with its
    // own rules is circular.
    "tools/oxlint/anti-slop/**",
    // Generated output and vendored compatibility artifacts.
    "**/dist/**",
    "**/out/**",
    "**/.next/**",
    "**/node_modules/**",
    "mocks/**",
    // Astro templates: oxlint's parser cannot read .astro SFC syntax.
    "apps/landing-page/**",
    // Bundled third-party/minified example assets shipped inside official
    // plugins — build output, not source.
    "plugins/_official/examples/**/assets/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  rules: {
    // Enforced from day one (repo already clean or fixed in the adoption PR).
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-widen-then-assert": "error",
    // Warn-first adoption — violation counts at adoption time (pnpm lint):
    // ~9.3k / ~7.9k / ~2.6k / ~2k / ~2k / ~1.5k / ~600 / ~450 / ~230 / ~190.
    // Less common rules still begin as warnings even when their baseline count
    // is not listed here. Promote each only after its fix batch lands.
    "anti-slop/require-safety-comment-for-type-assertion": "warn",
    "anti-slop/no-runtime-typeof": "warn",
    "anti-slop/no-conditional-empty-object-spread": "warn",
    "anti-slop/no-unknown-parameters": "warn",
    "anti-slop/no-unsafe-dictionary-type": "warn",
    "anti-slop/no-known-value-widening": "warn",
    "anti-slop/no-chained-type-assertions": "warn",
    "anti-slop/no-module-mocking": "warn",
    "anti-slop/no-shape-in-symbol-names": "warn",
    "anti-slop/no-unknown-returns": "warn",
    "anti-slop/no-unknown-type-aliases": "warn",
  },
});

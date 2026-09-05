import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ToolPackConfig } from "@/config/index.js";
import { processWebSourcemaps } from "@/web-sourcemaps.js";

/**
 * These tests cover the parts of `processWebSourcemaps` that don't shell out
 * to `@posthog/cli`:
 *
 *   - missing chunks dir: returns silently
 *   - no .map files: returns silently
 *   - no credentials: ALWAYS strips .map files (the security guarantee)
 *
 * The upload-credentials-set path is not exercised here because it would have
 * to either reach PostHog (network in unit tests is forbidden) or mock out
 * `runPnpm`, which is intentionally an internal helper. The CLI happy-path
 * runs in the release workflows themselves; this suite focuses on the
 * strip-always invariant that must hold for both PR/fork builds and the rare
 * case where the upload step fails inside the release.
 */

let tempRoot: string;
const SAVED_API_KEY = process.env.POSTHOG_CLI_API_KEY;
const SAVED_PROJECT_ID = process.env.POSTHOG_CLI_PROJECT_ID;

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "od-web-sourcemaps-"));
  // Force the "no credentials" path so we test the strip-always invariant
  // without needing to mock @posthog/cli or hit the network.
  delete process.env.POSTHOG_CLI_API_KEY;
  delete process.env.POSTHOG_CLI_PROJECT_ID;
  delete process.env.POSTHOG_PERSONAL_API_KEY;
  delete process.env.POSTHOG_PROJECT_ID;
});

afterEach(async () => {
  if (tempRoot != null) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  restoreEnv("POSTHOG_CLI_API_KEY", SAVED_API_KEY);
  restoreEnv("POSTHOG_CLI_PROJECT_ID", SAVED_PROJECT_ID);
});

function fakeConfig(workspaceRoot: string): ToolPackConfig {
  return {
    appVersion: "0.0.0-test",
    containerized: false,
    electronBuilderCliPath: "/dev/null",
    electronDistPath: "/dev/null",
    electronVersion: "0.0.0",
    macCompression: "normal",
    namespace: "test",
    platform: "mac",
    portable: false,
    removeData: false,
    removeLogs: false,
    removeProductUserData: false,
    removeSidecars: false,
    roots: {
      output: {
        appBuilderRoot: join(workspaceRoot, "out", "builder"),
        namespaceRoot: join(workspaceRoot, "out", "ns"),
        platformRoot: join(workspaceRoot, "out", "mac"),
        root: join(workspaceRoot, "out"),
      },
      runtime: {
        namespaceBaseRoot: join(workspaceRoot, "runtime"),
        namespaceRoot: join(workspaceRoot, "runtime", "test"),
      },
      cacheRoot: join(workspaceRoot, "cache"),
      toolPackRoot: join(workspaceRoot, "tools-pack"),
    },
    signed: false,
    silent: true,
    to: "all",
    webOutputMode: "server",
    workspaceRoot,
  };
}

async function setupChunksDir(rootDir: string, mapNames: string[]): Promise<string> {
  const chunksDir = join(rootDir, "apps", "web", "dist", "web", "assets");
  await mkdir(join(chunksDir, "chunks"), { recursive: true });
  // Always create a .js file paired with each .map so the layout matches what
  // Vite emits — otherwise a future helper change that filters by
  // pairing would silently no-op the test.
  for (const name of mapNames) {
    const baseName = name.replace(/\.map$/, "");
    await writeFile(join(chunksDir, "chunks", baseName), "/* fake bundle */\n", "utf8");
    await writeFile(join(chunksDir, "chunks", name), '{"version":3,"sources":[]}\n', "utf8");
  }
  return chunksDir;
}

describe("processWebSourcemaps", () => {
  it("returns silently when the browser chunks directory does not exist", async () => {
    const config = fakeConfig(tempRoot);
    await expect(processWebSourcemaps(config)).resolves.toBeUndefined();
  });

  it("returns silently when the chunks directory has no .map files", async () => {
    const chunksDir = await setupChunksDir(tempRoot, []);
    // Drop a non-map file so the dir is not empty but contains no sourcemaps.
    await writeFile(join(chunksDir, "chunks", "main.js"), "/* */", "utf8");
    const config = fakeConfig(tempRoot);
    await expect(processWebSourcemaps(config)).resolves.toBeUndefined();
  });

  it("strips every .map file when credentials are missing (strip-only path)", async () => {
    const chunksDir = await setupChunksDir(tempRoot, [
      "framework-abc.js.map",
      "main-app-def.js.map",
      "polyfills-ghi.js.map",
    ]);
    const config = fakeConfig(tempRoot);

    await processWebSourcemaps(config);

    // Every .map gone, every .js preserved.
    await expect(
      readFile(join(chunksDir, "chunks", "framework-abc.js.map"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(chunksDir, "chunks", "main-app-def.js.map"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(chunksDir, "chunks", "polyfills-ghi.js.map"), "utf8"),
    ).rejects.toThrow();
    const preservedJs = await readFile(
      join(chunksDir, "chunks", "framework-abc.js"),
      "utf8",
    );
    expect(preservedJs).toContain("fake bundle");
  });

  it("strips .map files in nested Vite asset subdirectories", async () => {
    const chunksDir = await setupChunksDir(tempRoot, []);
    // Asset plugins can put bundles under `dist/web/assets/media` while the JS
    // chunks live at the asset root. The strip walker must recurse — otherwise
    // we'd leak source maps emitted by those plugins.
    const nestedDir = join(chunksDir, "media");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, "x.js"), "/* */", "utf8");
    await writeFile(join(nestedDir, "x.js.map"), "{}", "utf8");

    const config = fakeConfig(tempRoot);
    await processWebSourcemaps(config);

    await expect(readFile(join(nestedDir, "x.js.map"), "utf8")).rejects.toThrow();
    await expect(readFile(join(nestedDir, "x.js"), "utf8")).resolves.toContain("/*");
  });
});

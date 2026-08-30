import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { hashJson, hashPath, ToolPackCache } from "./cache/index.js";
import type { ToolPackConfig } from "./config/index.js";
import { hashPackageSourcePath } from "./package-source-hash.js";
import { readRuntimeAppVersion, versionFamilyForAppVersion } from "./versioning/index.js";

const WORKSPACE_BUILD_PACKAGES = [
  { directory: "packages/release", name: "@open-design/release" },
  { directory: "packages/components", name: "@open-design/components" },
  { directory: "packages/contracts", name: "@open-design/contracts" },
  { directory: "packages/registry-protocol", name: "@open-design/registry-protocol" },
  { directory: "packages/sidecar-proto", name: "@open-design/sidecar-proto" },
  { directory: "packages/launcher-proto", name: "@open-design/launcher-proto" },
  { directory: "packages/sidecar", name: "@open-design/sidecar" },
  { directory: "packages/platform", name: "@open-design/platform" },
  { directory: "packages/download", name: "@open-design/download" },
  { directory: "packages/host", name: "@open-design/host" },
  { directory: "packages/agui-adapter", name: "@open-design/agui-adapter" },
  { directory: "packages/plugin-runtime", name: "@open-design/plugin-runtime" },
  { directory: "packages/diagnostics", name: "@open-design/diagnostics" },
  { directory: "packages/dsh-runtime", name: "@open-design/dsh-runtime" },
  { directory: "apps/daemon", name: "@open-design/daemon" },
  { directory: "apps/web", name: "@open-design/web" },
  { directory: "apps/desktop", name: "@open-design/desktop" },
  { directory: "apps/packaged", name: "@open-design/packaged" },
] as const;

const BUILD_COMMANDS = [
  { args: ["--filter", "@open-design/release", "build"] },
  { args: ["--filter", "@open-design/components", "build"] },
  { args: ["--filter", "@open-design/contracts", "build"] },
  { args: ["--filter", "@open-design/registry-protocol", "build"] },
  { args: ["--filter", "@open-design/sidecar-proto", "build"] },
  { args: ["--filter", "@open-design/launcher-proto", "build"] },
  { args: ["--filter", "@open-design/sidecar", "build"] },
  { args: ["--filter", "@open-design/platform", "build"] },
  { args: ["--filter", "@open-design/download", "build"] },
  { args: ["--filter", "@open-design/host", "build"] },
  { args: ["--filter", "@open-design/agui-adapter", "build"] },
  { args: ["--filter", "@open-design/plugin-runtime", "build"] },
  { args: ["--filter", "@open-design/diagnostics", "build"] },
  { args: ["--filter", "@open-design/dsh-runtime", "build"] },
  { args: ["--filter", "@open-design/daemon", "build"] },
  { args: ["--filter", "@open-design/web", "build"] },
  { args: ["--filter", "@open-design/web", "build:sidecar"] },
  { args: ["--filter", "@open-design/desktop", "build"] },
  { args: ["--filter", "@open-design/packaged", "build"] },
] as const;

type WorkspaceBuildMetadata = {
  builtAt: string;
  outputFiles: string[];
};

type WorkspaceBuildArtifact = {
  cachePath: string;
  requiredPathGroups: string[][];
  workspacePath: string;
};

async function resolveWorkspaceBuildVersionFamily(config: ToolPackConfig): Promise<string | null> {
  if (config.platform !== "win") return null;
  const appVersion = await readRuntimeAppVersion(config).catch(() => null);
  return appVersion == null ? null : versionFamilyForAppVersion(appVersion);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readPackageManager(workspaceRoot: string): Promise<unknown> {
  const rootPackageJson = JSON.parse(await readFile(join(workspaceRoot, "package.json"), "utf8")) as {
    packageManager?: unknown;
  };
  return rootPackageJson.packageManager;
}

async function createWorkspaceBuildCacheKey(config: ToolPackConfig): Promise<string> {
  const packageHashes: Record<string, string> = {};
  for (const packageInfo of WORKSPACE_BUILD_PACKAGES) {
    packageHashes[packageInfo.name] = await hashPackageSourcePath(join(config.workspaceRoot, packageInfo.directory));
  }
  const nodeId = `${config.platform}.workspace-build`;

  return hashJson({
    buildCommands: BUILD_COMMANDS,
    node: nodeId,
    nodeVersion: process.version,
    packageHashes,
    packageManager: await readPackageManager(config.workspaceRoot),
    platform: config.platform,
    pnpmLock: await hashPath(join(config.workspaceRoot, "pnpm-lock.yaml")),
    schemaVersion: 9,
  });
}

function workspaceBuildOutputFiles(_config: ToolPackConfig): string[] {
  return [
    "packages/components/dist/index.mjs",
    "packages/components/dist/index.d.ts",
    "packages/release/dist/index.mjs",
    "packages/release/dist/index.d.ts",
    "packages/contracts/dist/index.mjs",
    "packages/contracts/dist/index.d.ts",
    "packages/registry-protocol/dist/index.mjs",
    "packages/registry-protocol/dist/index.d.ts",
    "packages/sidecar-proto/dist/index.mjs",
    "packages/sidecar-proto/dist/index.d.ts",
    "packages/launcher-proto/dist/index.mjs",
    "packages/launcher-proto/dist/index.d.ts",
    "packages/sidecar/dist/index.mjs",
    "packages/sidecar/dist/index.d.ts",
    "packages/platform/dist/index.mjs",
    "packages/platform/dist/index.d.ts",
    "packages/download/dist/index.mjs",
    "packages/download/dist/index.d.ts",
    "packages/host/dist/index.mjs",
    "packages/host/dist/index.d.ts",
    "packages/agui-adapter/dist/index.mjs",
    "packages/agui-adapter/dist/index.d.ts",
    "packages/plugin-runtime/dist/index.mjs",
    "packages/plugin-runtime/dist/index.d.ts",
    "packages/diagnostics/dist/index.mjs",
    "packages/diagnostics/dist/index.d.ts",
    "packages/dsh-runtime/dist/index.js",
    "packages/dsh-runtime/dist/types/index.d.ts",
    "apps/daemon/dist/cli.js",
    "apps/daemon/dist/cli.d.ts",
    "apps/daemon/dist/sidecar/index.js",
    "apps/web/dist/web/index.html",
    "apps/web/dist/sidecar/index.js",
    "apps/web/dist/sidecar/index.d.ts",
    "apps/desktop/dist/main/index.js",
    "apps/desktop/dist/main/index.d.ts",
    "apps/packaged/dist/index.mjs",
    "apps/packaged/dist/index.d.ts",
  ];
}

function workspaceBuildArtifacts(config: ToolPackConfig): WorkspaceBuildArtifact[] {
  const artifacts = [
    "packages/components/dist",
    "packages/release/dist",
    "packages/contracts/dist",
    "packages/registry-protocol/dist",
    "packages/sidecar-proto/dist",
    "packages/launcher-proto/dist",
    "packages/sidecar/dist",
    "packages/platform/dist",
    "packages/download/dist",
    "packages/host/dist",
    "packages/agui-adapter/dist",
    "packages/plugin-runtime/dist",
    "packages/diagnostics/dist",
    "packages/dsh-runtime/dist",
    "apps/daemon/dist",
    "apps/web/dist",
    "apps/desktop/dist",
    "apps/packaged/dist",
  ];
  const outputFiles = workspaceBuildOutputFiles(config);
  return artifacts.map((workspacePath) => {
    const requiredPathGroups = outputFiles.flatMap((output) => {
      const candidates = output.split("|")
        .filter((candidate) => candidate === workspacePath || candidate.startsWith(`${workspacePath}/`))
        .map((candidate) => relative(workspacePath, candidate));
      return candidates.length === 0 ? [] : [candidates];
    });
    return {
      cachePath: join("outputs", ...workspacePath.split("/")),
      requiredPathGroups,
      workspacePath,
    };
  });
}

async function copyWorkspaceBuildArtifactsToCache(config: ToolPackConfig, entryRoot: string): Promise<void> {
  for (const artifact of workspaceBuildArtifacts(config)) {
    const sourcePath = join(config.workspaceRoot, artifact.workspacePath);
    const targetPath = join(entryRoot, artifact.cachePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { dereference: true, recursive: true });
  }
}

async function missingWorkspaceBuildOutput(config: ToolPackConfig): Promise<string | null> {
  for (const output of workspaceBuildOutputFiles(config)) {
    const candidates = output.split("|");
    const exists = await Promise.any(
      candidates.map(async (candidate) => {
        if (!(await pathExists(join(config.workspaceRoot, candidate)))) throw new Error(candidate);
        return true;
      }),
    ).catch(() => false);
    if (!exists) return output;
  }
  return null;
}

export async function ensureWorkspaceBuildArtifacts(
  config: ToolPackConfig,
  cache: ToolPackCache,
  build: () => Promise<void>,
): Promise<string> {
  const key = await createWorkspaceBuildCacheKey(config);
  const nodeId = `${config.platform}.workspace-build`;
  const artifacts = workspaceBuildArtifacts(config);
  const versionFamily = await resolveWorkspaceBuildVersionFamily(config);
  const versionFamilyAlias = versionFamily == null
    ? null
    : hashJson({
        node: nodeId,
        nodeVersion: process.version,
        platform: config.platform,
        schemaVersion: 1,
        scope: "version-family",
        versionFamily,
      });
  const materialize = artifacts.map((artifact) => ({
    from: artifact.cachePath,
    reuse: true,
    reuseRequiredPaths: artifact.requiredPathGroups,
    to: join(config.workspaceRoot, artifact.workspacePath),
  }));
  await cache.acquire<WorkspaceBuildMetadata>({
    aliases: versionFamilyAlias == null ? [] : [versionFamilyAlias],
    materialize,
    node: {
      id: nodeId,
      key,
      outputs: ["stamp.json", ...artifacts.map((artifact) => artifact.cachePath)],
      invalidate: async () => null,
      build: async ({ entryRoot }) => {
        await build();
        const missingOutput = await missingWorkspaceBuildOutput(config);
        if (missingOutput != null) {
          throw new Error(`workspace build completed but output is missing: ${missingOutput}`);
        }
        await copyWorkspaceBuildArtifactsToCache(config, entryRoot);
        const outputFiles = workspaceBuildOutputFiles(config);
        await mkdir(entryRoot, { recursive: true });
        await writeFile(
          join(entryRoot, "stamp.json"),
          `${JSON.stringify(
            {
              builtAt: new Date().toISOString(),
              keyHash: hashText(key),
              outputFiles,
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        return { builtAt: new Date().toISOString(), outputFiles };
      },
    },
    seedFrom: versionFamilyAlias == null ? [] : [{ aliasKey: versionFamilyAlias, materialize }],
  });
  return key;
}

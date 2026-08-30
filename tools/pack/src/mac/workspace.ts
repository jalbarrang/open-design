import type { ToolPackCache } from "../cache/index.js";
import type { ToolPackConfig } from "../config/index.js";
import { processWebSourcemaps } from "../web-sourcemaps.js";
import { ensureWorkspaceBuildArtifacts } from "../workspace-build.js";
import { runPnpm } from "./commands.js";

async function buildWorkspaceArtifacts(config: ToolPackConfig): Promise<void> {
  await runPnpm(config, ["--filter", "@open-design/contracts", "build"]);
  await runPnpm(config, ["--filter", "@open-design/registry-protocol", "build"]);
  await runPnpm(config, ["--filter", "@open-design/sidecar-proto", "build"]);
  await runPnpm(config, ["--filter", "@open-design/launcher-proto", "build"]);
  await runPnpm(config, ["--filter", "@open-design/sidecar", "build"]);
  await runPnpm(config, ["--filter", "@open-design/platform", "build"]);
  await runPnpm(config, ["--filter", "@open-design/agui-adapter", "build"]);
  await runPnpm(config, ["--filter", "@open-design/plugin-runtime", "build"]);
  await runPnpm(config, ["--filter", "@open-design/download", "build"]);
  await runPnpm(config, ["--filter", "@open-design/host", "build"]);
  await runPnpm(config, ["--filter", "@open-design/diagnostics", "build"]);
  await runPnpm(config, ["--filter", "@open-design/dsh-runtime", "build"]);
  await runPnpm(config, ["--filter", "@open-design/components", "build"]);
  await runPnpm(config, ["--filter", "@open-design/daemon", "build"]);
  await runPnpm(config, ["--filter", "@open-design/web", "build"]);
  await runPnpm(config, ["--filter", "@open-design/web", "build:sidecar"]);
  // Inject chunk IDs + upload browser sourcemaps to PostHog, then strip
  // .map files. Runs before any packaging step copies the web output into
  // the Electron resources so .map never ends up inside the .app bundle.
  await processWebSourcemaps(config);
  await runPnpm(config, ["--filter", "@open-design/desktop", "build"]);
  await runPnpm(config, ["--filter", "@open-design/packaged", "build"]);
}

export async function ensureMacWorkspaceBuild(config: ToolPackConfig, cache: ToolPackCache): Promise<void> {
  await ensureWorkspaceBuildArtifacts(config, cache, async () => {
    await buildWorkspaceArtifacts(config);
  });
}

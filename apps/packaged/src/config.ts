import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { SIDECAR_DEFAULTS, normalizeNamespace } from "@open-design/sidecar-proto";

// `electron` is loaded lazily so this module can also be imported from the
// headless entry, which runs in a plain Node process without the electron
// dependency on disk. Top-level `import { app } from "electron"` would crash
// headless at module-load with ERR_MODULE_NOT_FOUND.
async function loadElectronApp() {
  const electron = await import("electron");
  return electron.app;
}

export const PACKAGED_CONFIG_PATH_ENV = "OD_PACKAGED_CONFIG_PATH";
export const PACKAGED_NAMESPACE_ENV = "OD_PACKAGED_NAMESPACE";
export const PACKAGED_NAMESPACE_BASE_ROOT_ENV = "OD_PACKAGED_NAMESPACE_BASE_ROOT";

export type RawPackagedConfig = {
  appVersion?: string;
  daemonCliEntryRelative?: string;
  daemonSidecarEntryRelative?: string;
  namespace?: string;
  namespaceBaseRoot?: string;
  nodeCommandRelative?: string;
  resourceRoot?: string;
  // Baked by tools/pack from OPEN_DESIGN_TELEMETRY_RELAY_URL and forwarded to
  // the daemon at runtime; Langfuse credentials never ship in packaged config.
  telemetryRelayUrl?: string;
  updateMetadataUrl?: string;
  // PostHog product-analytics ingest key, baked by tools/pack from
  // process.env.POSTHOG_KEY at packaging time. Forwarded to the daemon
  // sidecar's spawn env as POSTHOG_KEY. `phc_` keys are public ingest
  // tokens (write-only event capture); embedding them in the bundle is
  // the PostHog-recommended pattern. The integration short-circuits when
  // either this is absent or the user has declined Privacy → metrics.
  posthogKey?: string;
  posthogHost?: string;
  webSidecarEntryRelative?: string;
};

export type PackagedConfig = {
  appVersion: string | null;
  daemonCliEntry: string | null;
  daemonSidecarEntry: string | null;
  namespace: string;
  namespaceBaseRoot: string;
  nodeCommand: string | null;
  resourceRoot: string;
  telemetryRelayUrl: string | null;
  updateMetadataUrl: string | null;
  posthogKey: string | null;
  posthogHost: string | null;
  webSidecarEntry: string | null;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath: string): Promise<RawPackagedConfig | null> {
  if (!(await pathExists(filePath))) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as RawPackagedConfig;
}

function resolveDefaultConfigPath(): string {
  return join(process.resourcesPath, "open-design-config.json");
}

async function readRawPackagedConfig(): Promise<RawPackagedConfig> {
  const explicit = process.env[PACKAGED_CONFIG_PATH_ENV];
  if (explicit != null && explicit.length > 0) {
    const config = await readJsonIfExists(resolve(explicit));
    if (config == null) throw new Error(`packaged config not found at ${explicit}`);
    return config;
  }

  const electronApp = await loadElectronApp();
  return (
    (await readJsonIfExists(resolveDefaultConfigPath())) ??
    (await readJsonIfExists(join(electronApp.getAppPath(), "open-design-config.json"))) ??
    {}
  );
}

function resolveOptionalPath(value: string | undefined): string | undefined {
  return value == null || value.length === 0 ? undefined : resolve(value);
}

export function resolvePackagedNamespaceBaseRoot(
  rawNamespaceBaseRoot: string | undefined,
  electronUserDataRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveOptionalPath(env[PACKAGED_NAMESPACE_BASE_ROOT_ENV])
    ?? resolveOptionalPath(rawNamespaceBaseRoot)
    ?? join(electronUserDataRoot, "namespaces");
}

// Config DTOs use null for optional scalar values consumed by runtime options;
// optional paths use undefined so callers can distinguish "no path" from a resolved path string.
function cleanOptionalString(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function resolvePackagedRelativeEntry(value: string | undefined): Promise<string | null> {
  const cleaned = cleanOptionalString(value);
  if (cleaned == null) return null;
  const entry = join(process.resourcesPath, cleaned);
  if (!(await pathExists(entry))) {
    throw new Error(`configured packaged entry not found at ${entry}`);
  }
  return entry;
}

export async function readPackagedConfig(): Promise<PackagedConfig> {
  const raw = await readRawPackagedConfig();
  const namespace = normalizeNamespace(
    process.env[PACKAGED_NAMESPACE_ENV] ?? raw.namespace ?? SIDECAR_DEFAULTS.namespace,
  );
  const electronApp = await loadElectronApp();
  const namespaceBaseRoot = resolvePackagedNamespaceBaseRoot(
    raw.namespaceBaseRoot,
    electronApp.getPath("userData"),
  );
  const resourceRoot = resolveOptionalPath(raw.resourceRoot) ?? join(process.resourcesPath, "open-design");
  const relativeNodeCommand =
    raw.nodeCommandRelative == null || raw.nodeCommandRelative.length === 0
      ? join("open-design", "bin", "node")
      : raw.nodeCommandRelative;
  const nodeCommandCandidate = join(process.resourcesPath, relativeNodeCommand);
  const nodeCommand = (await pathExists(nodeCommandCandidate)) ? nodeCommandCandidate : null;
  const daemonCliEntry = await resolvePackagedRelativeEntry(raw.daemonCliEntryRelative);
  const daemonSidecarEntry = await resolvePackagedRelativeEntry(raw.daemonSidecarEntryRelative);
  const webSidecarEntry = await resolvePackagedRelativeEntry(raw.webSidecarEntryRelative);

  return {
    appVersion: cleanOptionalString(raw.appVersion),
    daemonCliEntry,
    daemonSidecarEntry,
    namespace,
    namespaceBaseRoot,
    nodeCommand,
    resourceRoot,
    telemetryRelayUrl: cleanOptionalString(raw.telemetryRelayUrl),
    updateMetadataUrl: cleanOptionalString(raw.updateMetadataUrl),
    posthogKey: cleanOptionalString(raw.posthogKey),
    posthogHost: cleanOptionalString(raw.posthogHost),
    webSidecarEntry,
  };
}

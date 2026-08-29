import type Database from 'better-sqlite3';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { getInstalledPlugin } from './registry.js';

/** Local plugin sources no longer carry a remote workspace partition. */
export function localPluginRegistryScope(
  _plugin: { id?: unknown; source?: unknown },
): undefined {
  return undefined;
}

/** Resolve an installed plugin only when its recorded source matches exactly. */
export async function resolveLocalPluginBySource(input: {
  db: Database.Database;
  id: string;
  source: string;
  userPluginsRoot: string;
}): Promise<InstalledPluginRecord | null> {
  const installed = getInstalledPlugin(input.db, input.id);
  return installed?.source === input.source ? installed : null;
}

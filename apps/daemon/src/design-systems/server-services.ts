import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

type JsonRecord = Record<string, unknown>;
type SkillEntry = { id: string; dir?: string; source?: string } & JsonRecord;
type DesignSystemSummary = {
  id: string;
  source?: string;
  status?: string;
  title?: string;
  updatedAt?: string;
  projectId?: string;
} & JsonRecord;

type DesignSystemListOptions = {
  idPrefix?: string;
  source?: string;
  isEditable?: boolean;
  defaultStatus?: string;
  workspaceId?: string | null;
};

type ProjectRecord = {
  id: string;
  name?: string;
  skillId?: string | null;
  designSystemId?: string | null;
  pendingPrompt?: string | null;
  metadata?: JsonRecord;
  createdAt?: number;
  updatedAt?: number;
} & JsonRecord;

type ProjectInsert = {
  id: string;
  name?: string | null;
  skillId?: string | null;
  designSystemId?: string | null;
  pendingPrompt?: string | null;
  metadata?: JsonRecord;
  createdAt: number;
  updatedAt: number;
};

type ProjectPatch = Partial<Omit<ProjectInsert, 'id' | 'createdAt'>> & {
  updatedAt?: number;
};

export type DesignSystemAssetSyncOutcome =
  | { ok: true; synced: string[] }
  | { ok: false; reason: 'not-found' | 'no-workspace-project' };

export function createDesignSystemServerServices({
  roots,
  paths,
  skills,
  designSystems,
  projects,
}: {
  getDb?: () => Database.Database;
  roots: {
    SKILL_ROOTS: string[];
    DESIGN_TEMPLATE_ROOTS: string[];
    ALL_SKILL_LIKE_ROOTS: string[];
  };
  paths: {
    PROJECTS_DIR: string;
    DESIGN_SYSTEMS_DIR: string;
    USER_DESIGN_SYSTEMS_DIR: string;
  };
  skills: {
    listSkills: (roots: string[], options?: JsonRecord) => Promise<SkillEntry[]>;
    findSkillById: (skills: SkillEntry[], id: string) => SkillEntry | undefined;
  };
  designSystems: {
    listDesignSystems: (
      root: string,
      options?: DesignSystemListOptions,
    ) => Promise<DesignSystemSummary[]>;
    readDesignSystem: (
      root: string,
      id: string,
      options?: Pick<DesignSystemListOptions, 'idPrefix' | 'workspaceId'>,
    ) => Promise<string | null | undefined>;
    readDesignSystemPackageInfo: (
      root: string,
      id: string,
      options?: Pick<DesignSystemListOptions, 'idPrefix' | 'workspaceId'>,
    ) => Promise<unknown>;
    readDesignSystemStaticFile: (
      root: string,
      id: string,
      filePath: string,
      options?: Pick<DesignSystemListOptions, 'idPrefix' | 'workspaceId'>,
    ) => Promise<({ bytes: Buffer; contentType: string; updatedAt: string } & JsonRecord) | null | undefined>;
    listUserDesignSystemFiles: (
      root: string,
      id: string,
    ) => Promise<Array<{ kind?: string; path: string }> | null | undefined>;
    readUserDesignSystemFile: (
      root: string,
      id: string,
      filePath: string,
    ) => Promise<{ path: string; content: string } | null | undefined>;
    readUserDesignSystemFileBytes: (
      root: string,
      id: string,
      filePath: string,
    ) => Promise<{ path: string; bytes: Buffer } | null | undefined>;
    linkUserDesignSystemProject: (
      root: string,
      id: string,
      projectId: string,
    ) => Promise<unknown>;
    syncUserDesignSystemAssetsFromFiles: (
      root: string,
      id: string,
      files: Array<{ path: string; content: Buffer }>,
    ) => Promise<{ synced: string[] }>;
    LEGACY_DESIGN_SYSTEM_ARTIFACTS: Array<{
      replacementPaths: string[];
      legacyPath: string;
      removeDirectory?: boolean;
    }>;
  };
  projects: {
    getProject: (db: Database.Database, id: string) => ProjectRecord | null | undefined;
    insertProject: (
      db: Database.Database,
      project: ProjectInsert,
    ) => ProjectRecord | null | undefined;
    updateProject: (
      db: Database.Database,
      id: string,
      patch: ProjectPatch,
    ) => ProjectRecord | null | undefined;
    readProjectFile: (
      projectsDir: string,
      projectId: string,
      filePath: string,
      metadata?: JsonRecord,
    ) => Promise<{ buffer: Buffer }>;
    writeProjectFile: (
      projectsDir: string,
      projectId: string,
      filePath: string,
      content: Buffer,
      options?: JsonRecord,
      metadata?: JsonRecord,
    ) => Promise<unknown>;
    listFiles: (
      projectsDir: string,
      projectId: string,
      options?: { metadata?: JsonRecord },
    ) => Promise<unknown[]>;
    resolveProjectDir: (
      projectsDir: string,
      projectId: string,
      metadata?: JsonRecord,
    ) => string;
    isSafeId: (id: string) => boolean;
  };
  bindProjectToWorkspace?: unknown;
}) {
  async function listAllSkills(_options: JsonRecord = {}) {
    return skills.listSkills(roots.SKILL_ROOTS);
  }

  async function listAllDesignTemplates() {
    return skills.listSkills(roots.DESIGN_TEMPLATE_ROOTS);
  }

  async function listAllSkillLikeEntries(_options: JsonRecord = {}) {
    return skills.listSkills(roots.ALL_SKILL_LIKE_ROOTS);
  }

  async function listAllDesignSystems(_options: JsonRecord = {}) {
    const builtIn = (
      await designSystems.listDesignSystems(paths.DESIGN_SYSTEMS_DIR)
    ).map((system) => ({
      ...system,
      source: 'built-in',
      isEditable: false,
      status: 'published',
    }));
    let installed: DesignSystemSummary[] = [];
    try {
      installed = await designSystems.listDesignSystems(
        paths.USER_DESIGN_SYSTEMS_DIR,
        {
          idPrefix: 'user:',
          source: 'user',
          isEditable: true,
          defaultStatus: 'draft',
        },
      );
    } catch {
      // A fresh install may not have a user design-system directory yet.
    }
    const builtInIds = new Set(builtIn.map((system) => system.id));
    return [
      ...installed
        .filter((system) => system.source === 'user')
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
      ...builtIn,
      ...installed.filter(
        (system) => system.source !== 'user' && !builtInIds.has(system.id),
      ),
    ];
  }

  async function readAvailableDesignSystem(id: string, _options: JsonRecord = {}) {
    if (id.startsWith('user:')) {
      return designSystems.readDesignSystem(paths.USER_DESIGN_SYSTEMS_DIR, id, {
        idPrefix: 'user:',
      });
    }
    return (
      (await designSystems.readDesignSystem(paths.DESIGN_SYSTEMS_DIR, id)) ??
      (await designSystems.readDesignSystem(paths.USER_DESIGN_SYSTEMS_DIR, id))
    );
  }

  async function readAvailableDesignSystemPackageInfo(
    id: string,
    _options: JsonRecord = {},
  ) {
    if (id.startsWith('user:')) {
      return designSystems.readDesignSystemPackageInfo(
        paths.USER_DESIGN_SYSTEMS_DIR,
        id,
        { idPrefix: 'user:' },
      );
    }
    return (
      (await designSystems.readDesignSystemPackageInfo(
        paths.DESIGN_SYSTEMS_DIR,
        id,
      )) ??
      (await designSystems.readDesignSystemPackageInfo(
        paths.USER_DESIGN_SYSTEMS_DIR,
        id,
      ))
    );
  }

  async function readAvailableDesignSystemStaticFile(
    id: string,
    filePath: string,
    _options: JsonRecord = {},
  ) {
    if (id.startsWith('user:')) {
      return designSystems.readDesignSystemStaticFile(
        paths.USER_DESIGN_SYSTEMS_DIR,
        id,
        filePath,
        { idPrefix: 'user:' },
      );
    }
    return (
      (await designSystems.readDesignSystemStaticFile(
        paths.DESIGN_SYSTEMS_DIR,
        id,
        filePath,
      )) ??
      (await designSystems.readDesignSystemStaticFile(
        paths.USER_DESIGN_SYSTEMS_DIR,
        id,
        filePath,
      ))
    );
  }

  function isProjectUsableDesignSystem(
    summary: DesignSystemSummary | null | undefined,
  ) {
    return summary?.status !== 'draft';
  }

  async function validateProjectDesignSystemId(id: unknown, _options: JsonRecord = {}) {
    if (id === undefined || id === null || id === '') return { ok: true, id: null };
    if (typeof id !== 'string') {
      return {
        ok: false,
        code: 'INVALID_DESIGN_SYSTEM',
        message: 'designSystemId must be a string or null',
      };
    }
    const summary = (await listAllDesignSystems()).find(
      (system) => system.id === id,
    );
    if (!summary) {
      return {
        ok: false,
        code: 'DESIGN_SYSTEM_NOT_FOUND',
        message: 'design system not found',
      };
    }
    if (!isProjectUsableDesignSystem(summary)) {
      return {
        ok: false,
        code: 'DESIGN_SYSTEM_NOT_PUBLISHED',
        message: 'draft design systems cannot be used by projects',
      };
    }
    return { ok: true, id };
  }

  async function validateProjectSkillId(id: unknown, _options: JsonRecord = {}) {
    if (id === undefined || id === null || id === '') return { ok: true, id: null };
    if (typeof id !== 'string') {
      return {
        ok: false,
        code: 'INVALID_SKILL_ID',
        message: 'skillId must be a string or null',
      };
    }
    const resolved = skills.findSkillById(await listAllSkillLikeEntries(), id);
    if (!resolved) {
      return {
        ok: false,
        code: 'SKILL_NOT_FOUND',
        message: 'skill not found',
      };
    }
    return { ok: true, id: resolved.id };
  }

  function userDirectoryId(id: string) {
    if (!id.startsWith('user:')) return null;
    const value = id.slice('user:'.length);
    return /^[A-Za-z0-9._-]{1,120}$/.test(value) ? value : null;
  }

  function backingProjectId(id: string, summary: DesignSystemSummary) {
    if (
      typeof summary.projectId === 'string' &&
      projects.isSafeId(summary.projectId)
    ) {
      return summary.projectId;
    }
    const dirId = userDirectoryId(id);
    return dirId ? `ds-${dirId}`.slice(0, 128) : null;
  }

  async function ensureUserDesignSystemWorkspaceProject(
    db: Database.Database,
    id: string,
    _options: JsonRecord = {},
  ) {
    const summary = (await listAllDesignSystems()).find(
      (system) => system.id === id && system.source === 'user',
    );
    if (!summary) return null;
    const projectId = backingProjectId(id, summary);
    if (!projectId) return null;

    const now = Date.now();
    const metadata = {
      kind: 'other',
      importedFrom: 'design-system',
      entryFile: 'DESIGN.md',
      sourceFileName: id,
    };
    const existing = projects.getProject(db, projectId);
    const project = existing
      ? projects.updateProject(db, projectId, {
          name: summary.title ?? id,
          designSystemId: id,
          metadata: { ...(existing.metadata ?? {}), ...metadata },
          updatedAt: now,
        })
      : projects.insertProject(db, {
          id: projectId,
          name: summary.title ?? id,
          skillId: null,
          designSystemId: id,
          pendingPrompt: null,
          metadata,
          createdAt: now,
          updatedAt: now,
        });
    if (!project) return null;

    const files = await designSystems.listUserDesignSystemFiles(
      paths.USER_DESIGN_SYSTEMS_DIR,
      id,
    );
    if (!files) return null;
    for (const file of files) {
      if (file.kind === 'folder') continue;
      const detail = await designSystems.readUserDesignSystemFileBytes(
        paths.USER_DESIGN_SYSTEMS_DIR,
        id,
        file.path,
      );
      if (!detail) continue;
      if (existing) {
        try {
          const current = await projects.readProjectFile(
            paths.PROJECTS_DIR,
            projectId,
            file.path,
            project.metadata,
          );
          if (!isReplaceableWorkspaceFile(file.path, current)) continue;
        } catch (error) {
          if (!isNodeErrorCode(error, 'ENOENT')) throw error;
        }
      }
      await projects.writeProjectFile(
        paths.PROJECTS_DIR,
        projectId,
        file.path,
        detail.bytes,
        {},
        project.metadata,
      );
    }
    await removeLegacyWorkspaceArtifacts(project);
    await designSystems.linkUserDesignSystemProject(
      paths.USER_DESIGN_SYSTEMS_DIR,
      id,
      project.id,
    );
    const projectFiles = await projects.listFiles(
      paths.PROJECTS_DIR,
      projectId,
      project.metadata ? { metadata: project.metadata } : {},
    );
    return { project, files: projectFiles };
  }

  function isReplaceableWorkspaceFile(
    filePath: string,
    file: { buffer?: Buffer } | null | undefined,
  ) {
    const buffer = file?.buffer;
    if (!Buffer.isBuffer(buffer)) return false;
    const text = buffer.toString('utf8');
    if (/^ui_kits\/app\/components\/.+\.(jsx|tsx|js|ts|css|html)$/u.test(filePath)) {
      return buffer.length < 700 && /od-ui-kit-[a-z-]+/u.test(text);
    }
    if (!/^(DESIGN\.md|README\.md|SKILL\.md|ui_kits\/app\/README\.md)$/u.test(filePath)) {
      return false;
    }
    return /preview\/(colors-node-types|colors-ui-palette|typography-scale|spacing-system|logo-variants)\.html|ui_kits\/generated_interface(?:\/index\.html|\/)?/u.test(text);
  }

  async function removeLegacyWorkspaceArtifacts(project: ProjectRecord) {
    if (project.metadata?.importedFrom !== 'design-system') return;
    const dir = projects.resolveProjectDir(
      paths.PROJECTS_DIR,
      project.id,
      project.metadata,
    );
    for (const artifact of designSystems.LEGACY_DESIGN_SYSTEM_ARTIFACTS) {
      const ready = await Promise.all(
        artifact.replacementPaths.map(async (replacementPath) => {
          try {
            const stats = await fs.promises.stat(
              path.join(dir, ...replacementPath.split('/')),
            );
            return stats.isFile();
          } catch (error) {
            if (
              !isNodeErrorCode(error, 'ENOENT') &&
              !isNodeErrorCode(error, 'ENOTDIR')
            ) {
              throw error;
            }
            return false;
          }
        }),
      );
      if (!ready.every(Boolean)) continue;
      await fs.promises.rm(
        path.join(dir, ...artifact.legacyPath.split('/')),
        {
          recursive: artifact.removeDirectory === true,
          force: true,
        },
      );
    }
  }

  async function readDesignSystemWorkspaceTextFile(
    db: Database.Database,
    summary: DesignSystemSummary | null | undefined,
    filePath: string,
  ) {
    if (!summary?.projectId || !projects.isSafeId(summary.projectId)) return null;
    const project = projects.getProject(db, summary.projectId);
    if (!project) return null;
    try {
      const file = await projects.readProjectFile(
        paths.PROJECTS_DIR,
        project.id,
        filePath,
        project.metadata,
      );
      const text = file.buffer.toString('utf8');
      return text.includes('\0') ? null : text;
    } catch {
      return null;
    }
  }

  async function syncUserDesignSystemAssetsFromWorkspace(
    db: Database.Database,
    id: string,
    _options: JsonRecord = {},
  ): Promise<DesignSystemAssetSyncOutcome> {
    const summary = (await listAllDesignSystems()).find(
      (system) => system.id === id && system.source === 'user',
    );
    if (!summary) return { ok: false, reason: 'not-found' };
    const projectId = backingProjectId(id, summary);
    const project = projectId ? projects.getProject(db, projectId) : null;
    if (!project || !projectId) {
      return { ok: false, reason: 'no-workspace-project' };
    }
    const projectFiles = await projects.listFiles(
      paths.PROJECTS_DIR,
      project.id,
      project.metadata ? { metadata: project.metadata } : {},
    );
    const assetPaths = projectFiles
      .map((file) =>
        file && typeof file === 'object'
          ? (file as { path?: unknown }).path
          : undefined,
      )
      .filter(
        (candidate): candidate is string =>
          typeof candidate === 'string' &&
          (candidate === 'assets' || candidate.startsWith('assets/')),
      );
    const files: Array<{ path: string; content: Buffer }> = [];
    for (const assetPath of assetPaths) {
      try {
        const detail = await projects.readProjectFile(
          paths.PROJECTS_DIR,
          project.id,
          assetPath,
          project.metadata,
        );
        files.push({ path: assetPath, content: detail.buffer });
      } catch {
        // A file may disappear between the directory scan and the read.
      }
    }
    const result = await designSystems.syncUserDesignSystemAssetsFromFiles(
      paths.USER_DESIGN_SYSTEMS_DIR,
      id,
      files,
    );
    return { ok: true, synced: result.synced };
  }

  return {
    ensureUserDesignSystemWorkspaceProject,
    isProjectUsableDesignSystem,
    listAllDesignSystems,
    listAllDesignTemplates,
    listAllSkillLikeEntries,
    listAllSkills,
    readAvailableDesignSystem,
    readAvailableDesignSystemPackageInfo,
    readAvailableDesignSystemStaticFile,
    readDesignSystemWorkspaceTextFile,
    syncUserDesignSystemAssetsFromWorkspace,
    validateProjectDesignSystemId,
    validateProjectSkillId,
  };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}

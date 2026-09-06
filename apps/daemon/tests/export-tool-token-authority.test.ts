import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  DesktopRenderSlidesInput,
  DesktopRenderSlidesResult,
} from '@open-design/sidecar-proto';
import {
  closeDatabase,
  ensureWorkspaceProject,
  insertProject,
  openDatabase,
} from '../src/db.js';
import { startServer } from '../src/server.js';
import { toolTokenRegistry } from '../src/tool-tokens.js';

const execFileP = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const tsxCli = path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const rendererCss = Buffer.from('main { color: rgb(12, 34, 56); }\n');
const rendererImage = Buffer.from('renderer-image-exact-bytes');
const daemonApiToken = 'configured-daemon-api-token';
const legacyBaseHref = 'https://external.invalid/legacy/';
const rendererStylesheetPath = 'styles/export.css';
const rendererImagePath = 'assets/hero.png';

describe('od export run-scoped project authority', () => {
  let authorityServer: http.Server;
  let daemonShutdown: () => Promise<void> | void;
  let daemonUrl = '';
  let lastRendererAssetUrl = '';
  let outputDir = '';
  const projectId = `project_${randomUUID()}`;
  const foreignProjectId = `project_${randomUUID()}`;
  const unboundProjectId = `project_${randomUUID()}`;
  const workspaceId = `workspace_${randomUUID()}`;
  const memberId = `member_${randomUUID()}`;
  const boundProjectHtml = `<!doctype html><html><head><base href="${legacyBaseHref}"><link rel="stylesheet" href="${rendererStylesheetPath}"></head><body><main data-renderer-asset-authority>${projectId}</main><img src="${rendererImagePath}" alt=""></body></html>`;

  beforeAll(async () => {
    outputDir = await mkdtemp(path.join(os.tmpdir(), 'od-export-tool-token-'));
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required by the daemon test harness');
    const db = openDatabase(process.cwd(), { dataDir });
    const now = Date.now();
    insertProject(db, {
      id: projectId,
      name: 'Token-bound export project',
      createdAt: now,
      updatedAt: now,
    });
    insertProject(db, {
      id: foreignProjectId,
      name: 'Foreign export project',
      createdAt: now,
      updatedAt: now,
    });
    insertProject(db, {
      id: unboundProjectId,
      name: 'Unbound export project',
      createdAt: now,
      updatedAt: now,
    });
    ensureWorkspaceProject(db, {
      projectId,
      workspaceId,
      visibility: 'team',
      createdByWorkspaceMemberId: memberId,
    });
    ensureWorkspaceProject(db, {
      projectId: foreignProjectId,
      workspaceId: 'foreign-workspace',
      visibility: 'team',
      createdByWorkspaceMemberId: 'foreign-member',
    });
    for (const id of [projectId, foreignProjectId, unboundProjectId]) {
      const projectDir = path.join(dataDir, 'projects', id);
      await mkdir(projectDir, { recursive: true });
      await writeFile(
        path.join(projectDir, 'index.html'),
        id === projectId
          ? boundProjectHtml
          : `<main>${id}</main>`,
      );
      if (id === projectId) {
        await mkdir(path.join(projectDir, 'styles'), { recursive: true });
        await mkdir(path.join(projectDir, 'assets'), { recursive: true });
        await writeFile(path.join(projectDir, 'styles', 'export.css'), rendererCss);
        await writeFile(path.join(projectDir, 'assets', 'hero.png'), rendererImage);
      }
    }

    authorityServer = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        items: [
          {
            workspaceId: 'unrelated-workspace',
            workspaceName: 'Unrelated workspace',
            workspaceType: 'personal',
            workspaceMemberId: 'unrelated-member',
            role: 'owner',
            memberStatus: 'active',
            lifecycleState: 'active',
          },
          {
            workspaceId,
            workspaceName: 'Exact project workspace',
            workspaceType: 'team',
            workspaceMemberId: memberId,
            role: 'owner',
            memberStatus: 'active',
            lifecycleState: 'active',
          },
        ],
      }));
    });
    await new Promise<void>((resolve) => authorityServer.listen(0, '127.0.0.1', resolve));
    const authorityAddress = authorityServer.address();
    if (!authorityAddress || typeof authorityAddress === 'string') {
      throw new Error('authority server did not bind');
    }
    vi.stubEnv('OD_WORKSPACE_CONTEXT_SOURCE', 'vela');
    vi.stubEnv('VELA_CONTROL_KEY', 'test-control-key');
    vi.stubEnv('VELA_API_URL', `http://127.0.0.1:${authorityAddress.port}`);
    vi.stubEnv('OD_API_TOKEN', daemonApiToken);

    const renderer = (input: DesktopRenderSlidesInput): Promise<DesktopRenderSlidesResult> => {
      return (async () => {
        if (!input.outputDir) return { ok: false, error: 'outputDir required' };
        if (input.html.includes('data-renderer-asset-authority')) {
          expect(input.html).toBe(boundProjectHtml);
          expect(input.baseHref).not.toBe(legacyBaseHref);
          lastRendererAssetUrl = new URL(rendererStylesheetPath, input.baseHref).href;
          const cssResponse = await fetch(lastRendererAssetUrl);
          const cssBytes = Buffer.from(await cssResponse.arrayBuffer());
          expect(cssResponse.status, cssBytes.toString()).toBe(200);
          expect(cssBytes).toEqual(rendererCss);
          const imageResponse = await fetch(new URL(rendererImagePath, input.baseHref));
          const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
          expect(imageResponse.status, imageBytes.toString()).toBe(200);
          expect(imageBytes).toEqual(rendererImage);
        }
        await mkdir(input.outputDir, { recursive: true });
        const file = path.join(input.outputDir, 'export.png');
        await writeFile(file, png);
        return { ok: true, slideFiles: [file], width: 1, height: 1, mode: 'page' };
      })();
    };
    const started = await startServer({
      port: 0,
      returnServer: true,
      desktopSlideRenderer: renderer,
    }) as { url: string; shutdown: () => Promise<void> | void };
    daemonUrl = started.url;
    daemonShutdown = started.shutdown;
    vi.stubEnv('OD_API_TOKEN', 'changed-after-server-start');
  });

  afterAll(async () => {
    await daemonShutdown?.();
    await new Promise<void>((resolve) => authorityServer.close(() => resolve()));
    toolTokenRegistry.clear();
    closeDatabase();
    vi.unstubAllEnvs();
    await rm(outputDir, { recursive: true, force: true });
  });

  it('accepts the configured daemon API token for screenshot export', async () => {
    // Given: the API token captured by the daemon at startup, before the env changed.
    const request = {
      method: 'POST',
      headers: {
        authorization: `Bearer ${daemonApiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ fileName: 'index.html' }),
    } as const;

    // When: the configured credential requests a screenshot export.
    const response = await fetch(`${daemonUrl}/api/projects/${unboundProjectId}/export/image`, request);
    const body = Buffer.from(await response.arrayBuffer());

    // Then: it remains on the daemon API-token lane and the export succeeds.
    expect(response.status, body.toString()).toBe(200);
    expect(body).toEqual(png);
  });

  it('exports the exact token-bound project without explicit workspace flags', async () => {
    // Given: a run-scoped token for a project bound to the second directory workspace.
    const token = toolTokenRegistry.mint({
      projectId,
      runId: `run_${randomUUID()}`,
    }).token;
    const outputPath = path.join(outputDir, 'token-bound.png');

    // When: the documented spawned-agent wrapper command runs without workspace flags.
    const result = await runExportCli(projectId, outputPath, token);

    // Then: the exact project exports through its token authority.
    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
  });

  it('derives a bound project workspace without a tool token or workspace flags', async () => {
    // Given: Harness did not forward the short-lived bearer token into its nested shell tool.
    const outputPath = path.join(outputDir, 'project-id-bound.png');

    // When: the documented wrapper command identifies only the project and file.
    const result = await runExportCli(projectId, outputPath);

    // Then: the daemon derives the exact persisted project binding instead of
    // requiring the caller to know an active/default Workspace.
    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
  });

  async function runExportCli(
    requestedProjectId: string,
    outputPath: string,
    token?: string,
    extraArgs: string[] = [],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_OPTIONS: '',
      OD_DAEMON_URL: daemonUrl,
      OD_PROJECT_ID: requestedProjectId,
    };
    if (token) env.OD_TOOL_TOKEN = token;
    else delete env.OD_TOOL_TOKEN;
    try {
      const { stdout, stderr } = await execFileP(
        process.execPath,
        [
          tsxCli,
          cliEntry,
          'export',
          'index.html',
          '--project',
          requestedProjectId,
          '--format',
          'image',
          '--out',
          outputPath,
          ...extraArgs,
        ],
        {
          cwd: daemonRoot,
          env,
          timeout: 15_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return {
        code: failure.code ?? 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      };
    }
  }
});

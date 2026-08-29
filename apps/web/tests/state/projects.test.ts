import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPlugin,
  cacheTabsLocally,
  contributeGeneratedPluginToOpenDesign,
  createConversation,
  createDesignSystemProjectFromProject,
  createProject,
  ProjectCreateError,
  createPluginShareProject,
  deleteProject,
  duplicatePluginAsProject,
  duplicateProject,
  getProject,
  getProjectDetail,
  importClaudeDesignZip,
  importFolderProject,
  deleteTemplate,
  listTemplates,
  installGeneratedPluginFolder,
  installPluginSource,
  listPlugins,
  listPluginsFresh,
  listMessages,
  invalidatePluginCatalogCache,
  listProjects,
  loadTabs,
  patchProject,
  pickLocalFolderPath,
  publishGeneratedPluginToGitHub,
  startGeneratedPluginShareTask,
  uploadPluginFolder,
  waitGeneratedPluginShareTask,
} from '../../src/state/projects';
import {
  projectDisplaySnapshotKey,
  readProjectDisplaySnapshot,
  resetProjectDisplaySnapshots,
  writeProjectDisplaySnapshot,
} from '../../src/state/project-display-cache';
import {
  designBrowserHistoryStorageKey,
  designBrowserViewportStorageKey,
} from '../../src/components/design-browser-storage';describe('createProject local plugin identity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves an automatic OD Next task profile without synthesizing plugin fields', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      project: {
        id: 'project-automatic-strategy',
        name: 'Automatic strategy project',
        skillId: null,
        designSystemId: null,
        createdAt: 1,
        updatedAt: 1,
      },
      conversationId: 'conversation-1',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await createProject({
      name: 'Automatic strategy project',
      skillId: null,
      designSystemId: null,
      metadata: { kind: 'prototype' },
      automaticStrategyTaskProfile: 'prototype',
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      automaticStrategyTaskProfile: 'prototype',
      metadata: { kind: 'prototype' },
    });
    expect(body).not.toHaveProperty('pluginId');
    expect(body).not.toHaveProperty('pluginSource');
    expect(body).not.toHaveProperty('appliedPluginSnapshotId');
    expect(body).not.toHaveProperty('pluginInputs');
  });
});

describe('createConversation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a persisted conversation fork request compact', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      conversation: {
        id: 'fork-1',
        projectId: 'project-1',
        title: 'Fork',
        createdAt: 2,
        updatedAt: 2,
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createConversation('project-1', 'Fork', {
      seedFromConversationId: 'source-1',
      forkAfterMessageId: 'assistant-1',
      forkFallbackMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done',
        events: [{ kind: 'raw', line: 'large diagnostic payload' }],
      },
    })).resolves.toMatchObject({ id: 'fork-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      seedFromConversationId: 'source-1',
      forkAfterMessageId: 'assistant-1',
    });
    expect(body.seedMessages).toBeUndefined();
    expect(body.forkFallbackMessage).toBeUndefined();
  });

  it('retries an unpersisted fork point with one compact fallback message', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (fetchMock.mock.calls.length === 1) {
        expect(body.seedMessages).toBeUndefined();
        expect(body.forkFallbackMessage).toBeUndefined();
        return Response.json({ error: 'fork message not found' }, { status: 404 });
      }
      return Response.json({
        conversation: {
          id: 'fork-recovered',
          projectId: 'project-1',
          title: 'Fork',
          createdAt: 2,
          updatedAt: 2,
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(createConversation('project-1', 'Fork', {
      seedFromConversationId: 'source-1',
      forkAfterMessageId: 'assistant-missing',
      forkFallbackPredecessorMessageId: 'user-before-missing',
      forkFallbackMessage: {
        id: 'assistant-missing',
        role: 'assistant',
        content: 'Partial answer',
        runId: 'failed-run',
        runStatus: 'failed',
        events: [{ kind: 'raw', line: 'large diagnostic payload' }],
        producedFiles: [],
      },
    })).resolves.toMatchObject({ id: 'fork-recovered' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      seedMessages?: unknown;
      forkFallbackMessage?: Record<string, unknown>;
      forkFallbackPredecessorMessageId?: string;
    };
    expect(retryBody.seedMessages).toBeUndefined();
    expect(retryBody.forkFallbackMessage).toEqual({
      id: 'assistant-missing',
      role: 'assistant',
      content: 'Partial answer',
    });
    expect(retryBody.forkFallbackPredecessorMessageId).toBe('user-before-missing');
  });
});describe('applyPlugin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes the current locale to the daemon apply endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        query: '生成一份简报。',
        contextItems: [],
        inputs: [],
        assets: [],
        mcpServers: [],
        projectMetadata: {},
        trust: 'trusted',
        capabilitiesGranted: [],
        capabilitiesRequired: [],
        appliedPlugin: {
          snapshotId: 'snap-1',
          pluginId: 'sample-plugin',
          pluginVersion: '1.0.0',
          manifestSourceDigest: 'a'.repeat(64),
          inputs: {},
          resolvedContext: { items: [] },
          capabilitiesGranted: [],
          capabilitiesRequired: [],
          assetsStaged: [],
          taskKind: 'new-generation',
          appliedAt: 0,
          connectorsRequired: [],
          connectorsResolved: [],
          mcpServers: [],
          status: 'fresh',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await applyPlugin('sample-plugin', { locale: 'zh-CN' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      inputs: {},
      grantCaps: [],
      locale: 'zh-CN',
    });
  });

  it('does not let an old daemon substitute an exact selected source', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/apply-local')) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(applyPlugin('bundled-plugin', {
      pluginSource: 'bundled:bundled-plugin',
    })).resolves.toBeNull();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/plugins/bundled-plugin/apply-local',
    ]);
  });
});

describe('listProjects', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the default fail-soft behavior for background app startup', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 503 })));

    await expect(listProjects()).resolves.toEqual([]);
  });

  it('can reject transport failures for refresh paths that must preserve current state', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 503 })));

    await expect(listProjects({ throwOnError: true })).rejects.toThrow('projects 503');
  });

  it('coalesces a burst of identical reads into a single request', async () => {
    // A rapid tab switch (草稿 ↔ 全部项目) or several separately-mounted grids
    // each call listProjects at once; without coalescing that is one vela-backed
    // request — and one spawned CLI subprocess — per caller, which overwhelmed
    // the daemon and hung the loader. Identical in-flight reads must share one.
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ projects: [{ id: 'p1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const [a, b, c] = await Promise.all([listProjects(), listProjects(), listProjects()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ id: 'p1' }]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe('createProject', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves daemon validation messages from non-2xx create responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        error: {
          message: 'draft design systems cannot be used by projects',
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createProject({
      name: 'Draft DS project',
      skillId: null,
      designSystemId: 'user:draft-system',
    })).rejects.toThrow('draft design systems cannot be used by projects');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('uses a caller-minted project id for an optimistic route handoff', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      return new Response(JSON.stringify({
        project: { id: body.id },
        conversationId: 'optimistic-conversation',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const created = await createProject({
      id: 'optimistic-project',
      name: 'Optimistic project',
      skillId: null,
      designSystemId: null,
    });

    expect(created.project.id).toBe('optimistic-project');
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { id: string };
    expect(body.id).toBe('optimistic-project');
  });

  it('does not retry a 503 that is not marked retryable', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'nope' } }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createProject(
      { name: 'x', skillId: null, designSystemId: null },
      { sleep: async () => {} },
    )).rejects.toThrow('nope');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies the web proxy connection-refused 502 as a daemon transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      'connect ECONNREFUSED 127.0.0.1:17660',
      { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )));

    await expect(createProject({
      name: 'Daemon offline',
      skillId: null,
      designSystemId: null,
    })).rejects.toMatchObject({
      status: null,
      code: null,
    });
  });

  it('does not misclassify an ordinary business 502 as a daemon transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: { message: 'billing gateway rejected the request' } }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )));

    await expect(createProject({
      name: 'Business failure',
      skillId: null,
      designSystemId: null,
    })).rejects.toMatchObject({
      status: 502,
      message: 'billing gateway rejected the request',
    });
  });

  it('gives up after the retry budget when a retryable 503 persists', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: { message: 'still down', retryable: true } }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createProject(
      { name: 'x', skillId: null, designSystemId: null },
      { maxRetries: 2, sleep: async () => {} },
    )).rejects.toThrow('still down');
    // Initial attempt + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// recvq5ecTkar91: a team project that leaked into a personal workspace's 草稿
// grid was also really deletable from there, not just visible — because this
// call never told the daemon which workspace it was acting from.
// `enforceWorkspaceProjectMutation` (apps/daemon/src/routes/project/index.ts)
// treats a request with NEITHER `x-od-workspace-id` NOR
// `x-od-workspace-member-id` as a legacy caller outside the workspace system
// entirely and skips its ownership check — so every delete from a
// workspace-team build silently bypassed cross-workspace permission checking,
// wrong-workspace project or not. Attaching the same headers
// `moveWorkspaceProject` already sends is what lets the daemon's existing
// (correct) `getWorkspaceProject(ctx.workspaceId, projectId)` scoping fire.
describe('deleteProject', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports failure when the daemon refuses the delete', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 403 })));

    await expect(deleteProject('someone-elses-project')).rejects.toMatchObject({
      name: 'ProjectDeleteError',
      status: 403,
    });
  });

  it('treats a structured missing-project response as an idempotent success', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: {
        code: 'PROJECT_NOT_FOUND',
        message: 'not found',
      },
    }), { status: 404 })));

    await expect(deleteProject('already-deleted')).resolves.toBe(true);
  });

  it('does not hide an unstructured 404 from an incompatible daemon', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 404 })));

    await expect(deleteProject('project-1')).rejects.toMatchObject({
      name: 'ProjectDeleteError',
      status: 404,
    });
  });
});// Same enforceWorkspaceProjectMutation bypass as deleteProject/duplicateProject:
// a rename, metadata patch, or pendingPrompt clear sent no workspace headers,
// so a read-only team member could still push a PATCH through.
describe('patchProject', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports failure when the daemon refuses the patch', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 403 })));

    await expect(
      patchProject('someone-elses-project', { name: 'Renamed' }),
    ).resolves.toBeNull();
  });
});describe('installGeneratedPluginFolder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves install diagnostics from non-2xx project folder responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        ok: false,
        warnings: ['Missing open-design.json'],
        message: 'Plugin validation failed.',
        log: ['Validating generated-plugin'],
      }),
      { status: 400, headers: { 'content-type': 'application/json' }, statusText: 'Bad Request' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await installGeneratedPluginFolder('project-1', 'generated-plugin');

    expect(outcome).toMatchObject({
      ok: false,
      warnings: ['Missing open-design.json'],
      message: 'Plugin validation failed.',
      log: ['Validating generated-plugin'],
    });
  });
});

describe('installPluginSource diagnostics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a syntactically valid but unknown SSE error code', async () => {
    const event = JSON.stringify({
      kind: 'error',
      code: 'UPSTREAM_abc123',
      message: 'Unknown upstream failure',
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`data: ${event}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })));

    await expect(installPluginSource('github:owner/repo')).resolves.toEqual({
      ok: false,
      warnings: [],
      message: 'Unknown upstream failure',
      log: ['Unknown upstream failure'],
    });
  });
});

describe('importClaudeDesignZip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves daemon import errors from non-2xx responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: 'Unable to unpack Claude export.' }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['zip-bytes'], 'claude-design.zip', {
      type: 'application/zip',
    });

    await expect(importClaudeDesignZip(file)).rejects.toThrow(
      'Unable to unpack Claude export.',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/import/claude-design',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    );
  });
});

describe('createPluginShareProject', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an agent-backed share project for an installed plugin', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        ok: true,
        project: {
          id: 'project-1',
          name: 'Publish to GitHub: Sample Plugin',
          skillId: null,
          designSystemId: null,
          createdAt: 1,
          updatedAt: 1,
          pendingPrompt: 'Publish it',
          metadata: { kind: 'prototype' },
        },
        conversationId: 'conversation-1',
        appliedPluginSnapshotId: 'snapshot-1',
        actionPluginId: 'od-plugin-publish-github',
        sourcePluginId: 'sample-plugin',
        stagedPath: 'plugin-source/sample-plugin',
        prompt: 'Publish it',
        message: 'Created a Publish to GitHub task.',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await createPluginShareProject(
      'sample-plugin',
      'publish-github',
      'zh-CN',
    );

    expect(outcome).toMatchObject({
      ok: true,
      project: { id: 'project-1' },
      appliedPluginSnapshotId: 'snapshot-1',
      stagedPath: 'plugin-source/sample-plugin',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugins/sample-plugin/share-project',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'publish-github', locale: 'zh-CN' }),
      }),
    );
  });

  it('surfaces share project errors from the daemon', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        ok: false,
        code: 'share-action-plugin-missing',
        message: 'Restart the daemon.',
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await createPluginShareProject(
      'sample-plugin',
      'contribute-open-design',
    );

    expect(outcome).toEqual({
      ok: false,
      code: 'share-action-plugin-missing',
      message: 'Restart the daemon.',
    });
  });
});

describe('importFolderProject', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the project on success', async () => {
    const response = {
      project: { id: 'p-1', name: 'My Folder' },
      conversationId: 'conv-1',
      entryFile: 'index.html',
    };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const result = await importFolderProject({ baseDir: '/home/user/project' });
    expect(result).toMatchObject({ project: { id: 'p-1' }, entryFile: 'index.html' });
  });

  it('throws with daemon error message for filesystem root', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'cannot import the filesystem root' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )));

    await expect(importFolderProject({ baseDir: '/' }))
      .rejects.toThrow('cannot import the filesystem root');
  });

  it('throws with daemon error message for non-existent folder', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'folder not found' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )));

    await expect(importFolderProject({ baseDir: '/abc/xyz/notexist' }))
      .rejects.toThrow('folder not found');
  });

  it('throws with daemon error message for file path', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'path must be a directory' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )));

    await expect(importFolderProject({ baseDir: '/etc/hosts' }))
      .rejects.toThrow('path must be a directory');
  });

  it('throws a fallback message when response body has no error detail', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      'Internal Server Error',
      { status: 500 },
    )));

    await expect(importFolderProject({ baseDir: '/some/path' }))
      .rejects.toThrow('Failed to import folder');
  });
});describe('pickLocalFolderPath', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the selected native folder path', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ path: '/Users/me/Site' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(pickLocalFolderPath()).resolves.toBe('/Users/me/Site');
    expect(fetchMock).toHaveBeenCalledWith('/api/dialog/open-folder', {
      method: 'POST',
    });
  });

  it('returns null when the native picker is cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ path: null }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    await expect(pickLocalFolderPath()).resolves.toBeNull();
  });

  it('throws with the daemon picker error message', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: 'cross-origin request rejected' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )));

    await expect(pickLocalFolderPath()).rejects.toThrow('cross-origin request rejected');
  });
});

describe('plugin upload diagnostics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves a bounded daemon error code on folder upload failure', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({
      ok: false,
      warnings: [],
      message: 'Plugin manifest is missing at /Users/example/private-plugin',
      errorCode: 'INVALID_MANIFEST',
      log: [],
    }, { status: 400 })));

    await expect(uploadPluginFolder([
      new File(['readme'], 'README.md', { type: 'text/markdown' }),
    ])).resolves.toMatchObject({
      ok: false,
      errorCode: 'INVALID_MANIFEST',
    });
  });
});

describe('deleteProject local caches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tabsKey = 'open-design:project-tabs:v1:p1';
  const historyKey = designBrowserHistoryStorageKey('p1');
  const viewportKey = designBrowserViewportStorageKey('p1');

  function stubWindowStore(): Map<string, string> {
    const store = new Map<string, string>([
      [tabsKey, JSON.stringify({ tabs: [], active: null })],
      [historyKey, JSON.stringify([{ url: 'https://example.com', title: 'Example', lastVisitedAt: 1 }])],
      [viewportKey, 'mobile'],
    ]);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });
    return store;
  }

  it('prunes tabs and Design Browser caches on a successful delete', async () => {
    const store = stubWindowStore();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 200 })));
    await expect(deleteProject('p1')).resolves.toBe(true);
    expect(store.has(tabsKey)).toBe(false);
    expect(store.has(historyKey)).toBe(false);
    expect(store.has(viewportKey)).toBe(false);
  });

  it('keeps tabs and Design Browser caches when the delete fails', async () => {
    const store = stubWindowStore();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 500 })));
    await expect(deleteProject('p1')).rejects.toMatchObject({
      name: 'ProjectDeleteError',
      status: 500,
    });
    expect(store.has(tabsKey)).toBe(true);
    expect(store.has(historyKey)).toBe(true);
    expect(store.has(viewportKey)).toBe(true);
  });
});describe('listTemplates request coalescing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  it('collapses concurrent template-list reads into a single request', async () => {
    // Same launch-burst shape as the design-system catalog: App's one-shot
    // bootstrap and the home-route effect both want the list on the same pass,
    // and both must keep their own read — one settles the entry view, the other
    // exists to pick up a template saved inside a project. On the wire they are
    // one request, and on a cold Home load they land together.
    const gate = deferred<Response>();
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      reads += 1;
      return gate.promise;
    }));

    const inFlight = [listTemplates(), listTemplates(), listTemplates()];
    await vi.waitFor(() => expect(reads).toBeGreaterThan(0));
    expect(reads).toBe(1);

    gate.resolve(new Response(
      JSON.stringify({ templates: [{ id: 'tpl-1', name: 'Landing page' }] }),
      { status: 200 },
    ));
    for (const read of inFlight) {
      await expect(read).resolves.toEqual([
        expect.objectContaining({ id: 'tpl-1' }),
      ]);
    }
  });

  it('re-reads the template list for a call issued after the previous settled', async () => {
    // Single-flight only, never a shared settled answer: returning Home re-reads
    // precisely so a template saved inside a project shows up, and the save
    // handler awaits its own refresh. A cached list would hand both of them the
    // list they were fired to replace.
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      reads += 1;
      return new Response(
        JSON.stringify({ templates: reads > 1 ? [{ id: 'tpl-new', name: 'Saved' }] : [] }),
        { status: 200 },
      );
    }));

    await expect(listTemplates()).resolves.toEqual([]);
    await expect(listTemplates()).resolves.toEqual([
      expect.objectContaining({ id: 'tpl-new' }),
    ]);
    expect(reads).toBe(2);
  });

  it('starts a fresh template read when a mutation lands mid-flight', async () => {
    // Review catch. `ttl = 0` stops settled-result reuse but not in-flight
    // joining, and the post-mutation refresh is exactly the caller that must
    // never join: `handleDeleteTemplate` awaits `deleteTemplate` and then calls
    // `refreshTemplates`. The daemon answers `/api/templates` from a synchronous
    // `listTemplates(db)` snapshot, so a GET issued before the DELETE returns
    // the row that was just deleted — and joining it would leave the deleted
    // template on screen until something else happened to refetch.
    const pending = deferred<Response>();
    const urls: string[] = [];
    let templateRows = [{ id: 'tpl-doomed', name: 'Doomed' }];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(`${init?.method ?? 'GET'} ${url}`);
      if ((init?.method ?? 'GET') === 'DELETE') {
        templateRows = [];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      // The first GET is issued before the delete and answers the pre-delete
      // snapshot; it stays pending across the mutation.
      if (urls.filter((u) => u.startsWith('GET')).length === 1) return pending.promise;
      return Promise.resolve(new Response(
        JSON.stringify({ templates: templateRows }),
        { status: 200 },
      ));
    }));

    const inFlightBeforeMutation = listTemplates();
    await expect(deleteTemplate('tpl-doomed')).resolves.toBe(true);

    const afterMutation = listTemplates();
    // Release the pre-delete GET. If the refresh joined it, it now resolves to
    // the stale row instead of issuing its own read.
    pending.resolve(new Response(
      JSON.stringify({ templates: [{ id: 'tpl-doomed', name: 'Doomed' }] }),
      { status: 200 },
    ));

    await expect(afterMutation).resolves.toEqual([]);
    await expect(inFlightBeforeMutation).resolves.toEqual([
      expect.objectContaining({ id: 'tpl-doomed' }),
    ]);
  });

  it('lets the next caller retry instead of joining a failed read', async () => {
    // Failures are never cached: a transient 500 must not leave the entry view
    // with an empty template list until something else happens to refetch.
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      reads += 1;
      return reads === 1
        ? new Response('nope', { status: 500 })
        : new Response(JSON.stringify({ templates: [{ id: 'tpl-2', name: 'Deck' }] }), { status: 200 });
    }));

    await expect(listTemplates()).resolves.toEqual([]);
    await expect(listTemplates()).resolves.toEqual([
      expect.objectContaining({ id: 'tpl-2' }),
    ]);
    expect(reads).toBe(2);
  });
});

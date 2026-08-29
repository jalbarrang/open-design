import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@/playwright/suite';
import type { Page } from '@playwright/test';

import { runErrorCard } from '@/playwright/chat';
import { routeAgents, suppressWhatsNew } from '@/playwright/mock-factory';
import { T } from '@/timeouts';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import {
  createProjectViaApi,
  gotoProject,
  putAppConfig,
  seedBrowserConfig,
} from '@/playwright/app';

let codexRuntime: Awaited<ReturnType<typeof createFakeAgentRuntimes>>['codex'];

const CLAUDE_AGENT = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  available: true,
  version: 'test',
  models: [{ id: 'default', label: 'Default' }],
};
const ANTIGRAVITY_AGENT = {
  id: 'antigravity',
  name: 'Antigravity',
  bin: 'antigravity',
  available: true,
  version: 'test',
  models: [{ id: 'default', label: 'Default' }],
};

// Timeout-only configure: each test stubs its own catalogs/agents routes and
// creates its own project, so order independence holds and the file stays
// splittable across CI shards (a serial group cannot be split).
//
// This must stay a SINGLE call. `test.describe.configure` only overwrites the
// keys it is given, so a later `configure({ timeout })` cannot undo an earlier
// `configure({ mode: 'serial' })`. `mode: 'serial'` is also forbidden outright
// by e2e/AGENTS.md's UI test stability rules.
test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  await suppressWhatsNew(page);
});

async function stubCatalogsEmpty(page: Page) {
  await page.route('**/api/skills', async (route) => {
    await route.fulfill({ json: { skills: [] } });
  });
  await page.route('**/api/design-templates', async (route) => {
    await route.fulfill({ json: { designTemplates: [] } });
  });
  await page.route('**/api/design-systems', async (route) => {
    await route.fulfill({ json: { designSystems: [] } });
  });
}

async function stubRuntimeAgents(page: Page) {
  await routeAgents(page, [
    {
      id: 'codex',
      name: 'Codex CLI',
      bin: 'codex',
      available: true,
      version: 'test',
      models: [{ id: 'default', label: 'Default' }],
    },
    CLAUDE_AGENT,
    ANTIGRAVITY_AGENT,
  ]);
}

test.beforeAll(async () => {
  const runtimes = await createFakeAgentRuntimes(['codex', 'claude']);
  codexRuntime = runtimes.codex;
});

test('[P0] upstream outages keep Retry available on the failed run', async ({ page }) => {
  await stubCatalogsEmpty(page);
  await stubRuntimeAgents(page);
  const root = join(tmpdir(), `open-design-upstream-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const runtimes = await createFakeAgentRuntimes({ root: join(root, 'agents'), runtimeIds: ['claude'] });
  const config = {
    mode: 'daemon',
    apiKey: '',
    baseUrl: '',
    model: '',
    agentId: 'claude',
    skillId: null,
    designSystemId: null,
    onboardingCompleted: true,
    privacyDecisionAt: 1,
    mediaProviders: {},
    agentModels: {
      claude: { model: 'default', reasoning: 'default' },
    },
    agentCliEnv: {
      claude: runtimes.claude.env,
    },
  };

  await seedBrowserConfig(page, config);
  await putAppConfig(page, config);

  const projectId = `upstream-ui-${Date.now()}`.replace(/[^A-Za-z0-9._-]/g, '-');
  const { conversationId } = await createProjectViaApi(page, projectId, 'Upstream outage recovery');

  const userMsgId = `u-${projectId}`;
  const userMsgRes = await page.request.put(
    `/api/projects/${projectId}/conversations/${conversationId}/messages/${userMsgId}`,
    {
      data: {
        role: 'user',
        content: 'please build something',
        createdAt: Date.now() - 2_000,
      },
    },
  );
  expect(userMsgRes.ok(), `upsert user msg: ${await userMsgRes.text()}`).toBeTruthy();

  const assistantMsgId = `a-${projectId}`;
  const assistantMsgRes = await page.request.put(
    `/api/projects/${projectId}/conversations/${conversationId}/messages/${assistantMsgId}`,
    {
      data: {
        role: 'assistant',
        content: '',
        agentId: 'claude',
        runId: `run-${projectId}`,
        runStatus: 'failed',
        createdAt: Date.now() - 1_000,
        startedAt: Date.now() - 1_000,
        preTurnFileNames: [],
        events: [
          {
            kind: 'status',
            label: 'error',
            detail: 'The model provider is temporarily unavailable.',
            code: 'UPSTREAM_UNAVAILABLE',
          },
        ],
      },
    },
  );
  expect(assistantMsgRes.ok(), `upsert assistant msg: ${await assistantMsgRes.text()}`).toBeTruthy();

  await gotoProject(page, projectId);

  await expect(page.getByRole('button', { name: /^Retry$|^重试$|^重試$/i }).first()).toBeVisible({ timeout: T.long });
  await expect(page.getByText(/Generation service unavailable|model provider is temporarily unavailable/i).first()).toBeVisible();
  await expect(page.getByText(/Model call failed/i)).toHaveCount(0);
});

test('[P1] zh-CN run failure guidance shows actionable copy and expandable raw source', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('open-design:locale', 'zh-CN');
    window.localStorage.setItem('open-design:locale-source', 'manual');
  });
  await stubCatalogsEmpty(page);
  await stubRuntimeAgents(page);

  const config = {
    mode: 'daemon',
    apiKey: '',
    baseUrl: '',
    model: '',
    agentId: 'codex',
    skillId: null,
    designSystemId: null,
    onboardingCompleted: true,
    privacyDecisionAt: 1,
    mediaProviders: {},
    agentModels: {
      codex: { model: 'default', reasoning: 'default' },
    },
    agentCliEnv: {
      codex: codexRuntime.env,
    },
  };
  await seedBrowserConfig(page, config);
  await putAppConfig(page, config);

  const projectId = `prompt-too-large-ui-${Date.now()}`.replace(/[^A-Za-z0-9._-]/g, '-');
  const { conversationId } = await createProjectViaApi(page, projectId, 'Prompt too large guidance');

  const userMsgRes = await page.request.put(
    `/api/projects/${projectId}/conversations/${conversationId}/messages/u-${projectId}`,
    {
      data: {
        role: 'user',
        content: 'please build with a very large attachment set',
        createdAt: Date.now() - 2_000,
      },
    },
  );
  expect(userMsgRes.ok(), `upsert user msg: ${await userMsgRes.text()}`).toBeTruthy();

  const rawDetail = 'context window exceeded: estimated 250000 tokens for this run.';
  const assistantMsgRes = await page.request.put(
    `/api/projects/${projectId}/conversations/${conversationId}/messages/a-${projectId}`,
    {
      data: {
        role: 'assistant',
        content: '',
        agentId: 'codex',
        agentName: 'Codex CLI',
        runId: `run-${projectId}`,
        runStatus: 'failed',
        createdAt: Date.now() - 1_000,
        startedAt: Date.now() - 1_000,
        preTurnFileNames: [],
        events: [
          {
            kind: 'status',
            label: 'error',
            detail: rawDetail,
            code: 'AGENT_PROMPT_TOO_LARGE',
          },
        ],
      },
    },
  );
  expect(assistantMsgRes.ok(), `upsert assistant msg: ${await assistantMsgRes.text()}`).toBeTruthy();

  await gotoProject(page, projectId);

  const card = runErrorCard(page);
  await expect(card).toContainText('内容过长', { timeout: T.long });
  await expect(card).toContainText('本轮输入超出了模型的上下文上限');
  await expect(page.getByRole('button', { name: /^重试$/ }).first()).toBeVisible();

  const sourceToggle = card.getByRole('button', { name: /查看详情/ });
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'false');
  await sourceToggle.click();
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.run-error__diagnostic')).toContainText(rawDetail);
});

test('[P0] antigravity rate limits offer terminal model switching', async ({ page }) => {
  await stubCatalogsEmpty(page);
  await stubRuntimeAgents(page);
  let oauthLaunchCalls = 0;
  await page.route('**/api/agents/antigravity/oauth-launch', async (route) => {
    oauthLaunchCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  const config = {
    mode: 'daemon',
    apiKey: '',
    baseUrl: '',
    model: '',
    agentId: 'antigravity',
    skillId: null,
    designSystemId: null,
    onboardingCompleted: true,
    privacyDecisionAt: 1,
    mediaProviders: {},
    agentModels: {
      antigravity: { model: 'default', reasoning: 'default' },
    },
  };

  await seedBrowserConfig(page, config);
  await putAppConfig(page, config);

  const projectId = `antigravity-ui-${Date.now()}`.replace(/[^A-Za-z0-9._-]/g, '-');
  const { conversationId } = await createProjectViaApi(page, projectId, 'Antigravity rate limit recovery');

  const userMsgId = `u-${projectId}`;
  const userMsgRes = await page.request.put(
    `/api/projects/${projectId}/conversations/${conversationId}/messages/${userMsgId}`,
    {
      data: {
        role: 'user',
        content: 'please build something',
        createdAt: Date.now() - 2_000,
      },
    },
  );
  expect(userMsgRes.ok(), `upsert user msg: ${await userMsgRes.text()}`).toBeTruthy();

  const assistantMsgId = `a-${projectId}`;
  const assistantMsgRes = await page.request.put(
    `/api/projects/${projectId}/conversations/${conversationId}/messages/${assistantMsgId}`,
    {
      data: {
        role: 'assistant',
        content: '',
        agentId: 'antigravity',
        runId: `run-${projectId}`,
        runStatus: 'failed',
        createdAt: Date.now() - 1_000,
        startedAt: Date.now() - 1_000,
        preTurnFileNames: [],
        events: [
          {
            kind: 'status',
            label: 'error',
            detail: 'Switch to another Antigravity model before retrying this run.',
            code: 'RATE_LIMITED',
          },
        ],
      },
    },
  );
  expect(assistantMsgRes.ok(), `upsert assistant msg: ${await assistantMsgRes.text()}`).toBeTruthy();

  await gotoProject(page, projectId);

  const launchTerminal = page.getByRole('button', { name: /Switch model in terminal/i }).first();
  await expect(launchTerminal).toBeVisible({ timeout: T.long });
  await expect(page.getByRole('button', { name: /^Retry$|^重试$|^重試$/i }).first()).toBeVisible();

  await launchTerminal.click();

  await expect.poll(() => oauthLaunchCalls).toBe(1);
});

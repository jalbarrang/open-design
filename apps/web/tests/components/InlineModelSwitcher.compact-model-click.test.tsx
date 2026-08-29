// @vitest-environment jsdom

import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mergeAgentModelChoice } from '../../src/App';
import { InlineModelSwitcher } from '../../src/components/InlineModelSwitcher';
import type { AgentInfo, AppConfig } from '../../src/types';

vi.mock('../../src/providers/provider-models', () => ({
  fetchProviderModels: vi.fn(async () => ({ ok: false, models: [] })),
}));

const baseConfig: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  apiProtocol: 'anthropic',
  apiVersion: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  apiProtocolConfigs: {},
  agentId: 'codex',
  skillId: null,
  designSystemId: null,
  onboardingCompleted: true,
  mediaProviders: {},
  agentModels: {},
  agentCliEnv: {},
};

const codexAgent: AgentInfo = {
  id: 'codex',
  name: 'Codex CLI',
  bin: 'codex',
  available: true,
  version: '1.0.0',
  models: [
    { id: 'default', label: 'Default' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
  ],
};

function StatefulSwitcher() {
  const [config, setConfig] = useState(baseConfig);
  const persistedRef = useRef(config);
  return (
    <InlineModelSwitcher
      config={config}
      agents={[codexAgent]}
      providerModelsCache={{}}
      daemonLive
      onModeChange={vi.fn()}
      onAgentChange={vi.fn()}
      onAgentModelChange={(agentId, choice) => {
        const current = persistedRef.current;
        const merged = mergeAgentModelChoice(
          current.agentModels?.[agentId] ?? {},
          choice,
        );
        const next = {
          ...current,
          agentModels: { ...(current.agentModels ?? {}), [agentId]: merged },
        };
        persistedRef.current = next;
        setConfig(next);
      }}
      onApiProtocolChange={vi.fn()}
      onApiModelChange={vi.fn()}
      onOpenSettings={vi.fn()}
    />
  );
}

afterEach(cleanup);

describe('InlineModelSwitcher model selection', () => {
  it('keeps the execution-settings picker applying a model', async () => {
    render(<StatefulSwitcher />);
    const trigger = screen.getByRole('button', { name: 'Codex CLI · default' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    fireEvent.click(screen.getByRole('option', { name: 'GPT-5.4' }));

    await waitFor(() => expect(trigger).toHaveTextContent('gpt-5.4'));
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('GPT-5.4');
  });
});

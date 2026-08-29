// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InlineModelSwitcher } from '../../src/components/InlineModelSwitcher';
import type { AgentInfo, AppConfig } from '../../src/types';

const config: AppConfig = {
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

const agents: AgentInfo[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    available: true,
    version: '1.0.0',
    models: [{ id: 'default', label: 'Default' }],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    available: true,
    version: '1.0.0',
    models: [{ id: 'sonnet', label: 'Sonnet' }],
  },
];

function renderSwitcher(options: { compact?: boolean } = {}) {
  const onModeChange = vi.fn();
  const onAgentChange = vi.fn();
  const onApiProtocolChange = vi.fn();
  const view = render(
    <InlineModelSwitcher
      config={config}
      agents={agents}
      providerModelsCache={{}}
      compact={options.compact}
      daemonLive
      onModeChange={onModeChange}
      onAgentChange={onAgentChange}
      onAgentModelChange={vi.fn()}
      onApiProtocolChange={onApiProtocolChange}
      onApiModelChange={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  return { ...view, onModeChange, onAgentChange, onApiProtocolChange };
}

afterEach(cleanup);

describe('InlineModelSwitcher local and BYOK models', () => {
  it('keeps an accessible name on the trigger', () => {
    renderSwitcher();

    const trigger = screen.getByRole('button', { name: 'Codex CLI · default' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders the compact home-hero variant', () => {
    const { container } = renderSwitcher({ compact: true });

    expect(container.querySelector('.inline-model-switcher')).toHaveClass(
      'inline-model-switcher--compact',
    );
  });

  it('offers local agents and BYOK protocols through the same picker', () => {
    const { onAgentChange, onApiProtocolChange, onModeChange } = renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'Codex CLI · default' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose your model source' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Claude Code' }));
    expect(onModeChange).toHaveBeenCalledWith('daemon');
    expect(onAgentChange).toHaveBeenCalledWith('claude');

    fireEvent.click(within(dialog).getByRole('button', { name: 'OpenAI' }));
    expect(onModeChange).toHaveBeenCalledWith('api');
    expect(onApiProtocolChange).toHaveBeenCalledWith('openai');
  });
});

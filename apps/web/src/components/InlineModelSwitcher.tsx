import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Button } from '@open-design/components';
import type { AgentInfo, ApiProtocol, AppConfig, ExecMode } from '../types';
import { useT } from '../i18n';
import { isVisibleLocalCliAgent } from '../utils/visibleAgents';
import { AgentIcon } from './AgentIcon';
import { Icon } from './Icon';
import {
  defaultAgentModelId,
  effectiveAgentModelChoice,
  normalizeAgentModelChoice,
} from './agentModelSelection';
import { SearchableModelSelect } from './modelOptions';
import type { ProviderModelsCache } from './providerModelsCache';

interface Props {
  config: AppConfig;
  agents: AgentInfo[];
  providerModelsCache?: ProviderModelsCache;
  compact?: boolean;
  daemonLive: boolean;
  onModeChange: (mode: ExecMode) => void;
  onAgentChange: (id: string) => void;
  onAgentModelChange: (
    id: string,
    choice: { model?: string; reasoning?: string; serviceTier?: string },
  ) => void;
  onApiProtocolChange: (protocol: ApiProtocol) => void;
  onApiModelChange: (model: string) => void;
  onProviderModelsCacheChange?: Dispatch<SetStateAction<ProviderModelsCache>>;
  onOpenSettings: (
    section?:
      | 'execution'
      | 'media'
      | 'composio'
      | 'language'
      | 'appearance'
      | 'notifications'
      | 'pet'
      | 'about',
  ) => void;
}

const API_PROTOCOLS: ReadonlyArray<{ id: ApiProtocol; label: string }> = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'azure', label: 'Azure' },
  { id: 'google', label: 'Google' },
  { id: 'aihubmix', label: 'AIHubMix' },
];

export function InlineModelSwitcher({
  config,
  agents,
  compact = false,
  daemonLive,
  onModeChange,
  onAgentChange,
  onAgentModelChange,
  onApiProtocolChange,
  onOpenSettings,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const localAgents = useMemo(
    () => agents.filter((agent) => isVisibleLocalCliAgent(agent) && agent.available),
    [agents],
  );
  const selectedAgent = config.mode === 'daemon'
    ? localAgents.find((agent) => agent.id === config.agentId) ?? localAgents[0] ?? null
    : null;
  const selectedChoice = selectedAgent
    ? effectiveAgentModelChoice(selectedAgent, config.agentModels?.[selectedAgent.id])
    : null;
  const selectedModel = selectedChoice?.model ?? (selectedAgent ? defaultAgentModelId(selectedAgent) : null);
  const chipLabel = config.mode === 'api'
    ? `${API_PROTOCOLS.find((protocol) => protocol.id === config.apiProtocol)?.label ?? 'BYOK'}${config.model ? ` · ${config.model}` : ''}`
    : selectedAgent
      ? `${selectedAgent.name}${selectedModel ? ` · ${selectedModel}` : ''}`
      : t('settings.onboardingLocalTitle');

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={`inline-model-switcher${compact ? ' inline-model-switcher--compact' : ''}`}
    >
      <Button
        variant="subtle"
        className="inline-model-switcher__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selectedAgent ? <AgentIcon id={selectedAgent.id} size={16} /> : <Icon name="key" size={15} />}
        <span>{chipLabel}</span>
        <Icon name="chevron-down" size={12} />
      </Button>

      {open ? (
        <div className="inline-model-switcher__popover" role="dialog" aria-label={t('settings.onboardingExecutionTitle')}>
          <div className="inline-model-switcher__section">
            <span className="inline-model-switcher__label">{t('settings.onboardingLocalTitle')}</span>
            {localAgents.map((agent) => {
              const active = config.mode === 'daemon' && selectedAgent?.id === agent.id;
              return (
                <Button
                  key={agent.id}
                  variant="subtle"
                  className={`inline-model-switcher__option${active ? ' is-active' : ''}`}
                  onClick={() => {
                    onModeChange('daemon');
                    onAgentChange(agent.id);
                  }}
                >
                  <AgentIcon id={agent.id} size={18} />
                  <span>{agent.name}</span>
                  {active ? <Icon name="check" size={13} /> : null}
                </Button>
              );
            })}
            {selectedAgent?.models?.length ? (
              <SearchableModelSelect
                className="inline-switcher__select"
                value={selectedModel ?? ''}
                models={selectedAgent.models}
                aria-label={t('settings.modelPicker')}
                searchPlaceholder={t('designs.searchPlaceholder')}
                onChange={(model) => {
                  const current = config.agentModels?.[selectedAgent.id] ?? {};
                  const next = { ...current, model };
                  onAgentModelChange(
                    selectedAgent.id,
                    normalizeAgentModelChoice(selectedAgent, next) ?? next,
                  );
                }}
              />
            ) : null}
          </div>

          <div className="inline-model-switcher__section">
            <span className="inline-model-switcher__label">BYOK</span>
            {API_PROTOCOLS.map((protocol) => {
              const active = config.mode === 'api' && config.apiProtocol === protocol.id;
              return (
                <Button
                  key={protocol.id}
                  variant="subtle"
                  className={`inline-model-switcher__option${active ? ' is-active' : ''}`}
                  onClick={() => {
                    onModeChange('api');
                    onApiProtocolChange(protocol.id);
                  }}
                >
                  <Icon name="key" size={15} />
                  <span>{protocol.label}</span>
                  {active ? <Icon name="check" size={13} /> : null}
                </Button>
              );
            })}
          </div>

          <Button
            variant="subtle"
            className="inline-model-switcher__settings"
            onClick={() => {
              setOpen(false);
              onOpenSettings('execution');
            }}
          >
            <Icon name="settings" size={15} />
            <span>{t('settings.title')}</span>
          </Button>
          {!daemonLive && config.mode === 'daemon' ? (
            <p className="inline-model-switcher__error">{t('home.daemonRecovering')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

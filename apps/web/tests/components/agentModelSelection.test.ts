import { describe, expect, it } from 'vitest';
import {
  agentModelIsSelectable,
  defaultAgentModelId,
  effectiveAgentModelChoice,
  effectiveAgentModelId,
  normalizeAgentModelChoice,
} from '../../src/components/agentModelSelection';
import type { AgentInfo } from '../../src/types';

const amrAgent: AgentInfo = {
  id: 'amr',
  name: 'AMR',
  bin: 'amr',
  available: true,
  version: '1.0.0',
  models: [
    { id: 'glm-5', label: 'GLM 5' },
    { id: 'glm-5.1', label: 'GLM 5.1' },
  ],
};

const codexAgent: AgentInfo = {
  id: 'codex',
  name: 'Codex',
  bin: 'codex',
  available: true,
  version: '1.0.0',
  models: [{ id: 'default', label: 'Default' }],
};

describe('agent model selection', () => {

  // `agentModelIsSelectable` is the gate every model-list surface asks before
  // offering a row. It is deliberately the exact complement of
  // `normalizeAgentModelChoice`: offering a model normalization would coerce
  // away means the click is written and then reverted, which the user reads as
  // "the picker ignored me".
  describe('agentModelIsSelectable', () => {
    const planGatedAmr: AgentInfo = {
      ...amrAgent,
      models: [
        { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', enabled: true, default: true },
        { id: 'claude-opus-4.6', label: 'claude-opus-4.6', enabled: false },
      ],
    };

    it('refuses a model the caller\'s plan does not include', () => {
      expect(agentModelIsSelectable(planGatedAmr, 'claude-opus-4.6')).toBe(false);
      expect(
        normalizeAgentModelChoice(planGatedAmr, { model: 'claude-opus-4.6' }),
      ).not.toBeNull();
    });

    it('allows every on-plan model, plus the default sentinel', () => {
      expect(agentModelIsSelectable(planGatedAmr, 'deepseek-v4-flash')).toBe(true);
      expect(agentModelIsSelectable(planGatedAmr, 'default')).toBe(true);
    });

    it('refuses an empty model id', () => {
      expect(agentModelIsSelectable(planGatedAmr, '')).toBe(false);
      expect(agentModelIsSelectable(planGatedAmr, null)).toBe(false);
    });
  });
});

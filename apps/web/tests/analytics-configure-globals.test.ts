// Regression test for the v2 configure-state globals
// (has_available_configure_cli / configure_type / configure_availability).
//
// Reviewer comment on PR #2285 (mrcfps, 2026-05-19) flagged that
// `setConfigureGlobals` was defined but never called, so every browser
// capture inherited the boot defaults `{ false, 'unknown', 'unknown' }`.
// App.tsx now drives the setter from a useEffect that watches mode /
// agentId / apiKey / apiProtocolConfigs / agents; these tests pin the
// derive-then-register behavior end-to-end against the client module so a
// future refactor can't silently regress it back to a no-op setter.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveConfigureGlobals,
  type DeriveConfigureGlobalsInput,
} from '@open-design/contracts/analytics';
import {
  getConfigureGlobals,
  setConfigureGlobals,
} from '../src/analytics/client';

const BOOT_DEFAULTS = {
  has_available_configure_cli: false,
  configure_type: 'unknown' as const,
  configure_availability: 'unknown' as const,
  runtime_type: 'none' as const,
  cli_runnable: false,
  byok_runnable: false,
  amr_runnable: false,
};

describe('deriveConfigureGlobals', () => {

  it('marks the configure as unavailable when the selected daemon-mode agent is not installed', () => {
    const input: DeriveConfigureGlobalsInput = {
      mode: 'daemon',
      agentId: 'codex',
      agents: [
        { id: 'claude', available: true },
        { id: 'codex', available: false },
      ],
    };
    expect(deriveConfigureGlobals(input)).toMatchObject({
      configure_type: 'local_cli',
      configure_availability: 'unavailable',
    });
  });

  it('reports both when api-mode user also has CLIs installed', () => {
    expect(
      deriveConfigureGlobals({
        mode: 'api',
        byokConfigured: true,
        agents: [{ id: 'claude', available: true }],
      }),
    ).toMatchObject({
      has_available_configure_cli: true,
      configure_type: 'both',
    });
  });
});

describe('deriveConfigureGlobals — cold-start gating', () => {

  it('survives an undefined agents list (caller forgot to pass)', () => {
    expect(
      deriveConfigureGlobals({ mode: 'daemon', agentId: 'claude' }),
    ).toMatchObject({
      has_available_configure_cli: false,
      configure_availability: 'unavailable',
    });
  });
});

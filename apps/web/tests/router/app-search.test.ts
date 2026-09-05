import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseForceInline, validateAppSearch } from '../../src/app-search';
import {
  publishLocationToRouter,
  setActiveLocationNotifier,
} from '../../src/tanstack-bridge';

afterEach(() => setActiveLocationNotifier(null));

describe('app search validation', () => {
  it('normalizes supported shareable state and drops unrelated values', () => {
    expect(validateAppSearch({ forceInline: 'YES', survey: 'preview', ignored: 'value' })).toEqual({
      forceInline: true,
      survey: 'preview',
    });
    expect(validateAppSearch({ forceInline: 'false', survey: 'open' })).toEqual({});
  });

  it('keeps forceInline parsing compatible with raw URL search strings', () => {
    expect(parseForceInline('?forceInline=on')).toBe(true);
    expect(parseForceInline('?forceInline=0')).toBe(false);
  });
});

describe('TanStack location bridge', () => {
  it('publishes the full path and query string', () => {
    const notify = vi.fn();
    setActiveLocationNotifier(notify);

    publishLocationToRouter('/projects/example?forceInline=1');

    expect(notify).toHaveBeenCalledWith('/projects/example?forceInline=1');
  });
});

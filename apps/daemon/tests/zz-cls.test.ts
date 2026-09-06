import { describe, expect, it } from 'vitest';
import { classifyRunFailure } from '../src/run-failure-classification.js';
const classify = (error: string) => classifyRunFailure({
  result: 'failed',
  status: { status: 'failed', error, errorCode: 'AGENT_EXECUTION_FAILED' },
  errorCode: 'AGENT_EXECUTION_FAILED',
  agentId: 'kimi',
} as never) as any;
describe('probe', () => {
  it('shows balance classification', () => {
    const out = ['json-rpc id 2: insufficient balance', 'insufficient credits', '余额不足', 'Your balance is insufficient']
      .map((t) => `${t} -> ${classify(t).failure_category} / ${classify(t).failure_detail} / retryable=${classify(t).retryable}`);
    expect(out.join('\n')).toBe('SHOW');
  });
});

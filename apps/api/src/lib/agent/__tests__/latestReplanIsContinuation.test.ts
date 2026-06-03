import { describe, expect, it } from 'vitest';
import { latestReplanIsContinuation } from '../runPlanGlue.js';
import type { AgentStep } from '../types.js';

/**
 * S3：只在续跑(continuation)时给 planner 注入 checkpoint 框架；steer/merge 不注入。
 */
function replan(idx: number, reason: string): AgentStep {
  return {
    id: `s${idx}`, runId: 'r', idx, kind: 'replan', toolName: null, toolCallKey: null,
    input: null, output: { reason }, tokens: 0, durationMs: 0, error: null, byUserId: null,
    createdAt: new Date(),
  };
}

describe('latestReplanIsContinuation', () => {
  it('true when most recent replan is continuation', () => {
    expect(latestReplanIsContinuation([replan(1, 'merge_trigger'), replan(2, 'continuation')])).toBe(true);
  });
  it('false when most recent replan is steer/merge (even if an older continuation exists)', () => {
    expect(latestReplanIsContinuation([replan(1, 'continuation'), replan(2, 'steer')])).toBe(false);
  });
  it('false when there is no replan (fresh run)', () => {
    expect(latestReplanIsContinuation([])).toBe(false);
  });
});

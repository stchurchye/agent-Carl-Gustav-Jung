import { describe, expect, it } from 'vitest';
import { runCritique, isToolFailure } from '../critique.js';
import type { AgentStep, Plan, StepKind } from '../types.js';

const dummyPlan: Plan = {
  intentSummary: 'x',
  steps: [],
  todos: [],
  finalReplyHint: '',
  reasoning: null,
  version: 1,
};

function step(
  kind: StepKind,
  idx = 0,
  overrides: Partial<AgentStep> = {},
): AgentStep {
  return {
    id: 's' + idx,
    runId: 'r',
    idx,
    kind,
    toolName: null,
    toolCallKey: null,
    input: null,
    output: null,
    tokens: 0,
    durationMs: 0,
    error: null,
    byUserId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('runCritique stub', () => {
  it('returns shouldReplan=true on 2 consecutive failures', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: [step('tool_error', 1), step('tool_error', 2)],
      reason: 'consecutive_failures',
    });
    expect(r.shouldReplan).toBe(true);
  });

  it('no replan when not enough failures', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: [step('tool_call', 1), step('tool_error', 2)],
      reason: 'consecutive_failures',
    });
    expect(r.shouldReplan).toBe(false);
  });

  it('periodic critique never replans in stub', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: Array.from({ length: 6 }, (_, i) => step('tool_call', i)),
      reason: 'periodic',
    });
    expect(r.shouldReplan).toBe(false);
  });

  it('failures outside the last-4 window do not trigger', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: [
        step('tool_error', 1),
        step('tool_error', 2),
        step('tool_call', 3),
        step('tool_call', 4),
        step('tool_call', 5),
        step('tool_call', 6),
      ],
      reason: 'consecutive_failures',
    });
    expect(r.shouldReplan).toBe(false);
  });

  // ========== M1f Task 3 followup (blocker 1) ==========
  it('M1f #5 + blocker 1: 2 soft-fails (tool_call + error) also trigger replan', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: [
        step('tool_call', 1, { error: 'Tavily HTTP 429' }),
        step('tool_call', 2, { error: 'HTTP 503 for ...' }),
      ],
      reason: 'consecutive_failures',
    });
    expect(r.shouldReplan).toBe(true);
  });

  it('M1f #5 + blocker 1: mixed tool_error + tool_call-with-error count together', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: [
        step('tool_call', 1, { error: 'soft-fail (ok=false)' }),
        step('tool_error', 2, { error: 'hard fail' }),
      ],
      reason: 'consecutive_failures',
    });
    expect(r.shouldReplan).toBe(true);
  });

  it('M1f #5 + blocker 1: tool_call WITHOUT error 不算失败（happy path）', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: [
        step('tool_call', 1, { error: null }),
        step('tool_call', 2, { error: '' }),
      ],
      reason: 'consecutive_failures',
    });
    expect(r.shouldReplan).toBe(false);
  });
});

describe('M1f isToolFailure predicate (blocker 1)', () => {
  it('tool_error 永远算失败', () => {
    expect(isToolFailure(step('tool_error', 0, { error: 'x' }))).toBe(true);
    expect(isToolFailure(step('tool_error', 0, { error: null }))).toBe(true);
  });

  it('tool_call + 非空 error 算 soft-fail', () => {
    expect(isToolFailure(step('tool_call', 0, { error: 'oops' }))).toBe(true);
  });

  it('tool_call + null/empty error 不算失败', () => {
    expect(isToolFailure(step('tool_call', 0, { error: null }))).toBe(false);
    expect(isToolFailure(step('tool_call', 0, { error: '' }))).toBe(false);
  });

  it('其他 kind（observe / reply / plan）不算 tool 失败', () => {
    expect(isToolFailure(step('observe', 0, { error: 'x' }))).toBe(false);
    expect(isToolFailure(step('reply', 0, { error: 'x' }))).toBe(false);
    expect(isToolFailure(step('plan', 0, { error: 'x' }))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { runCritique } from '../critique.js';
import type { AgentStep, Plan, StepKind } from '../types.js';

const dummyPlan: Plan = {
  intentSummary: 'x',
  steps: [],
  todos: [],
  finalReplyHint: '',
  reasoning: null,
  version: 1,
};

function step(kind: StepKind, idx = 0): AgentStep {
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
});

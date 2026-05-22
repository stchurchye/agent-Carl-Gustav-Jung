import { describe, it, expect } from 'vitest';
import { buildRunSummary } from '../runSummary.js';
import type { AgentStep } from '../types.js';

function mkStep(partial: Partial<AgentStep>): AgentStep {
  return {
    id: partial.id ?? 'sid',
    runId: partial.runId ?? 'rid',
    idx: partial.idx ?? 0,
    kind: partial.kind ?? 'plan',
    toolName: partial.toolName ?? null,
    toolCallKey: partial.toolCallKey ?? null,
    input: partial.input ?? null,
    output: partial.output ?? null,
    tokens: partial.tokens ?? 0,
    durationMs: partial.durationMs ?? 0,
    error: partial.error ?? null,
    byUserId: partial.byUserId ?? null,
    createdAt: partial.createdAt ?? new Date(),
  };
}

describe('buildRunSummary', () => {
  it('empty steps → zeros', () => {
    const s = buildRunSummary([]);
    expect(s).toEqual({ stepCount: 0, toolCount: 0, toolBreakdown: {}, refCount: 0 });
  });

  it('filters out noise kinds (heartbeat / reclaim / system_error)', () => {
    const steps = [
      mkStep({ kind: 'plan' }),
      mkStep({ kind: 'heartbeat' }),
      mkStep({ kind: 'reclaim' }),
      mkStep({ kind: 'system_error' }),
      mkStep({ kind: 'reply' }),
    ];
    const s = buildRunSummary(steps);
    expect(s.stepCount).toBe(2); // plan + reply
  });

  it('counts tool_call → toolBreakdown + toolCount distinct', () => {
    const steps = [
      mkStep({ kind: 'tool_call', toolName: 'search_web' }),
      mkStep({ kind: 'tool_call', toolName: 'search_web' }),
      mkStep({ kind: 'tool_call', toolName: 'fetch_url' }),
      mkStep({ kind: 'tool_call', toolName: null }), // should not appear in toolBreakdown
    ];
    const s = buildRunSummary(steps);
    expect(s.toolBreakdown).toEqual({ search_web: 2, fetch_url: 1 });
    expect(s.toolCount).toBe(2);
  });

  it('accumulates refCount from output.result.citations', () => {
    const steps = [
      mkStep({
        kind: 'tool_call',
        toolName: 'search_papers',
        output: { result: { citations: [{ id: '1' }, { id: '2' }] } },
      }),
      mkStep({
        kind: 'tool_call',
        toolName: 'fetch_url',
        output: { result: { citations: [{ id: '3' }] } },
      }),
      mkStep({
        kind: 'tool_call',
        toolName: 'echo',
        output: { result: { foo: 'bar' } }, // no citations
      }),
    ];
    const s = buildRunSummary(steps);
    expect(s.refCount).toBe(3);
  });

  it('handles malformed output gracefully (string output / null)', () => {
    const steps = [
      mkStep({ kind: 'tool_call', toolName: 't1', output: 'just a string' }),
      mkStep({ kind: 'tool_call', toolName: 't2', output: null }),
      mkStep({ kind: 'tool_call', toolName: 't3', output: { result: 'still string' } }),
    ];
    const s = buildRunSummary(steps);
    expect(s.refCount).toBe(0);
    expect(s.toolBreakdown).toEqual({ t1: 1, t2: 1, t3: 1 });
  });
});

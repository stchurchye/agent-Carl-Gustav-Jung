import { describe, expect, it } from 'vitest';
import { agentHookBus, type AgentHookEvent } from '../hooks.js';
import type { AgentRun, AgentStep } from '../types.js';

const dummyRun = { id: 'r1', ownerId: 'u1', status: 'completed' } as unknown as AgentRun;
const dummyStep = { id: 's1', idx: 0, kind: 'tool_call' } as unknown as AgentStep;

describe('agentHookBus', () => {
  it('routes events to handlers and stops after unsubscribe', () => {
    const received: AgentHookEvent[] = [];
    const off = agentHookBus.onEvent((e) => received.push(e));

    agentHookBus.emitEvent({ type: 'run.completed', run: dummyRun });
    agentHookBus.emitEvent({ type: 'step.recorded', runId: 'r1', step: dummyStep });
    off();
    agentHookBus.emitEvent({ type: 'run.completed', run: { ...dummyRun, id: 'r2' } });

    expect(received.length).toBe(2);
    expect(received[0].type).toBe('run.completed');
    expect(received[1].type).toBe('step.recorded');
  });

  it('multiple subscribers see same events', () => {
    const a: AgentHookEvent[] = [];
    const b: AgentHookEvent[] = [];
    const offA = agentHookBus.onEvent((e) => a.push(e));
    const offB = agentHookBus.onEvent((e) => b.push(e));
    agentHookBus.emitEvent({ type: 'run.started', run: dummyRun });
    offA();
    offB();
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0]).toEqual(b[0]);
  });
});

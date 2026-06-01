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

describe('M7 hook events', () => {
  it('emits and receives run.status_changed', async () => {
    const received: AgentHookEvent[] = [];
    const off = agentHookBus.onEvent((e) => received.push(e));
    const fakeRun = { id: 'r1', status: 'replanning' } as unknown as AgentRun;
    agentHookBus.emitEvent({
      type: 'run.status_changed',
      run: fakeRun,
      from: 'running',
      to: 'replanning',
    });
    off();
    const evt = received.find((e) => e.type === 'run.status_changed');
    expect(evt).toBeDefined();
    if (evt && evt.type === 'run.status_changed') {
      expect(evt.from).toBe('running');
      expect(evt.to).toBe('replanning');
    }
  });

  it('emits run.dequeued / ask_user.opened_for_all / run.merged_input_appended', () => {
    const received: AgentHookEvent[] = [];
    const off = agentHookBus.onEvent((e) => received.push(e));
    const fakeRun = { id: 'r2' } as unknown as AgentRun;
    agentHookBus.emitEvent({ type: 'run.dequeued', run: fakeRun });
    agentHookBus.emitEvent({ type: 'ask_user.opened_for_all', runId: 'r2', run: fakeRun });
    agentHookBus.emitEvent({ type: 'run.merged_input_appended', runId: 'r2', mergedInputsCount: 3 });
    off();
    expect(received.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'run.dequeued',
        'ask_user.opened_for_all',
        'run.merged_input_appended',
      ]),
    );
  });
});

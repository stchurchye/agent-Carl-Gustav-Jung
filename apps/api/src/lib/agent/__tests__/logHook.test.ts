import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { agentHookBus } from '../hooks.js';
import { registerLogHook, unregisterLogHook } from '../logHook.js';
import type { AgentRun, AgentStep } from '../types.js';

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'r-' + randomUUID(),
    ownerId: 'u-test',
    channel: 'private',
    status: 'completed',
    inputText: 'test',
    plan: null,
    todos: [],
    pendingApprovalToolName: null,
    awaitingApprovalUntil: null,
    awaitingApprovalStepIdx: null,
    budget: { maxSteps: 10, maxSeconds: 60, maxTokens: 10000 },
    usage: { steps: 0, seconds: 0, tokens: 0 },
    ...overrides,
  } as unknown as AgentRun;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('waitFor timed out');
}

describeDb('logHook', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query(
      `DELETE FROM agent_event_logs WHERE event_type LIKE 'agent.%'`,
    );
    registerLogHook();
  });

  afterEach(() => {
    unregisterLogHook();
  });

  it('persists run.completed event', async () => {
    const run = makeRun({ id: 'r-completed', ownerId: 'u-test' });
    agentHookBus.emitEvent({ type: 'run.completed', run });

    const row = await waitFor(async () => {
      const { rows } = await getPool().query(
        `SELECT event_type, run_id, user_id, payload
           FROM agent_event_logs
          WHERE run_id = $1 AND event_type = 'agent.run.completed'
          LIMIT 1`,
        [run.id],
      );
      return rows[0];
    });
    expect(row.event_type).toBe('agent.run.completed');
    expect(row.run_id).toBe('r-completed');
    expect(row.user_id).toBe('u-test');
    expect(row.payload).toMatchObject({ status: 'completed' });
  });

  it('persists step.recorded event with step metadata', async () => {
    const runId = 'r-step-' + Date.now();
    const step = {
      id: 's1',
      runId,
      idx: 3,
      kind: 'tool_call',
      toolName: 'echo_after_sleep',
      input: {},
      output: null,
      error: null,
      byUserId: 'u-test',
      createdAt: new Date(),
    } as unknown as AgentStep;
    agentHookBus.emitEvent({ type: 'step.recorded', runId, step });

    const row = await waitFor(async () => {
      const { rows } = await getPool().query(
        `SELECT payload FROM agent_event_logs
          WHERE run_id = $1 AND event_type = 'agent.step.recorded' LIMIT 1`,
        [runId],
      );
      return rows[0];
    });
    expect(row.payload.step.idx).toBe(3);
    expect(row.payload.step.kind).toBe('tool_call');
    expect(row.payload.step.toolName).toBe('echo_after_sleep');
  });

  it('persists run.failed with error message', async () => {
    const run = makeRun({ id: 'r-failed', status: 'failed' });
    agentHookBus.emitEvent({ type: 'run.failed', run, error: 'boom' });

    const row = await waitFor(async () => {
      const { rows } = await getPool().query(
        `SELECT payload FROM agent_event_logs
          WHERE run_id = $1 AND event_type = 'agent.run.failed' LIMIT 1`,
        [run.id],
      );
      return rows[0];
    });
    expect(row.payload.error).toBe('boom');
  });

  // M7：run.status_changed 审计要保留 from/to 转换信息（不能只记当前 status）。
  it('persists run.status_changed with from/to transition', async () => {
    const run = makeRun({ id: 'r-status', status: 'replanning' });
    agentHookBus.emitEvent({
      type: 'run.status_changed',
      run,
      from: 'running',
      to: 'replanning',
    });

    const row = await waitFor(async () => {
      const { rows } = await getPool().query(
        `SELECT payload FROM agent_event_logs
          WHERE run_id = $1 AND event_type = 'agent.run.status_changed' LIMIT 1`,
        [run.id],
      );
      return rows[0];
    });
    expect(row.payload).toMatchObject({
      status: 'replanning',
      from: 'running',
      to: 'replanning',
    });
  });
});

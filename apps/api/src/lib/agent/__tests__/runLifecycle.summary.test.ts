import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { softComplete } from '../runLifecycle.js';
import { recordStep } from '../stepRecorder.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

async function ensureUser(): Promise<string> {
  const u = await createUser({
    username: 'm4-sum-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm4-sum-test',
  });
  return u.id;
}

describe('softComplete writes run summary', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('completed run → summary 落库 with tool_call breakdown', async () => {
    const ownerId = await ensureUser();
    const run = await store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'echo hi', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await recordStep({ runId: run.id, kind: 'plan', output: { intentSummary: 'x' } });
    await recordStep({
      runId: run.id, kind: 'tool_call', toolName: 'echo',
      output: { result: { text: 'hi' } },
    });
    await recordStep({
      runId: run.id, kind: 'tool_call', toolName: 'echo',
      output: { result: { text: 'hi2' } },
    });
    await recordStep({
      runId: run.id, kind: 'tool_call', toolName: 'search_web',
      output: { result: { citations: [{ id: 'a' }, { id: 'b' }] } },
    });
    await recordStep({ runId: run.id, kind: 'reply', output: { content: 'done' } });

    await softComplete(run, 'completed');
    const re = await store.getAgentRun(run.id);
    expect(re?.status).toBe('completed');
    expect(re?.summary).not.toBeNull();
    expect(re?.summary?.stepCount).toBe(5);
    expect(re?.summary?.toolCount).toBe(2);
    expect(re?.summary?.toolBreakdown).toEqual({ echo: 2, search_web: 1 });
    expect(re?.summary?.refCount).toBe(2);
  });

  it('failed run → summary still 落库 with whatever happened', async () => {
    const ownerId = await ensureUser();
    const run = await store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await recordStep({ runId: run.id, kind: 'plan', output: {} });
    await recordStep({ runId: run.id, kind: 'tool_error', toolName: 'broken', error: 'boom' });
    await softComplete(run, 'failed', 'tool broken');
    const re = await store.getAgentRun(run.id);
    expect(re?.status).toBe('failed');
    expect(re?.summary?.stepCount).toBe(2);
    expect(re?.summary?.toolCount).toBe(0); // tool_error not counted as tool_call
  });
});

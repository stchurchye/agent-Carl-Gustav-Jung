/**
 * M3 Task 3：resumeAgentRun lib 测试。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import * as store from '../store.js';
import { resumeAgentRun } from '../runLifecycle.js';
import { DEFAULT_BUDGET } from '../types.js';
import { ensureUser } from './_groupFixture.js';

async function makeRun(ownerId?: string) {
  const id = ownerId ?? (await ensureUser('resume-lib')).id;
  return store.insertAgentRun({
    ownerId: id,
    channel: 'private',
    sessionId: null,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'draft',
    inputText: 'test resume',
    budget: DEFAULT_BUDGET,
    apiKeyOwnerId: null,
    apiKeySource: 'server',
  });
}

describe('resumeAgentRun', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    await runMigrations();
  });
  beforeEach(async () => {
    if (!process.env.DATABASE_URL) return;
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('awaiting_user_input → resumes to running + appends observe step', async () => {
    if (!process.env.DATABASE_URL) return;

    const run = await makeRun();
    await store.updateAgentRun(run.id, {
      status: 'awaiting_user_input',
      pendingUserPrompt: '哪个年份？',
      pendingUserStepIdx: 2,
    });

    const { run: updated } = await resumeAgentRun({
      runId: run.id,
      userInput: '2024 年',
    });

    expect(updated.status).toBe('running');
    expect(updated.pendingUserPrompt).toBeNull();
    expect(updated.pendingUserStepIdx).toBeNull();

    const steps = await store.listSteps(run.id);
    expect(steps.length).toBeGreaterThanOrEqual(1);
    const observeStep = steps.find((s) => s.kind === 'observe');
    expect(observeStep).toBeDefined();
    expect((observeStep!.output as { userInput?: string })?.userInput).toBe('2024 年');
  });

  it('wrong status → throws', async () => {
    if (!process.env.DATABASE_URL) return;

    const run = await makeRun();
    // default status is 'draft'
    await expect(resumeAgentRun({ runId: run.id, userInput: '答案' })).rejects.toThrow(
      /not awaiting user input/,
    );
  });

  it('empty userInput → throws', async () => {
    if (!process.env.DATABASE_URL) return;

    const run = await makeRun();
    await store.updateAgentRun(run.id, {
      status: 'awaiting_user_input',
      pendingUserPrompt: '问题',
      pendingUserStepIdx: 0,
    });

    await expect(resumeAgentRun({ runId: run.id, userInput: '   ' })).rejects.toThrow(
      /userInput cannot be empty/,
    );
  });

  it('non-existent run → throws', async () => {
    if (!process.env.DATABASE_URL) return;

    await expect(
      resumeAgentRun({ runId: '00000000-0000-0000-0000-000000000000', userInput: 'hi' }),
    ).rejects.toThrow(/not found/);
  });
});

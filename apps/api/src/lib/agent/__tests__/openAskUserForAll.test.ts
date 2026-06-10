/**
 * M7 TB17：autoOpenAskUserForAll worker checker 单事务 update。
 *
 * 验证：
 *   - 30s 后命中 → agent_runs.ask_user_opened_for_all_at 非空
 *   - 同事务 update group_messages.payload.askUser.openedForAll → true
 *   - emit ask_user.opened_for_all hook
 */
import { it, expect, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { getPool } from '../../../db/client.js';
import { autoOpenAskUserForAll } from '../openAskUserForAll.js';
import { agentHookBus } from '../hooks.js';
import { writeAskUserPrompt } from '../messageBridge.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

describeDb('autoOpenAskUserForAll (M7 TB17)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;
  let runId: string;
  let msgId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-aoaa');
    const g = await ensureGroup(owner.id, 'aoaa-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    runId = randomUUID();
    await getPool().query(
      `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
         status, input_text, budget, api_key_source,
         pending_user_prompt, pending_user_step_idx, pending_user_input_expires_at,
         ask_user_target_user_id, ask_user_started_at)
       VALUES ($1, $2, 'group', $3, $4, 'generalist',
         'awaiting_user_input', 'q', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
         'server', 'q', 0, NOW() + INTERVAL '1 hour',
         $2, NOW() - INTERVAL '60 seconds')`,
      [runId, owner.id, groupId, topicId],
    );
    msgId = await writeAskUserPrompt({
      runId, groupId, topicId, target: owner.id, question: 'q',
    });
  });

  it('opens for all after 30s and updates group_messages payload', async () => {
    const events: unknown[] = [];
    const off = agentHookBus.onEvent((e) => events.push(e));
    const n = await autoOpenAskUserForAll(new Date());
    off();
    expect(n).toBeGreaterThanOrEqual(1);

    const { rows } = await getPool().query(
      `SELECT ask_user_opened_for_all_at FROM agent_runs WHERE id = $1`, [runId],
    );
    expect(rows[0].ask_user_opened_for_all_at).not.toBeNull();

    const { rows: m } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`, [msgId],
    );
    const p = m[0].payload as { askUser?: { openedForAll?: boolean } };
    expect(p.askUser?.openedForAll).toBe(true);

    const hook = events.find((e) => (e as { type: string }).type === 'ask_user.opened_for_all');
    expect(hook).toBeDefined();
  });

  it('skips runs within 30s window', async () => {
    await getPool().query(
      `UPDATE agent_runs SET ask_user_started_at = NOW() WHERE id = $1`, [runId],
    );
    await autoOpenAskUserForAll(new Date());
    const { rows } = await getPool().query(
      `SELECT ask_user_opened_for_all_at FROM agent_runs WHERE id = $1`, [runId],
    );
    expect(rows[0].ask_user_opened_for_all_at).toBeNull();
  });
});

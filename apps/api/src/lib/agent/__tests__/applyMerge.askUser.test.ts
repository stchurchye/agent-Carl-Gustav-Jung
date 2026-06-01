/**
 * M7 holistic review fix：merge 进一个 awaiting_user_input 的 run。
 *
 * applyMergeInTx 的 CASE 把 awaiting_user_input flip 到 replanning，
 * 必须同时清掉 pending_user_* / ask_user_* —— 否则 owner 去答那个被放弃的
 * 问题时 resumeAgentRun 会因 status!=='awaiting_user_input' 报错，且状态残留。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { applyMergeInTx } from '../store.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';

describe('applyMergeInTx into awaiting_user_input run (M7 review fix)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;
  let runId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-merge-au');
    const g = await ensureGroup(owner.id, 'm7-au-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    runId = randomUUID();
    await getPool().query(
      `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
         status, input_text, budget, api_key_source,
         pending_user_prompt, pending_user_step_idx, pending_user_input_expires_at,
         ask_user_target_user_id, ask_user_started_at)
       VALUES ($1, $2, 'group', $3, $4, 'generalist',
         'awaiting_user_input', 'main', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
         'server', '你想分析哪一年？', 2, NOW() + INTERVAL '1 hour',
         $2, NOW())`,
      [runId, owner.id, groupId, topicId],
    );
  });

  it('flips to replanning AND clears pending_user_* / ask_user_* state', async () => {
    await applyMergeInTx(runId, {
      text: '顺便也分析下报告',
      byUserId: owner.id,
      byUsername: '小张',
      at: new Date().toISOString(),
    });

    const { rows } = await getPool().query(
      `SELECT status, pending_user_prompt, pending_user_step_idx,
              pending_user_input_expires_at, ask_user_target_user_id,
              ask_user_started_at, ask_user_opened_for_all_at
         FROM agent_runs WHERE id = $1`,
      [runId],
    );
    const r = rows[0];
    expect(r.status).toBe('replanning');
    // 被放弃的 ask_user 状态全部清空，避免 resumeAgentRun 报错 + 残留卡片
    expect(r.pending_user_prompt).toBeNull();
    expect(r.pending_user_step_idx).toBeNull();
    expect(r.pending_user_input_expires_at).toBeNull();
    expect(r.ask_user_target_user_id).toBeNull();
    expect(r.ask_user_started_at).toBeNull();
    expect(r.ask_user_opened_for_all_at).toBeNull();
  });
});

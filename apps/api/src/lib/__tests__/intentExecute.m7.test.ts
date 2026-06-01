/**
 * M7 T3b：intentExecute 群聊 agent_run 三分支测试（TB1/2/3/4 集成版）。
 *
 * 覆盖：
 *   - 无 active → type='agent'（fresh）
 *   - 有 active 同 owner → type='agent', mergedIntoRunId 非空，仅 1 条新 group_messages
 *   - 两并发 fresh → 串行，只有 1 个 blocking run（R13）
 *   - 跨 owner 60s 后 → type='agent', queued=true, queuePosition=N
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPool } from '../../db/client.js';
import { executeIntent } from '../intentExecute.js';
import { ensureUser, ensureGroup } from '../agent/__tests__/_groupFixture.js';
import { randomUUID } from 'crypto';

async function insertActiveRun(opts: {
  ownerId: string;
  topicId: string;
  groupId: string;
  status?: string;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source, created_at, last_heartbeat_at)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       $5, 'existing', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server', $6, NULL)`,
    [
      id,
      opts.ownerId,
      opts.groupId,
      opts.topicId,
      opts.status ?? 'running',
      opts.createdAt ?? new Date(),
    ],
  );
  return id;
}

async function countGroupMessages(groupId: string, topicId: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS c FROM group_messages
     WHERE group_id = $1 AND topic_id = $2`,
    [groupId, topicId],
  );
  return Number(rows[0].c);
}

describe('intentExecute group agent_run M7', () => {
  let owner: { id: string };
  let other: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-int-o');
    other = await ensureUser('m7-int-x');
    const g = await ensureGroup(owner.id, 'm7-int-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    // 让 other 也是群成员
    await getPool().query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [groupId, other.id],
    );
  });

  it('TB-intent-fresh: no active → create fresh run', async () => {
    const r = await executeIntent({
      userId: owner.id,
      text: 'hello echo 1',
      kind: 'agent_run',
      channel: 'group',
      groupId, topicId,
      apiKey: '',
    });
    expect(r.type).toBe('agent');
    if (r.type === 'agent') {
      expect(r.runId).toBeTruthy();
      expect(r.mergedIntoRunId).toBeUndefined();
      expect(r.queued).toBeUndefined();
    }
  });

  it('TB-intent-merge: same owner active → merge (no new ai placeholder, 1 invoker msg)', async () => {
    const targetId = await insertActiveRun({ ownerId: owner.id, groupId, topicId });
    const before = await countGroupMessages(groupId, topicId);
    const r = await executeIntent({
      userId: owner.id,
      text: '追问 X',
      kind: 'agent_run',
      channel: 'group',
      groupId, topicId,
      apiKey: '',
    });
    expect(r.type).toBe('agent');
    if (r.type === 'agent') {
      expect(r.runId).toBe(targetId);
      expect(r.mergedIntoRunId).toBe(targetId);
    }
    const after = await countGroupMessages(groupId, topicId);
    expect(after - before).toBe(1); // 仅 1 条 invoker，无 ai placeholder

    // merged_inputs 已追加
    const { rows } = await getPool().query(
      `SELECT merged_inputs FROM agent_runs WHERE id = $1`,
      [targetId],
    );
    const merged = rows[0].merged_inputs as Array<{ text: string }>;
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('追问 X');
  });

  it('TB1-race: two parallel fresh requests → exactly one creates blocking run', async () => {
    // R13 / ADR-M7-14：两个并发请求必须串行 → 只有 1 个 create_fresh，另一个走 merge
    const [r1, r2] = await Promise.all([
      executeIntent({
        userId: owner.id,
        text: 'race A',
        kind: 'agent_run',
        channel: 'group',
        groupId, topicId,
        apiKey: '',
      }),
      executeIntent({
        userId: owner.id,
        text: 'race B',
        kind: 'agent_run',
        channel: 'group',
        groupId, topicId,
        apiKey: '',
      }),
    ]);
    expect(r1.type).toBe('agent');
    expect(r2.type).toBe('agent');
    // 唯一存活的 blocking run（status NOT IN terminal/queued）必须只有 1 个
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS c FROM agent_runs
       WHERE topic_id = $1
         AND status IN ('draft','planning','running','replanning','awaiting_approval','awaiting_user_input')`,
      [topicId],
    );
    expect(rows[0].c).toBe(1);
    // 其中一个必定 mergedIntoRunId 指向另一个的 runId
    if (r1.type === 'agent' && r2.type === 'agent') {
      const merged = r1.mergedIntoRunId ?? r2.mergedIntoRunId;
      const fresh = r1.mergedIntoRunId ? r2.runId : r1.runId;
      expect(merged).toBe(fresh);
    }
  });

  it('TB-intent-queue: cross owner after window → queued', async () => {
    await insertActiveRun({
      ownerId: owner.id, groupId, topicId,
      createdAt: new Date(Date.now() - 60_000),
    });
    const r = await executeIntent({
      userId: other.id,
      text: '我也来问',
      kind: 'agent_run',
      channel: 'group',
      groupId, topicId,
      apiKey: '',
    });
    expect(r.type).toBe('agent');
    if (r.type === 'agent') {
      expect(r.queued).toBe(true);
      expect(r.queuePosition).toBeGreaterThanOrEqual(1);
    }
    // 新 run status='queued'
    const { rows } = await getPool().query(
      `SELECT status FROM agent_runs WHERE id = $1`,
      [(r as { runId: string }).runId],
    );
    expect(rows[0].status).toBe('queued');
  });
});

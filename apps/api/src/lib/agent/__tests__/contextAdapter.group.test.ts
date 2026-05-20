import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { snapshotForAgent } from '../contextAdapter.js';
import { addGroupMessage } from '../../../store/pg-social.js';
import { ensureUser, ensureGroup, addMember } from './_groupFixture.js';
import * as topicSkillsStore from '../topicSkills.js';

/**
 * T7: snapshotForAgent 群聊路径
 * - 必须含 topic_skills 标签（enabled=true 时）
 * - disabled skill 不注入
 * - history 必须含成员 displayName 前缀
 */
describe('snapshotForAgent group (T7)', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    await getPool().query('DELETE FROM topic_skills');
  });

  it('topic_skills enabled => system prompt contains skill content', async () => {
    const u = await ensureUser('张三');
    const { groupId, topicId } = await ensureGroup(u.id);
    const snap = await snapshotForAgent({
      runId: randomUUID(),
      userId: u.id,
      channel: 'group',
      groupId,
      topicId,
      pendingUser: '帮我研究家族信托',
      apiKey: 'fake',
      topicSkills: [
        {
          id: 'sk1',
          scope: 'topic',
          ownerId: null,
          groupId,
          topicId,
          title: '聊家族财富',
          content: '不讨论投机,聚焦税务和传承',
          enabled: true,
        },
      ],
    });

    expect(snap.source.channel).toBe('group');
    expect(snap.systemPrompt).toContain('topic_skills');
    expect(snap.systemPrompt).toContain('聊家族财富');
    expect(snap.systemPrompt).toContain('不讨论投机');
  });

  it('topic_skills disabled => system prompt does NOT contain skill block', async () => {
    const u = await ensureUser('李四');
    const { groupId, topicId } = await ensureGroup(u.id);
    const snap = await snapshotForAgent({
      runId: randomUUID(),
      userId: u.id,
      channel: 'group',
      groupId,
      topicId,
      pendingUser: 'x',
      apiKey: 'fake',
      topicSkills: [
        {
          id: 'sk1',
          scope: 'topic',
          ownerId: null,
          groupId,
          topicId,
          title: 'X',
          content: 'Y',
          enabled: false,
        },
      ],
    });
    expect(snap.systemPrompt).not.toContain('topic_skills');
  });

  it('group history carries member displayName prefix (T7 must-have)', async () => {
    const alice = await ensureUser('Alice');
    const bob = await ensureUser('Bob');
    const { groupId, topicId } = await ensureGroup(alice.id);
    await addMember(groupId, bob.id);

    await addGroupMessage(alice.id, groupId, topicId, {
      kind: 'human',
      content: '我先说一句',
    });
    await addGroupMessage(bob.id, groupId, topicId, {
      kind: 'human',
      content: '我也插一嘴',
    });

    const snap = await snapshotForAgent({
      runId: randomUUID(),
      userId: alice.id,
      channel: 'group',
      groupId,
      topicId,
      pendingUser: '继续吗',
      apiKey: 'fake',
      topicSkills: [],
    });

    const hasAlicePrefix = snap.history.some((m) =>
      String(m.content).includes('[Alice]'),
    );
    const hasBobPrefix = snap.history.some((m) =>
      String(m.content).includes('[Bob]'),
    );
    expect(hasAlicePrefix).toBe(true);
    expect(hasBobPrefix).toBe(true);
  });

  it('falls back to DB topic_skills when no override is provided', async () => {
    const u = await ensureUser('db-skill');
    const { groupId, topicId } = await ensureGroup(u.id);
    await topicSkillsStore.upsertSkill({
      scope: 'topic',
      ownerId: u.id,
      groupId,
      topicId,
      title: 'DB 注入',
      content: '从数据库读取',
      enabled: true,
      updatedByUserId: u.id,
    });
    const snap = await snapshotForAgent({
      runId: randomUUID(),
      userId: u.id,
      channel: 'group',
      groupId,
      topicId,
      pendingUser: 'x',
      apiKey: 'fake',
    });
    expect(snap.systemPrompt).toContain('DB 注入');
    expect(snap.systemPrompt).toContain('从数据库读取');
  });
});

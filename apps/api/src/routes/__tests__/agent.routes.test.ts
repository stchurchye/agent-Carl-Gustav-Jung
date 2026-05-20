import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../db/migrate.js';
import { getPool } from '../../db/client.js';
import * as store from '../../lib/agent/store.js';
import { canAccessRun } from '../agent.js';
import {
  ensureUser,
  ensureGroup,
  addMember,
} from '../../lib/agent/__tests__/_groupFixture.js';
import { DEFAULT_BUDGET } from '../../lib/agent/types.js';

/**
 * T12: agent run 鉴权（路由层暴露的 canAccessRun helper）。
 * - 私聊：仅 owner true，其他 false
 * - 群聊：owner true、群成员 true、外人 false
 */
describe('canAccessRun (T12 routes auth)', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('private run: owner=true, stranger=false', async () => {
    const owner = await ensureUser('pv-owner');
    const stranger = await ensureUser('pv-stranger');
    const run = await store.insertAgentRun({
      ownerId: owner.id,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'draft',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeyOwnerId: null,
      apiKeySource: 'server',
    });
    expect(await canAccessRun(run, owner.id)).toBe(true);
    expect(await canAccessRun(run, stranger.id)).toBe(false);
  });

  it('group run: owner=true, member=true, non-member=false', async () => {
    const owner = await ensureUser('gp-owner');
    const member = await ensureUser('gp-member');
    const stranger = await ensureUser('gp-stranger');
    const { groupId, topicId } = await ensureGroup(owner.id);
    await addMember(groupId, member.id, 'member');

    const run = await store.insertAgentRun({
      ownerId: owner.id,
      channel: 'group',
      sessionId: null,
      groupId,
      topicId,
      intentTurnId: null,
      role: 'generalist',
      status: 'draft',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeyOwnerId: null,
      apiKeySource: 'server',
    });

    expect(await canAccessRun(run, owner.id)).toBe(true);
    expect(await canAccessRun(run, member.id)).toBe(true);
    expect(await canAccessRun(run, stranger.id)).toBe(false);
  });
});

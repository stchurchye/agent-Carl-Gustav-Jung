import { expect, beforeAll, beforeEach } from 'vitest';
import { describeDb, itDb } from '../../testUtils/dbGuard.js';
import { runMigrations } from '../../db/migrate.js';
import { getPool } from '../../db/client.js';
import { listGroupMessages } from '../pg-social.js';
import { ensureUser, ensureGroup } from '../../lib/agent/__tests__/_groupFixture.js';

/**
 * 群聊分页 after 游标的同毫秒 tiebreak 集成测试。
 *
 * 根因(K/U 战役前端 hotfix 暴露):created_at 由服务端 new Date().toISOString()
 * 生成(毫秒精度),同毫秒落库的多条消息 created_at 相等;旧游标只比 created_at(严格 >),
 * 会漏掉与锚点同毫秒、id 排在后面的消息。修复后游标用 (created_at, id) 复合全序。
 */
describeDb('listGroupMessages after-cursor same-millisecond tiebreak', () => {
  let groupId: string;
  let topicId: string;
  let authorId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM group_messages');
    const u = await ensureUser('cursor');
    authorId = u.id;
    const g = await ensureGroup(u.id);
    groupId = g.groupId;
    topicId = g.topicId;
  });

  /** 用显式 id + created_at 落库一条消息(绕过 addGroupMessage 的服务端 now())。 */
  async function insertMsg(id: string, createdAtIso: string, content = id) {
    await getPool().query(
      `INSERT INTO group_messages (id, group_id, topic_id, author_id, kind, payload, created_at)
       VALUES ($1, $2, $3, $4, 'human', $5::jsonb, $6)`,
      [id, groupId, topicId, authorId, JSON.stringify({ content }), createdAtIso],
    );
  }

  itDb('after 锚点同毫秒、id 更大的消息不被跳过', async () => {
    const T = '2026-06-11T00:00:00.000Z';
    await insertMsg('m-a', T);
    await insertMsg('m-b', T);
    await insertMsg('m-c', T);

    const page = await listGroupMessages(authorId, groupId, topicId, { after: 'm-a' });
    expect(page?.map((m) => m.id)).toEqual(['m-b', 'm-c']);
  });

  itDb('客户端式分页循环跨同毫秒簇:每条恰好一次、顺序正确(不漏不重)', async () => {
    const T1 = '2026-06-11T00:00:00.000Z';
    const T2 = '2026-06-11T00:00:00.001Z'; // 同毫秒簇:b,c,d,e
    const T3 = '2026-06-11T00:00:00.002Z';
    // 故意打乱落库顺序、且簇内最先落库的是 id 最大者(m-e),
    // 暴露无游标分支若不按 id tiebreak 排序则首页会切在簇中间 → 漏 b/c/d。
    await insertMsg('m-e', T2);
    await insertMsg('m-c', T2);
    await insertMsg('m-f', T3);
    await insertMsg('m-a', T1);
    await insertMsg('m-d', T2);
    await insertMsg('m-b', T2);

    // 复刻前端 GroupChatScreen:取「服务端返回列表最后一条 id」作为下次 after 游标,
    // limit=2 强制多页、必跨同毫秒簇边界。
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = await listGroupMessages(authorId, groupId, topicId, {
        after: cursor,
        limit: 2,
      });
      if (!page || page.length === 0) break;
      collected.push(...page.map((m) => m.id));
      cursor = page[page.length - 1].id;
    }

    expect(collected).toEqual(['m-a', 'm-b', 'm-c', 'm-d', 'm-e', 'm-f']);
    expect(new Set(collected).size).toBe(collected.length); // 无重复
  });
});

/**
 * Review 2026-06-11 [P1][api-routes-store] pg-social.ts:253
 * after=无效/已删除的消息 id 时,锚点子查询返回 NULL,元组比较整体为 NULL
 * → 静默返回空数组(客户端误以为没有新消息)。修后:锚点不存在 → 忽略游标,
 * 退化为从头列出(等价首次拉取,客户端按 id 去重)。
 */
describeDb('listGroupMessages after-cursor invalid anchor', () => {
  let groupId: string;
  let topicId: string;
  let authorId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM group_messages');
    const u = await ensureUser('cursor-invalid');
    authorId = u.id;
    const g = await ensureGroup(u.id);
    groupId = g.groupId;
    topicId = g.topicId;
  });

  async function insertMsg(id: string, createdAtIso: string, content = id) {
    await getPool().query(
      `INSERT INTO group_messages (id, group_id, topic_id, author_id, kind, payload, created_at)
       VALUES ($1, $2, $3, $4, 'human', $5::jsonb, $6)`,
      [id, groupId, topicId, authorId, JSON.stringify({ content }), createdAtIso],
    );
  }

  itDb('after 指向不存在的消息 → 忽略游标从头列出,而非静默空结果', async () => {
    await insertMsg('m-a', '2026-06-11T00:00:00.000Z');
    await insertMsg('m-b', '2026-06-11T00:00:00.001Z');

    const page = await listGroupMessages(authorId, groupId, topicId, {
      after: 'no-such-message-id',
    });
    expect(page?.map((m) => m.id)).toEqual(['m-a', 'm-b']);
  });

  itDb('after 指向已删除的消息 → 同样回退从头列出', async () => {
    await insertMsg('m-a', '2026-06-11T00:00:00.000Z');
    await insertMsg('m-b', '2026-06-11T00:00:00.001Z');
    await insertMsg('m-gone', '2026-06-11T00:00:00.002Z');
    await getPool().query(`DELETE FROM group_messages WHERE id = 'm-gone'`);

    const page = await listGroupMessages(authorId, groupId, topicId, { after: 'm-gone' });
    expect(page?.map((m) => m.id)).toEqual(['m-a', 'm-b']);
  });

  itDb('合法 after 行为不变', async () => {
    await insertMsg('m-a', '2026-06-11T00:00:00.000Z');
    await insertMsg('m-b', '2026-06-11T00:00:00.001Z');
    const page = await listGroupMessages(authorId, groupId, topicId, { after: 'm-a' });
    expect(page?.map((m) => m.id)).toEqual(['m-b']);
  });
});

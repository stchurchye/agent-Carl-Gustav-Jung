import type { GroupMessage } from '@xzz/shared';
import { buildGroupStage, messageBelongsToActor } from './groupStageAdapter';

const gm = (over: Partial<GroupMessage> & Record<string, unknown>): GroupMessage =>
  ({
    id: 'm1',
    groupId: 'g',
    topicId: 't',
    authorId: 'u1',
    authorDisplayName: '阿明',
    kind: 'human',
    content: 'hi',
    contentMode: 'text',
    createdAt: '2026-06-11T00:00:00Z',
    payload: {},
    ...over,
  }) as GroupMessage;

describe('buildGroupStage', () => {
  it('human 消息 → 人 actor;ai 消息 → 发起人的狗(invokerUserId 归属)', () => {
    const { actors, lines } = buildGroupStage(
      [
        gm({ id: 'a', kind: 'human', authorId: 'u1', authorDisplayName: '阿明' }),
        gm({
          id: 'b',
          kind: 'ai',
          authorId: 'ai',
          invokerUserId: 'u1',
          invokerAssistantName: '旺财',
          content: '汪',
        }),
      ],
      { selfUserId: 'u9' },
    );
    expect(lines[0].actorId).toBe('user:u1');
    expect(lines[1].actorId).toBe('dog:u1');
    const dog = actors.find((a) => a.id === 'dog:u1')!;
    expect(dog).toMatchObject({ kind: 'dog', name: '旺财', ownerActorId: 'user:u1' });
  });

  it('invoker 缺失(退群)→ dog:unknown + 兜底名', () => {
    const { lines, actors } = buildGroupStage(
      [gm({ id: 'b', kind: 'ai', invokerUserId: null, invokerAssistantName: null, content: 'x' })],
      { selfUserId: 'u9' },
    );
    expect(lines[0].actorId).toBe('dog:unknown');
    expect(actors.find((a) => a.id === 'dog:unknown')?.name).toBe('Bow wow');
  });

  it('system/link_card → kind:system 不建 actor', () => {
    const { lines, actors } = buildGroupStage(
      [gm({ id: 's', kind: 'system', content: '有人加入' })],
      { selfUserId: 'u9' },
    );
    expect(lines[0].kind).toBe('system');
    expect(actors).toEqual([]);
  });

  it('ai 消息带 agentRun 元数据 → kind:agent + runId', () => {
    const { lines } = buildGroupStage(
      [gm({ id: 'b', kind: 'ai', invokerUserId: 'u1', agentRun: { agentRunId: 'run-7' } })],
      { selfUserId: 'u9' },
    );
    expect(lines[0]).toMatchObject({ kind: 'agent', agentRunId: 'run-7' });
  });

  it('同一发起人重复出现只建一个狗 actor;人名缺失兜底「成员」', () => {
    const { actors } = buildGroupStage(
      [
        gm({ id: 'a', kind: 'human', authorId: 'u2', authorDisplayName: undefined }),
        gm({ id: 'b', kind: 'ai', invokerUserId: 'u2' }),
        gm({ id: 'c', kind: 'ai', invokerUserId: 'u2' }),
      ],
      { selfUserId: 'u9' },
    );
    expect(actors.filter((a) => a.id === 'dog:u2').length).toBe(1);
    expect(actors.find((a) => a.id === 'user:u2')?.name).toBe('成员');
  });
});

describe('messageBelongsToActor(只看 TA 过滤)', () => {
  it('人:只匹配该用户的 human 消息', () => {
    expect(messageBelongsToActor(gm({ kind: 'human', authorId: 'u1' }), 'user:u1')).toBe(true);
    expect(messageBelongsToActor(gm({ kind: 'human', authorId: 'u2' }), 'user:u1')).toBe(false);
    expect(messageBelongsToActor(gm({ kind: 'ai', invokerUserId: 'u1' }), 'user:u1')).toBe(false);
  });

  it('狗:只匹配该用户发起的 ai 消息;dog:unknown 收无主 ai', () => {
    expect(messageBelongsToActor(gm({ kind: 'ai', invokerUserId: 'u1' }), 'dog:u1')).toBe(true);
    expect(messageBelongsToActor(gm({ kind: 'ai', invokerUserId: 'u2' }), 'dog:u1')).toBe(false);
    expect(messageBelongsToActor(gm({ kind: 'ai', invokerUserId: null }), 'dog:unknown')).toBe(true);
    expect(messageBelongsToActor(gm({ kind: 'system' }), 'dog:u1')).toBe(false);
  });
});

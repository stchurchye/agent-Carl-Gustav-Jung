import type { GroupMessage } from '@xzz/shared';
import { ASSISTANT_FALLBACK_NAME } from '../../../lib/brand';
import type { StageActor, StageLine } from '../stageTypes';

/**
 * 历史浮层「只看 TA」过滤:消息是否属于某个舞台角色。
 * 人 = 该用户发的 human 消息;狗 = 该用户发起(invoker)的 ai 消息(dog:unknown 收无主 ai)。
 */
export function messageBelongsToActor(m: GroupMessage, actorId: string): boolean {
  if (actorId.startsWith('user:')) {
    return m.kind === 'human' && m.authorId === actorId.slice('user:'.length);
  }
  if (actorId === 'dog:unknown') return m.kind === 'ai' && !m.invokerUserId;
  if (actorId.startsWith('dog:')) {
    return m.kind === 'ai' && m.invokerUserId === actorId.slice('dog:'.length);
  }
  return false;
}

/** 群聊:人说话显示人,AI 说话显示发起人(invoker)的狗。system/link_card 走字幕条。 */
export function buildGroupStage(
  messages: GroupMessage[],
  _opts: { selfUserId: string },
): { actors: StageActor[]; lines: StageLine[] } {
  const actorsById = new Map<string, StageActor>();
  const lines: StageLine[] = [];

  const ensureActor = (a: StageActor): StageActor => {
    const hit = actorsById.get(a.id);
    if (hit) return hit;
    actorsById.set(a.id, a);
    return a;
  };

  for (const m of messages) {
    if (m.kind === 'system' || m.kind === 'link_card' || m.kind === 'magi_kb_reply') {
      lines.push({
        id: m.id,
        actorId: 'system',
        text: m.content,
        kind: 'system',
        createdAt: m.createdAt,
      });
      continue;
    }

    if (m.kind === 'ai') {
      const ownerId = m.invokerUserId ?? null;
      const dogId = ownerId ? `dog:${ownerId}` : 'dog:unknown';
      ensureActor({
        id: dogId,
        kind: 'dog',
        name: m.invokerAssistantName?.trim() || ASSISTANT_FALLBACK_NAME,
        seed: ownerId ?? 'assistant',
        ownerActorId: ownerId ? `user:${ownerId}` : undefined,
      });
      const agentRunId = (m as unknown as { agentRun?: { agentRunId?: string } }).agentRun
        ?.agentRunId;
      lines.push({
        id: m.id,
        actorId: dogId,
        text: m.content,
        kind: agentRunId ? 'agent' : 'chat',
        agentRunId,
        createdAt: m.createdAt,
      });
      continue;
    }

    // human
    const humanId = `user:${m.authorId}`;
    ensureActor({
      id: humanId,
      kind: 'human',
      name: m.authorDisplayName?.trim() || '成员',
      seed: m.authorId,
    });
    lines.push({
      id: m.id,
      actorId: humanId,
      text: m.content,
      kind: 'chat',
      createdAt: m.createdAt,
    });
  }

  return { actors: [...actorsById.values()], lines };
}

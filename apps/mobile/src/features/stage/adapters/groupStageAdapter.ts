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
  opts: { selfUserId: string; selfAssistantName?: string },
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
      const storedName = m.invokerAssistantName?.trim() || ASSISTANT_FALLBACK_NAME;
      const actorName =
        ownerId && ownerId === opts.selfUserId && opts.selfAssistantName
          ? opts.selfAssistantName
          : storedName;
      ensureActor({
        id: dogId,
        kind: 'dog',
        name: actorName,
        seed: ownerId ?? 'assistant',
        ownerActorId: ownerId ? `user:${ownerId}` : undefined,
      });
      const agentRunId = (m as unknown as { agentRun?: { agentRunId?: string } }).agentRun
        ?.agentRunId;
      // 本地 AI 占位(local-ai-*,内容为空)= 等回复中 → 'pending',让舞台出「思考中」而非空气泡。
      const isPending = m.id.startsWith('local-ai-') && !m.content?.trim();
      lines.push({
        id: m.id,
        actorId: dogId,
        text: m.content,
        kind: agentRunId ? 'agent' : isPending ? 'pending' : 'chat',
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

  // ensureActor 是首次写入即锁定的逻辑,所以在循环结束后统一把自己的狗名覆写成当前活体名。
  if (opts.selfAssistantName && opts.selfUserId) {
    const selfDogId = `dog:${opts.selfUserId}`;
    const selfDog = actorsById.get(selfDogId);
    if (selfDog) actorsById.set(selfDogId, { ...selfDog, name: opts.selfAssistantName });
  }

  return { actors: [...actorsById.values()], lines };
}

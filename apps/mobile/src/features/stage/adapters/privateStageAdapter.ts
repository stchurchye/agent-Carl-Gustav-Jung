import { getAgentRunIdFromMessage, type ChatUiMessage } from '../../../lib/uiMessage';
import type { StageActor, StageLine } from '../stageTypes';

export type PrivateStageOpts = {
  userId: string;
  userName: string;
  userAvatarUri?: string | null;
  assistantName: string;
};

function lineKind(m: ChatUiMessage, agentRunId: string | null): StageLine['kind'] {
  if (agentRunId) return 'agent';
  if (m.status === 'pending' || m.status === 'streaming') return 'pending';
  if (m.status === 'error') return 'error';
  return 'chat';
}

/** 私聊:1 人 + 1 狗。seed='assistant' 与 ChatAvatar 现状一致(配色不跳变)。 */
export function buildPrivateStage(
  messages: ChatUiMessage[],
  opts: PrivateStageOpts,
): { actors: StageActor[]; lines: StageLine[] } {
  const dogId = 'dog:self';
  const userId = `user:${opts.userId}`;
  const actors: StageActor[] = [
    { id: dogId, kind: 'dog', name: opts.assistantName, seed: 'assistant' },
    {
      id: userId,
      kind: 'human',
      name: opts.userName,
      seed: opts.userId,
      avatarUri: opts.userAvatarUri ?? null,
    },
  ];
  const lines: StageLine[] = messages.map((m) => {
    const agentRunId = getAgentRunIdFromMessage(m);
    return {
      id: m.id,
      actorId: m.role === 'user' ? userId : dogId,
      text: m.displayContent ?? m.content,
      kind: lineKind(m, agentRunId),
      status: m.status,
      agentRunId: agentRunId ?? undefined,
      retryText: m.retryText,
      createdAt: m.createdAt,
    };
  });
  return { actors, lines };
}

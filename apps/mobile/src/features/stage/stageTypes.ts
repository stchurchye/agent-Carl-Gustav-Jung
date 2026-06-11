import type { ChatUiMessage } from '../../lib/uiMessage';

/** 舞台上的一个角色:人(像素小人)或狗(像素狗) */
export type StageActor = {
  /** 'user:<userId>' | 'dog:self' | 'dog:<ownerUserId>' | 'dog:unknown' */
  id: string;
  kind: 'human' | 'dog';
  name: string;
  /** 喂 avatarPalette/presetForSeed 的稳定种子(与 ChatAvatar 同源,颜色一致) */
  seed: string;
  avatarUri?: string | null;
  /** 狗 → 主人 actorId,站位时贴着主人 */
  ownerActorId?: string;
};

export type StageLineKind = 'chat' | 'pending' | 'error' | 'agent' | 'system';

/** 归一后的一条台词(ChatUiMessage/GroupMessage 都映射到这) */
export type StageLine = {
  id: string;
  actorId: string;
  text: string;
  kind: StageLineKind;
  status?: ChatUiMessage['status'];
  /** kind='agent' 时由 AgentStageBubbleContent 接管文案 */
  agentRunId?: string;
  /** kind='error' 时气泡内「再试一次」要重发的文本 */
  retryText?: string;
  createdAt: string;
};

export type StageDialog = {
  current: StageLine | null;
  previous: StageLine | null;
};

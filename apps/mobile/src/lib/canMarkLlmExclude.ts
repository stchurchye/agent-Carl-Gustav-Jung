import type { ChatMessage, GroupMessage } from '@xzz/shared';
import type { ChatUiMessage } from './uiMessage';

export function canMarkGroupMessage(m: GroupMessage): boolean {
  return m.kind === 'human' || m.kind === 'ai';
}

export function canMarkChatMessage(m: ChatUiMessage | ChatMessage): boolean {
  const status = 'status' in m ? m.status : 'done';
  return status !== 'pending' && status !== 'error';
}

import type { ChatMessage, WritingUnderstandingScope } from '@xzz/shared';
import type { WritingAssistantMessage } from '@xzz/shared';

export type MessageUiStatus = 'pending' | 'streaming' | 'error' | 'done';

/**
 * 后端在 `private_chat_messages.payload` 写入的 agent run 元信息。
 * 字段名必须与 `apps/api/src/lib/agent/messageBridge.ts` 保持一致。
 */
export type AgentRunMessageMeta = {
  agentRunId: string;
  /** 'draft' | 'final' 等占位状态；UI 主要靠 agentRunId 渲染 card */
  status?: string;
  role?: 'invoker' | 'placeholder';
};

export type ChatUiMessage = ChatMessage & {
  status?: MessageUiStatus;
  /** 气泡里当前显示的文字（打字机进行中） */
  displayContent?: string;
  /** 失败后点「再试一次」时重发的用户内容 */
  retryText?: string;
  /** 后端 payload 直通的 agent 元信息（私聊 placeholder） */
  agentRun?: AgentRunMessageMeta;
};

export function getAgentRunIdFromMessage(m: ChatUiMessage): string | null {
  return m.agentRun?.agentRunId ?? null;
}

export type WritingUiMessage = WritingAssistantMessage & {
  status?: MessageUiStatus;
  displayContent?: string;
  retryText?: string;
  retryConfirm?: {
    messageId: string;
    approved: boolean;
    understandingScope?: WritingUnderstandingScope;
  };
};

export function chatBubbleText(m: ChatUiMessage): string {
  if (m.status === 'pending') return m.displayContent ?? '';
  return m.displayContent ?? m.content;
}

function isCompleteAssistantMessage(m: ChatUiMessage): boolean {
  return m.role === 'assistant' && m.status === 'done' && chatBubbleText(m).trim().length > 0;
}

/** 屏幕可见区域内，第一条已完成的助手回复下标；无可见项时回退到整表第一条 */
export function findFirstCompleteAssistantIndexOnScreen(
  messages: ChatUiMessage[],
  visibleIndices: number[],
): number {
  if (visibleIndices.length === 0) {
    return messages.findIndex(isCompleteAssistantMessage);
  }
  const sorted = [...visibleIndices].sort((a, b) => a - b);
  for (const i of sorted) {
    if (i >= 0 && i < messages.length && isCompleteAssistantMessage(messages[i])) {
      return i;
    }
  }
  return -1;
}

/** 从指定下标起，按顺序拼接后续所有已完成的助手回复 */
export function collectAssistantRepliesFromIndex(
  messages: ChatUiMessage[],
  startIndex: number,
): string {
  if (startIndex < 0) return '';

  const parts: string[] = [];
  for (let i = startIndex; i < messages.length; i++) {
    const m = messages[i];
    if (isCompleteAssistantMessage(m)) {
      parts.push(chatBubbleText(m).trim());
    }
  }
  return parts.join('\n\n');
}

/** 从屏幕内第一条已完成的助手回复起朗读至文末 */
export function collectAssistantRepliesFromScreen(
  messages: ChatUiMessage[],
  visibleIndices: number[],
): string {
  const startIdx = findFirstCompleteAssistantIndexOnScreen(messages, visibleIndices);
  return collectAssistantRepliesFromIndex(messages, startIdx);
}

export function writingBubbleText(m: WritingUiMessage): string {
  if (m.status === 'pending') return m.displayContent ?? '';
  return m.displayContent ?? m.content;
}

function isCompleteWritingAssistantMessage(m: WritingUiMessage): boolean {
  if (m.role !== 'assistant') return false;
  if (m.status === 'pending' || m.status === 'streaming' || m.status === 'error') {
    return false;
  }
  return writingBubbleText(m).trim().length > 0;
}

export function findFirstCompleteWritingAssistantIndexOnScreen(
  messages: WritingUiMessage[],
  visibleIndices: number[],
): number {
  if (visibleIndices.length === 0) {
    return messages.findIndex(isCompleteWritingAssistantMessage);
  }
  const sorted = [...visibleIndices].sort((a, b) => a - b);
  for (const i of sorted) {
    if (i >= 0 && i < messages.length && isCompleteWritingAssistantMessage(messages[i])) {
      return i;
    }
  }
  return -1;
}

export function collectWritingAssistantRepliesFromIndex(
  messages: WritingUiMessage[],
  startIndex: number,
): string {
  if (startIndex < 0) return '';

  const parts: string[] = [];
  for (let i = startIndex; i < messages.length; i++) {
    const m = messages[i];
    if (isCompleteWritingAssistantMessage(m)) {
      parts.push(writingBubbleText(m).trim());
    }
  }
  return parts.join('\n\n');
}

/** 从写作小助手列表屏幕内第一条已完成的助手回复起朗读至文末 */
export function collectWritingAssistantRepliesFromScreen(
  messages: WritingUiMessage[],
  visibleIndices: number[],
): string {
  const startIdx = findFirstCompleteWritingAssistantIndexOnScreen(messages, visibleIndices);
  return collectWritingAssistantRepliesFromIndex(messages, startIdx);
}

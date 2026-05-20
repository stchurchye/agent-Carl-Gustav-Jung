import type { ChatMessage, GroupMessage, IntentExecuteResult } from '@xzz/shared';
import type { ChatUiMessage } from './uiMessage';

export function isIntentExecuteResult(data: unknown): data is IntentExecuteResult {
  return typeof data === 'object' && data !== null && 'type' in data;
}

export type AgentIntentMeta = {
  runId: string;
  userMessageId: string | null;
  placeholderMessageId: string | null;
};

export type ChatIntentApplyCallbacks = {
  onChat: (user: ChatMessage, assistant: ChatMessage) => void | Promise<void>;
  onMemory: (user: ChatMessage, assistant: ChatMessage) => void;
  onTool: (user: ChatMessage, assistant: ChatMessage) => void;
  /**
   * M1b-3：私聊 agent run 占位消息已经写到 DB,
   * 这里需要前端刷新本会话消息列表（payload 中带 agentRun 元数据）。
   */
  onAgent?: (meta: AgentIntentMeta) => void | Promise<void>;
};

export async function applyPrivateIntentResult(
  data: IntentExecuteResult,
  callbacks: ChatIntentApplyCallbacks,
): Promise<boolean> {
  if (data.type === 'chat' && data.userMessage && data.assistantMessage) {
    await callbacks.onChat(data.userMessage, data.assistantMessage);
    return true;
  }
  if (data.type === 'memory' && data.userMessage && data.assistantMessage) {
    callbacks.onMemory(data.userMessage, data.assistantMessage);
    return true;
  }
  if (data.type === 'tool' && data.userMessage && data.assistantMessage) {
    callbacks.onTool(data.userMessage, data.assistantMessage);
    return true;
  }
  if (data.type === 'agent') {
    if (callbacks.onAgent) {
      await callbacks.onAgent({
        runId: data.runId,
        userMessageId: data.userMessageId,
        placeholderMessageId: data.placeholderMessageId,
      });
    }
    return true;
  }
  if (data.type === 'skipped') {
    return false;
  }
  return false;
}

export function mergeGroupMessages(
  prev: GroupMessage[],
  incoming: GroupMessage[] | undefined,
): GroupMessage[] {
  if (!incoming?.length) return prev;
  const ids = new Set(prev.map((m) => m.id));
  const added = incoming.filter((m) => !ids.has(m.id));
  return [...prev, ...added];
}

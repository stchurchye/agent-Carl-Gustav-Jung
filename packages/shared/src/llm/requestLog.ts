import { formatResponseTimeMs } from './invokeMeta.js';
import { formatTokenCount } from './contextBudget.js';

export type LlmRequestChannel =
  | 'workbench_chat'
  | 'group_chat'
  | 'writing_intent'
  | 'writing_execute'
  | 'intent_execute'
  | 'memory_extract'
  | 'intent_classify'
  | 'context_compact'
  | 'orchestrate'
  | 'btw'
  | 'other';

export const LLM_REQUEST_CHANNEL_LABELS: Record<LlmRequestChannel, string> = {
  workbench_chat: '工作台对话',
  group_chat: '群聊问 AI',
  writing_intent: '写作意图',
  writing_execute: '写作执行',
  intent_execute: '意图执行',
  memory_extract: '记忆提取',
  intent_classify: '意图分类',
  context_compact: '上下文压缩',
  orchestrate: '编排',
  btw: '顺便问',
  other: '其他',
};

export type LlmRequestMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** 传入 LLM 调用层，用于记录请求日志（不含 messages / 响应） */
export type LlmRequestLogContext = {
  userId: string;
  channel: LlmRequestChannel;
  requestId?: string;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  documentId?: string;
  contextRatio?: number;
};

export type LlmRequestUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens: number;
};

export type LlmRequestDisplayTurn = {
  role: 'system' | 'user' | 'assistant';
  label: string;
  preview: string;
  charCount: number;
  collapsed: boolean;
};

export type LlmRequestLogListItem = {
  id: string;
  createdAt: string;
  channel: LlmRequestChannel;
  channelLabel: string;
  provider: 'zenmux' | 'deepseek';
  model: string;
  status: 'ok' | 'error';
  responseTimeMs?: number;
  usage?: LlmRequestUsage;
  /** 列表副标题：模型 · token · 耗时 */
  metaLine: string;
  /** 列表预览一行 */
  listPreview: string;
  errorMessage?: string;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  documentId?: string;
  contextRatio?: number;
};

export type LlmRequestLogDetail = LlmRequestLogListItem & {
  messages: LlmRequestMessage[];
  responseText?: string;
  displayTurns: LlmRequestDisplayTurn[];
  responseDisplay?: string;
  /** 完整 JSON，便于复制与排查 */
  rawJson: string;
};

const PREVIEW_MAX = 280;
const SYSTEM_COLLAPSE_AT = 360;

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function roleLabel(role: LlmRequestMessage['role'], index: number, total: number): string {
  if (role === 'system') return '系统提示';
  if (role === 'assistant') return `助手 #${index}`;
  const userIdx = total - index;
  if (userIdx === 1) return '当前输入';
  return `用户 #${index}`;
}

export function buildLlmRequestDisplayTurns(messages: LlmRequestMessage[]): LlmRequestDisplayTurn[] {
  const userTurns = messages.filter((m) => m.role === 'user').length;
  let userSeen = 0;
  return messages.map((m, i) => {
    const charCount = m.content.length;
    const collapsed = m.role === 'system' && charCount > SYSTEM_COLLAPSE_AT;
    let label: string;
    if (m.role === 'user') {
      userSeen += 1;
      label = userSeen === userTurns ? '当前输入' : `用户 #${userSeen}`;
    } else {
      label = roleLabel(m.role, i + 1, messages.length);
    }
    const preview = collapsed
      ? truncate(m.content, 120)
      : truncate(m.content, PREVIEW_MAX);
    return { role: m.role, label, preview, charCount, collapsed };
  });
}

export function buildLlmRequestListPreview(
  messages: LlmRequestMessage[],
  responseText?: string,
): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (responseText?.trim()) {
    return truncate(responseText, 96);
  }
  if (lastUser?.content.trim()) {
    return truncate(lastUser.content, 96);
  }
  const sys = messages.find((m) => m.role === 'system');
  return sys ? truncate(sys.content, 96) : '（无内容）';
}

export function buildLlmRequestMetaLine(params: {
  model: string;
  usage?: LlmRequestUsage;
  responseTimeMs?: number;
  status: 'ok' | 'error';
}): string {
  const parts: string[] = [params.model];
  if (params.usage?.totalTokens) {
    parts.push(`${formatTokenCount(params.usage.totalTokens)} token`);
  }
  if (params.responseTimeMs != null && params.status === 'ok') {
    parts.push(formatResponseTimeMs(params.responseTimeMs));
  }
  if (params.status === 'error') parts.push('失败');
  return parts.join(' · ');
}

export function buildLlmRequestRawJson(entry: {
  channel: LlmRequestChannel;
  provider: string;
  model: string;
  messages: LlmRequestMessage[];
  responseText?: string;
  usage?: LlmRequestUsage;
  responseTimeMs?: number;
  status: string;
  errorMessage?: string;
  contextRatio?: number;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  documentId?: string;
  requestId?: string;
}): string {
  return JSON.stringify(entry, null, 2);
}

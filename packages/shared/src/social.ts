import type { LlmExcludeMeta } from './llm/llmExclude.js';
import type { LlmInvokeMeta, LlmReplyMeta } from './llm/invokeMeta.js';

export type GroupMessageKind = 'human' | 'ai' | 'system' | 'link_card' | 'magi_kb_reply';

export type ContentMode = 'text' | 'multimodal';

export interface ChatAttachment {
  id: string;
  kind: 'image';
  mimeType: string;
  storageKey: string;
  width?: number;
  height?: number;
}

export interface Topic {
  id: string;
  groupId: string;
  title: string;
  order: number;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

/** 工作室列表项（含最近一条消息摘要） */
export interface GroupListItem {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  createdAt: string;
  memberCount: number;
  lastMessage: {
    id: string;
    kind: GroupMessageKind;
    content: string;
    preview: string;
    authorDisplayName: string;
    createdAt: string;
  } | null;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  topicId: string | null;
  authorId: string;
  authorDisplayName?: string;
  kind: GroupMessageKind;
  content: string;
  attachments?: ChatAttachment[];
  contentMode: ContentMode;
  /** AI 消息：发起人 userId */
  invokerUserId?: string | null;
  invokerAssistantName?: string | null;
  jobId?: string | null;
  /** 本条为用户「问 AI」发起时记录模型与 token */
  llmInvoke?: LlmInvokeMeta | null;
  /** AI 回复：模型、token、响应时间 */
  llmReply?: LlmReplyMeta | null;
  /** 协作标记：不进入后续 LLM 上下文 */
  llmExclude?: LlmExcludeMeta | null;
  createdAt: string;
}

export type LlmJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface LlmInvokeJob {
  id: string;
  ownerId: string;
  groupId: string | null;
  topicId: string | null;
  sessionId: string | null;
  status: LlmJobStatus;
  invokerUserId: string;
  payload: Record<string, unknown>;
  resultMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MemoryScope = 'user' | 'group' | 'topic' | 'session';

export type MemoryFragmentStatus = 'active' | 'suppressed' | 'deleted' | 'pending';

/** 长期记忆分轨：关于用户 vs 项目/习惯（对齐 Hermes USER.md / MEMORY.md） */
export type MemoryCategory = 'user_profile' | 'project_note' | 'general';

export interface MemoryFragment {
  id: string;
  scope: MemoryScope;
  ownerId: string;
  groupId: string | null;
  topicId: string | null;
  sessionId: string | null;
  title: string;
  category: MemoryCategory;
  currentVersionId: string | null;
  status: MemoryFragmentStatus;
  /** Present when listing with joined version content */
  content?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryFragmentVersion {
  id: string;
  fragmentId: string;
  version: number;
  content: string;
  source: 'ai' | 'user' | 'import';
  createdBy: string;
  createdAt: string;
}

import type { AppNavigateTarget } from './intent/navigate.js';

export type { AppNavigateTarget };

export type IntentKind =
  | 'chat_private_llm'
  | 'chat_group_llm'
  | 'human_group_message'
  | 'context_compact'
  | 'memory_remember'
  | 'memory_correct'
  | 'memory_forget'
  | 'magi_system_query'
  | 'magi_content_link'
  | 'app_navigate'
  /** @deprecated 使用 app_navigate + navigateTarget personality */
  | 'persona_open_settings'
  | 'clarify';

export interface IntentCandidate {
  kind: IntentKind;
  label: string;
  confidence: number;
  description?: string;
  group?: 'primary' | 'other';
  missingSlots?: string[];
  slots?: MemoryIntentSlots;
}

export type MemoryIntentSlots = {
  scope?: MemoryScope;
  content?: string;
  targetFragmentId?: string;
  explicitGlobal?: boolean;
  category?: MemoryCategory;
  navigateTarget?: AppNavigateTarget;
};

export type UserMemorySettings = {
  autoExtractEnabled: boolean;
};

export type MemorySessionSearchHit = {
  messageId: string;
  sessionId?: string;
  topicId?: string;
  groupId?: string;
  role: string;
  contentPreview: string;
  createdAt: string;
  channel: 'private' | 'group';
};

/** 修正/遗忘时必须让用户点选的记忆条目 */
export interface MemoryTargetCandidate {
  fragmentId: string;
  title: string;
  contentPreview: string;
  label: string;
}

export type IntentAnalyzeHint = 'no_memory_to_edit' | 'extract_unavailable';

export interface IntentAnalyzeResult {
  candidates: IntentCandidate[];
  suggested: IntentKind;
  autoExecute: boolean;
  slots?: MemoryIntentSlots;
  /** memory_correct / memory_forget 时列出可选记忆，供芯片选择 */
  memoryTargets?: MemoryTargetCandidate[];
  /** 给 UI 的提示（如无记忆可改、未配置提炼 Key） */
  hint?: IntentAnalyzeHint;
}

export interface BtwExchange {
  id: string;
  userId: string;
  groupId: string | null;
  topicId: string | null;
  question: string;
  answer: string;
  createdAt: string;
}

import type { LlmInvokeMeta, LlmReplyMeta } from './llm/invokeMeta.js';
import type { LlmExcludeMeta } from './llm/llmExclude.js';

export type WritingMode = '自动' | '长文写作' | '文笔优化' | '识图识字';

export type RevisionSource = 'ai' | 'user' | 'ocr' | 'rollback';
export type RevisionStatus = 'pending' | 'accepted' | 'rejected';

export type WritingAction = '续写' | '润色' | '扩写' | '缩写' | '改语气';

export interface Block {
  id: string;
  content: string;
  currentRevisionId: string | null;
}

export interface Chapter {
  id: string;
  title: string;
  order: number;
  blocks: Block[];
  chapterSummary: string;
}

export interface Document {
  id: string;
  title: string;
  chapters: Chapter[];
  globalSummary: string;
  styleGuide: string;
  currentRevisionId: string | null;
  revisionCount: number;
  updatedAt: string;
  createdAt: string;
  /** 有值表示已从写作页隐藏，可在「我的」里复原 */
  hiddenAt?: string | null;
  writingContextSummary?: string | null;
  writingContextSummaryUpToMessageId?: string | null;
  documentContextSummary?: string | null;
  /**
   * M1e Task 13.2：sha256(agent 上次写入的 markdown)。当 docExport 工具再次写入同一
   * title 的文档时，先比对当前 block.content 的 hash 是否仍等于此值；若不等，说明
   * 用户已编辑过文档，不应覆盖 —— 改为创建 v2 文档。
   */
  agentLastExportHash?: string | null;
}

export interface Revision {
  id: string;
  documentId: string;
  blockId: string | null;
  parentRevisionId: string | null;
  snapshot: string;
  previousSnapshot: string | null;
  summary: string;
  source: RevisionSource;
  status: RevisionStatus;
  createdAt: string;
  timezone: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  contextSummary?: string | null;
  contextSummaryUpToMessageId?: string | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  /** 用户以「问 AI」模式发送时记录 */
  llmInvoke?: LlmInvokeMeta | null;
  /** 助手回复：模型、token、响应时间 */
  llmReply?: LlmReplyMeta | null;
  /** 协作标记：不进入后续 LLM 上下文 */
  llmExclude?: LlmExcludeMeta | null;
  createdAt: string;
}

/** 写作页右侧小助手对话（按文稿隔离） */
export type WritingAssistantMessageKind =
  | 'chat'
  | 'intent_confirm'
  | 'notice'
  | 'revision_ready';

export type WritingAssistantConfirmStatus = 'pending' | 'approved' | 'rejected';

export interface WritingAssistantMessage {
  id: string;
  documentId: string;
  role: 'user' | 'assistant';
  content: string;
  kind: WritingAssistantMessageKind;
  /** 待用户确认后执行的改稿动作 */
  pendingAction?: string;
  pendingInstruction?: string;
  confirmStatus?: WritingAssistantConfirmStatus;
  /** 对应待查看的改稿 revision */
  revisionId?: string;
  /** 协作标记：不进入后续 LLM 上下文 */
  llmExclude?: LlmExcludeMeta | null;
  createdAt: string;
}

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

export interface ApiErrorBody {
  ok: false;
  message: string;
  hint: string;
  code: string;
  requestId: string;
  retryable: boolean;
}

export interface ApiSuccessBody<T> {
  ok: true;
  data: T;
  requestId: string;
}

/** 用户发起「问 AI」时附在消息上的模型与用量 */
export interface LlmInvokeMeta {
  model: string;
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
}

/** AI 回复附带的模型、token 与耗时 */
export interface LlmReplyMeta {
  model: string;
  totalTokens: number;
  responseTimeMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

export function formatResponseTimeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

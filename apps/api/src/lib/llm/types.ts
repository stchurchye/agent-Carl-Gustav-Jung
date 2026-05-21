/**
 * Provider-neutral chat API used by agent runtime.
 *
 * 字段决策来自 plan §12.2.1 / spike 三结论：
 * 1. 不引入 responseFormat（靠 prompt 引导 JSON）
 * 2. modelId 透传 provider 原生 id，无 vendor 第三字段
 * 3. signal 必传（不是 optional）—— cancelRun 路径靠它中断 in-flight LLM 调用
 */

import type { LlmRequestLogContext } from '@xzz/shared';

export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmProviderId = 'deepseek' | 'zenmux';

/**
 * Provider 原生的 model 字符串。无 vendor 第三字段（spike 决策 #2）。
 * 举例：'deepseek-v4-pro' / 'anthropic/claude-sonnet-4.6' / 'moonshotai/kimi-k2.6'
 */
export type LlmModelId = string;

export type LlmChatOptions = {
  /** 不传则走 per-model default（Kimi=1、Claude/DeepSeek=0.3） */
  temperature?: number;
  /** 不传则走 per-model default（reasoning model 4096，普通 model 2048） */
  maxTokens?: number;
  log?: LlmRequestLogContext;
  /** spike 决策 #3：必传不可省。cancelRun 路径靠它中断 in-flight 调用 */
  signal: AbortSignal;
};

export type LlmChatUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LlmChatResult = {
  content: string;
  usage: LlmChatUsage;
  providerId: LlmProviderId;
  modelId: LlmModelId;
};

export type LlmChatClient = {
  providerId: LlmProviderId;
  modelId: LlmModelId;
  chat(messages: LlmChatMessage[], opts: LlmChatOptions): Promise<LlmChatResult>;
};

/**
 * 归一化的 provider 错误。caller 据 kind 决定 retry / fallback 策略。
 * - auth: 401/403，rotate key 也救不了
 * - rate_limit: 429，可短退避后重试
 * - timeout: 客户端 abort 或 server 504
 * - bad_request: 4xx 非 auth/rate
 * - empty_content: 200 但 choices/content 为空（spike 陷阱 #2：Kimi 偶发）
 * - unknown: 兜底
 */
export type LlmProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'bad_request'
  | 'empty_content'
  | 'unknown';

export class LlmProviderError extends Error {
  constructor(
    public readonly providerId: LlmProviderId,
    public readonly modelId: LlmModelId,
    public readonly kind: LlmProviderErrorKind,
    message: string,
    public readonly cause?: unknown,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

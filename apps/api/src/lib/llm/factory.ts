/**
 * LLM client factory + per-provider / per-model defaults.
 *
 * 参考 plan §12.2.2 + spike 三陷阱：
 * - Kimi K2.6 强制 temperature=1（陷阱 #3）
 * - DeepSeek v4-pro / reasoner 是 reasoning model，maxTokens 默认值要大（陷阱 #1）
 */

import type { LlmChatClient, LlmModelId, LlmProviderId } from './types.js';
import { DeepSeekLlmClient } from './providers/deepseek.js';
import { ZenMuxLlmClient } from './providers/zenmux.js';

export type LlmClientSpec = {
  providerId: LlmProviderId;
  modelId: LlmModelId;
  apiKey: string;
};

export function buildLlmClient(spec: LlmClientSpec): LlmChatClient {
  switch (spec.providerId) {
    case 'deepseek':
      return new DeepSeekLlmClient(spec.apiKey, spec.modelId);
    case 'zenmux':
      return new ZenMuxLlmClient(spec.apiKey, spec.modelId);
    default: {
      const _exhaustive: never = spec.providerId;
      throw new Error(`unsupported llm provider: ${String(_exhaustive)}`);
    }
  }
}

export const DEFAULT_PROVIDER_ID: LlmProviderId =
  (process.env.LLM_DEFAULT_PROVIDER as LlmProviderId | undefined) ?? 'deepseek';

export type ModelProfile = {
  modelId: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
};

export const DEFAULT_MODEL_FOR_PROVIDER: Record<LlmProviderId, ModelProfile> = {
  deepseek: {
    modelId: process.env.DEEPSEEK_MODEL_PRO ?? 'deepseek-v4-pro',
    defaultTemperature: 0.3,
    // reasoning model 的 reasoning_tokens 计入 max_tokens（spike 陷阱 #1）
    defaultMaxTokens: 4096,
  },
  zenmux: {
    modelId: process.env.ZENMUX_DEFAULT_MODEL ?? 'anthropic/claude-sonnet-4.6',
    defaultTemperature: 0.3,
    defaultMaxTokens: 2048,
  },
};

/**
 * per-modelId override。处理 spike 陷阱 #3 等硬约束（server 强制某 temperature 等）。
 */
export const MODEL_OVERRIDES: Record<string, Partial<ModelProfile>> = {
  // Kimi K2.6 server 强制 temperature=1，传 0/0.3 会被拒
  'moonshotai/kimi-k2.6': { defaultTemperature: 1 },
  // reasoning models 需更大预算
  'deepseek-v4-pro': { defaultMaxTokens: 4096 },
  'deepseek-reasoner': { defaultMaxTokens: 8192 },
};

export function resolveModelProfile(
  providerId: LlmProviderId,
  modelId: string,
): ModelProfile {
  const base = DEFAULT_MODEL_FOR_PROVIDER[providerId];
  const override = MODEL_OVERRIDES[modelId] ?? {};
  return { ...base, modelId, ...override };
}

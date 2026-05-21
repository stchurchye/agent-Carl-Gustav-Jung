/**
 * Agent runtime 可选模型清单。
 * mobile "Agent 默认模型"设置 + AgentRunCard 顶部模型铭牌都读这里。
 *
 * 比 ZENMUX_CHAT_MODELS 更窄 —— 只暴露已经在 agent 后端 spike 通过的 model id，
 * 减少 user 选个不能用的模型撞墙的可能性。新增模型记得在 backend 跑一遍
 * `apps/api/src/scripts/llmSpike.ts` 验证。
 */

export type AgentLlmProviderId = 'deepseek' | 'zenmux';

export type AgentLlmModelOption = {
  providerId: AgentLlmProviderId;
  /** Provider 原生 model id（写到 agent_runs.model_id） */
  modelId: string;
  /** UI 展示用短名 */
  label: string;
  /** 备注 / 提示（"reasoning model, slower"、"forces temperature=1" 等） */
  hint?: string;
};

export const AGENT_LLM_MODEL_OPTIONS: AgentLlmModelOption[] = [
  // 默认放第一位
  {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    hint: 'reasoning model · 默认',
  },
  {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    hint: '便宜快速',
  },
  {
    providerId: 'zenmux',
    modelId: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    hint: 'via ZenMux',
  },
  {
    providerId: 'zenmux',
    modelId: 'anthropic/claude-opus-4.7',
    label: 'Claude Opus 4.7',
    hint: 'via ZenMux · 最强',
  },
  {
    providerId: 'zenmux',
    modelId: 'openai/gpt-5.5',
    label: 'GPT-5.5',
    hint: 'via ZenMux',
  },
  {
    providerId: 'zenmux',
    modelId: 'moonshotai/kimi-k2.6',
    label: 'Kimi K2.6',
    hint: 'via ZenMux · 国产',
  },
];

export const AGENT_LLM_DEFAULT_PROVIDER: AgentLlmProviderId =
  AGENT_LLM_MODEL_OPTIONS[0].providerId;
export const AGENT_LLM_DEFAULT_MODEL: string =
  AGENT_LLM_MODEL_OPTIONS[0].modelId;

export function findAgentLlmOption(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): AgentLlmModelOption | undefined {
  if (!providerId || !modelId) return undefined;
  return AGENT_LLM_MODEL_OPTIONS.find(
    (o) => o.providerId === providerId && o.modelId === modelId,
  );
}

/** 用于 AgentRunCard 顶部铭牌等场景：给一个简短可读的 "provider · model" 字符串 */
export function agentLlmDisplayName(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): string {
  const opt = findAgentLlmOption(providerId, modelId);
  if (opt) return opt.label;
  if (providerId && modelId) return `${providerId} · ${modelId}`;
  return 'DeepSeek V4 Pro';
}

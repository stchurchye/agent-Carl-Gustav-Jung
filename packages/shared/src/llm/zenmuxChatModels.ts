/** App 请求头：群聊 / 工作台对话选用的 ZenMux 模型 */
export const CHAT_LLM_MODEL_HEADER = 'X-Chat-Llm-Model';

export type ZenmuxChatProvider = 'openai' | 'anthropic' | 'google';

/** 工作台 / 群聊模型分组 */
export type ZenmuxChatModelGroup = 'claude' | 'gpt' | 'domestic';

export type ZenmuxChatModel = {
  id: string;
  label: string;
  provider: ZenmuxChatProvider;
  group: ZenmuxChatModelGroup;
};

export type ZenmuxChatModelGroupDef = {
  id: ZenmuxChatModelGroup;
  title: string;
  models: ZenmuxChatModel[];
};

/** @see https://zenmux.ai/docs/guide/advanced/provider-routing.html */
export const ZENMUX_OPENAI_BASE_URL = 'https://zenmux.ai/api/v1';
export const ZENMUX_ANTHROPIC_BASE_URL = 'https://zenmux.ai/api/anthropic';
export const ZENMUX_VERTEX_BASE_URL = 'https://zenmux.ai/api/vertex-ai';

/** 群聊 / 工作台可选模型（均经 ZenMux），按分组展示 */
export const ZENMUX_CHAT_MODEL_GROUPS: ZenmuxChatModelGroupDef[] = [
  {
    id: 'claude',
    title: 'Claude',
    models: [
      {
        id: 'anthropic/claude-sonnet-4.6',
        label: 'Sonnet 4.6',
        provider: 'anthropic',
        group: 'claude',
      },
      {
        id: 'anthropic/claude-opus-4.6',
        label: 'Opus 4.6',
        provider: 'anthropic',
        group: 'claude',
      },
      {
        id: 'anthropic/claude-opus-4.7',
        label: 'Opus 4.7',
        provider: 'anthropic',
        group: 'claude',
      },
    ],
  },
  {
    id: 'gpt',
    title: 'GPT',
    models: [
      {
        id: 'openai/gpt-5.5',
        label: 'GPT-5.5',
        provider: 'openai',
        group: 'gpt',
      },
    ],
  },
  {
    id: 'domestic',
    title: '国产',
    models: [
      {
        id: 'moonshotai/kimi-k2.6',
        label: 'Kimi K2.6',
        provider: 'openai',
        group: 'domestic',
      },
      {
        id: 'qwen/qwen3-235b-a22b-thinking-2507',
        label: 'Qwen3 235B Thinking',
        provider: 'openai',
        group: 'domestic',
      },
      {
        id: 'deepseek/deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        provider: 'openai',
        group: 'domestic',
      },
      {
        id: 'deepseek/deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        provider: 'openai',
        group: 'domestic',
      },
    ],
  },
];

/** 扁平列表（校验、存储兼容） */
export const ZENMUX_CHAT_MODELS: ZenmuxChatModel[] = ZENMUX_CHAT_MODEL_GROUPS.flatMap(
  (g) => g.models,
);

export const ZENMUX_CHAT_DEFAULT_MODEL = 'moonshotai/kimi-k2.6';

/** 上下文压缩用轻量模型 */
export const ZENMUX_CHAT_COMPACT_MODEL = 'deepseek/deepseek-v4-flash';

export function isValidZenmuxChatModel(modelId: string): boolean {
  return ZENMUX_CHAT_MODELS.some((m) => m.id === modelId);
}

export function resolveZenmuxChatModel(modelId?: string | null): string {
  const id = modelId?.trim();
  if (id && isValidZenmuxChatModel(id)) return id;
  return ZENMUX_CHAT_DEFAULT_MODEL;
}

export function zenmuxChatModelMeta(modelId: string): ZenmuxChatModel {
  return (
    ZENMUX_CHAT_MODELS.find((m) => m.id === modelId) ?? {
      id: modelId,
      label: modelId.split('/').pop() ?? modelId,
      provider: 'openai',
      group: 'domestic',
    }
  );
}

/** 顶部按钮等：一行简称 */
export function zenmuxChatModelLabel(modelId: string): string {
  const m = zenmuxChatModelMeta(modelId);
  if (m.group === 'claude') return `Claude ${m.label}`;
  return m.label;
}

export function zenmuxBaseUrlForProvider(provider: ZenmuxChatProvider): string {
  if (provider === 'anthropic') return ZENMUX_ANTHROPIC_BASE_URL;
  if (provider === 'google') return ZENMUX_VERTEX_BASE_URL;
  return ZENMUX_OPENAI_BASE_URL;
}

export function zenmuxBaseUrlForModel(modelId: string): string {
  return zenmuxBaseUrlForProvider(zenmuxChatModelMeta(modelId).provider);
}

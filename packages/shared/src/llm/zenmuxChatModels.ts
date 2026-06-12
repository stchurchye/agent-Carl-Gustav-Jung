/** App 请求头：群聊 / 工作台对话选用的 ZenMux 模型 */
export const CHAT_LLM_MODEL_HEADER = 'X-Chat-Llm-Model';

export type ZenmuxChatProvider = 'openai' | 'anthropic' | 'google';

/** 工作台 / 群聊模型分组 */
export type ZenmuxChatModelGroup = 'claude' | 'gpt' | 'domestic';

export type ZenmuxChatModel = {
  id: string;
  label: string;
  /** header chip 缩写，≤7 字符 */
  short?: string;
  provider: ZenmuxChatProvider;
  group: ZenmuxChatModelGroup;
  /**
   * 该模型 server 端强制的固定温度(传别的值会 400 拒绝)。
   * 例:Kimi K2.6 强制 temperature=1（spike 陷阱 #3）。标了就覆盖调用方温度。
   * 未标注但确实有此约束的模型,由 zenmuxChatFromMessages 的错误重试兜底。
   */
  fixedTemperature?: number;
};

export type ZenmuxModelCompanyId = 'anthropic' | 'openai' | 'kimi' | 'deepseek' | 'qwen';

export type ZenmuxModelCompany = {
  id: ZenmuxModelCompanyId;
  /** 像素图标首字母 */
  initial: string;
  /** 像素图标背景色 */
  color: string;
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
        short: 'Sonnet',
        provider: 'anthropic',
        group: 'claude',
      },
      {
        id: 'anthropic/claude-opus-4.6',
        label: 'Opus 4.6',
        short: 'Opus4.6',
        provider: 'anthropic',
        group: 'claude',
      },
      {
        id: 'anthropic/claude-opus-4.7',
        label: 'Opus 4.7',
        short: 'Opus4.7',
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
        short: 'GPT-5',
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
        short: 'Kimi',
        provider: 'openai',
        group: 'domestic',
        fixedTemperature: 1, // server 强制 temperature=1,传 0/0.7 会 400 拒
      },
      {
        id: 'qwen/qwen3-235b-a22b-thinking-2507',
        label: 'Qwen3 235B Thinking',
        short: 'Qwen3',
        provider: 'openai',
        group: 'domestic',
      },
      {
        id: 'deepseek/deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        short: 'DS Pro',
        provider: 'openai',
        group: 'domestic',
      },
      {
        id: 'deepseek/deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        short: 'DS',
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

/** header chip 缩写，fallback 到 label 截断 */
export function zenmuxChatModelShort(modelId: string): string {
  const m = zenmuxChatModelMeta(modelId);
  return m.short ?? m.label.slice(0, 6);
}

const COMPANY_LOOKUP: Record<string, ZenmuxModelCompany> = {
  anthropic: { id: 'anthropic', initial: 'A', color: '#CF5C36' },
  openai: { id: 'openai', initial: 'G', color: '#10A37F' },
  moonshotai: { id: 'kimi', initial: 'K', color: '#5662F6' },
  deepseek: { id: 'deepseek', initial: 'D', color: '#1B65E4' },
  qwen: { id: 'qwen', initial: 'Q', color: '#FF6A14' },
};

const FALLBACK_COMPANY: ZenmuxModelCompany = { id: 'openai', initial: '?', color: '#888888' };

/** 从 modelId 前缀提取公司信息（像素图标用） */
export function zenmuxModelCompany(modelId: string): ZenmuxModelCompany {
  const prefix = modelId.split('/')[0] ?? '';
  return COMPANY_LOOKUP[prefix] ?? FALLBACK_COMPANY;
}

export function zenmuxBaseUrlForProvider(provider: ZenmuxChatProvider): string {
  if (provider === 'anthropic') return ZENMUX_ANTHROPIC_BASE_URL;
  if (provider === 'google') return ZENMUX_VERTEX_BASE_URL;
  return ZENMUX_OPENAI_BASE_URL;
}

export function zenmuxBaseUrlForModel(modelId: string): string {
  return zenmuxBaseUrlForProvider(zenmuxChatModelMeta(modelId).provider);
}

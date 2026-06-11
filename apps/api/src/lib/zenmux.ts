import {
  ZENMUX_BASE_URL,
  ZENMUX_MODEL_FLASH_LITE,
  zenmuxBaseUrlForModel,
  zenmuxChatModelMeta,
  type LlmRequestLogContext,
} from '@xzz/shared';
import { recordLlmRequest } from './llmRequestLog.js';

export type ZenmuxChatMessageInput = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ZenmuxChatUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ZenmuxChatResult = {
  content: string;
  usage: ZenmuxChatUsage;
};

export class ZenMuxError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ZenMuxError';
  }
}

type ZenMuxTextPart = { type: 'text'; text: string };
type ZenMuxImagePart = { type: 'image_url'; image_url: { url: string } };
type ZenMuxAudioPart = {
  type: 'input_audio';
  input_audio: { data: string; format: string };
};
type ZenMuxContentPart = ZenMuxTextPart | ZenMuxImagePart | ZenMuxAudioPart;

type ZenMuxMessage = {
  role: 'user' | 'system';
  content: string | ZenMuxContentPart[];
};

async function zenmuxChat(
  apiKey: string,
  messages: ZenMuxMessage[],
  options?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${ZENMUX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: ZENMUX_MODEL_FLASH_LITE,
        messages,
        stream: false,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.2,
      }),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ECONNREFUSED|ETIMEDOUT|TLS|socket/i.test(detail)) {
      throw new ZenMuxError(
        '无法连接 ZenMux（zenmux.ai）。若 API 在 Docker 里跑，请改用本机：npm run dev:api:host',
      );
    }
    throw new ZenMuxError(detail || 'ZenMux 网络请求失败');
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    const msg = json.error?.message ?? `ZenMux 请求失败（${res.status}）`;
    throw new ZenMuxError(msg, res.status);
  }

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new ZenMuxError('ZenMux 没有返回内容');
  return content;
}

export function getZenMuxKeyFromRequest(headerKey?: string | null): string {
  const fromHeader = headerKey?.trim();
  if (fromHeader) return fromHeader;
  const fromEnv = process.env.ZENMUX_API_KEY?.trim();
  if (!fromEnv) throw new ZenMuxError('ZENMUX_KEY_MISSING');
  return fromEnv;
}

export function hasZenMuxKeyConfigured(headerKey?: string | null): boolean {
  return Boolean(headerKey?.trim() || process.env.ZENMUX_API_KEY?.trim());
}

function wrapZenmuxNetworkError(e: unknown): never {
  const detail = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|TLS|socket/i.test(detail)) {
    throw new ZenMuxError(
      '无法连接 ZenMux（zenmux.ai）。若 API 在 Docker 里跑，请改用本机：npm run dev:api:host',
    );
  }
  throw new ZenMuxError(detail || 'ZenMux 网络请求失败');
}

async function zenmuxOpenAiChat(
  apiKey: string,
  model: string,
  messages: ZenmuxChatMessageInput[],
  options?: { maxTokens?: number; temperature?: number },
): Promise<ZenmuxChatResult> {
  let res: Response;
  try {
    res = await fetch(`${ZENMUX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
      }),
    });
  } catch (e) {
    wrapZenmuxNetworkError(e);
  }

  const json = (await res!.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    error?: { message?: string };
  };

  if (!res!.ok) {
    const msg = json.error?.message ?? `ZenMux 请求失败（${res!.status}）`;
    throw new ZenMuxError(msg, res!.status);
  }

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new ZenMuxError('ZenMux 没有返回内容');
  const promptTokens = json.usage?.prompt_tokens ?? 0;
  const completionTokens = json.usage?.completion_tokens ?? 0;
  const totalTokens = json.usage?.total_tokens ?? promptTokens + completionTokens;
  return {
    content,
    usage: { promptTokens, completionTokens, totalTokens },
  };
}

async function zenmuxAnthropicChat(
  apiKey: string,
  model: string,
  messages: ZenmuxChatMessageInput[],
  options?: { maxTokens?: number; temperature?: number },
): Promise<ZenmuxChatResult> {
  const system = messages.find((m) => m.role === 'system')?.content;
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }));

  let res: Response;
  try {
    res = await fetch(`${zenmuxBaseUrlForModel(model)}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
        ...(system ? { system } : {}),
        messages: turns,
      }),
    });
  } catch (e) {
    wrapZenmuxNetworkError(e);
  }

  const json = (await res!.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  };

  if (!res!.ok) {
    const msg = json.error?.message ?? `ZenMux 请求失败（${res!.status}）`;
    throw new ZenMuxError(msg, res!.status);
  }

  const content = json.content
    ?.map((p) => (p.type === 'text' ? p.text ?? '' : ''))
    .join('')
    .trim();
  if (!content) throw new ZenMuxError('ZenMux 没有返回内容');
  const promptTokens = json.usage?.input_tokens ?? 0;
  const completionTokens = json.usage?.output_tokens ?? 0;
  return {
    content,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
}

/** 工作台 / 群聊对话（多模型，按 provider 走 OpenAI 或 Anthropic 协议） */
export async function zenmuxChatFromMessages(
  apiKey: string,
  model: string,
  messages: ZenmuxChatMessageInput[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    log?: LlmRequestLogContext;
  },
): Promise<ZenmuxChatResult> {
  const logCtx = options?.log;
  const started = Date.now();
  const meta = zenmuxChatModelMeta(model);
  // 某些模型(如 Kimi K2.6 / 推理模型)server 强制 temperature=1,传别的值会 400 拒。
  // dispatch(t):按指定温度发一次;t=undefined 时沿用调用方/下游默认温度。
  const dispatch = async (temperature?: number): Promise<ZenmuxChatResult> => {
    const opts = temperature != null ? { ...options, temperature } : options;
    if (meta.provider === 'anthropic') return zenmuxAnthropicChat(apiKey, model, messages, opts);
    if (meta.provider === 'google') {
      throw new ZenMuxError('当前未配置 Google Vertex 对话模型，请换其他模型');
    }
    return zenmuxOpenAiChat(apiKey, model, messages, opts);
  };
  try {
    let result: ZenmuxChatResult;
    try {
      // 目录标了 fixedTemperature 的模型直接用它覆盖(避免无谓的首发被拒)。
      result = await dispatch(meta.fixedTemperature ?? options?.temperature);
    } catch (e) {
      // 兜底:模型有 temperature=1 硬约束但目录未标注时,按 server 错误信号重试一次。
      if (
        meta.fixedTemperature !== 1 &&
        e instanceof ZenMuxError &&
        e.status === 400 &&
        /temperature/i.test(e.message) &&
        /only\s*1|must be 1|=\s*1\b/i.test(e.message)
      ) {
        result = await dispatch(1);
      } else {
        throw e;
      }
    }
    if (logCtx) {
      recordLlmRequest({
        ...logCtx,
        provider: 'zenmux',
        model,
        messages,
        responseText: result.content,
        usage: result.usage,
        responseTimeMs: Date.now() - started,
        status: 'ok',
      });
    }
    return result;
  } catch (e) {
    if (logCtx) {
      const msg = e instanceof Error ? e.message : String(e);
      recordLlmRequest({
        ...logCtx,
        provider: 'zenmux',
        model,
        messages,
        responseTimeMs: Date.now() - started,
        status: 'error',
        errorMessage: msg,
      });
    }
    throw e;
  }
}

export async function verifyZenMuxKey(apiKey: string): Promise<boolean> {
  await zenmuxChat(
    apiKey,
    [
      { role: 'user', content: '请只回复：好的' },
    ],
    { maxTokens: 16, temperature: 0 },
  );
  return true;
}

/** 识图识字（Gemini 多模态） */
export async function zenmuxOcr(params: {
  apiKey: string;
  imageBase64: string;
  mimeType?: string;
  purpose?: string;
}): Promise<string> {
  const mime = params.mimeType?.trim() || 'image/jpeg';
  const dataUrl = `data:${mime};base64,${params.imageBase64.replace(/\s/g, '')}`;
  const instructions = params.purpose?.trim() ?? '';

  return zenmuxChat(params.apiKey, [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${instructions ? `${instructions}\n\n` : ''}请识别图片中的中文或英文文字，按阅读顺序逐字转录原文。保留段落换行。不要纠正错别字、不要润色、不要补充或删减内容。不要加解释、标题或 markdown。若图中没有文字，只回复：（未识别到文字）`,
        },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ]);
}

/** 语音转文字（Gemini 多模态） */
/** @see https://zenmux.ai/docs/guide/advanced/multimodal.html */
function normalizeAudioFormat(format: string): string {
  const f = format.trim().toLowerCase() || 'mp4';
  if (f === 'm4a') return 'mp4';
  if (f === 'caf') return 'wav';
  if (['mp3', 'wav', 'mp4', 'aac', 'ogg', 'flac', 'aiff'].includes(f)) return f;
  return 'mp4';
}

export async function zenmuxTranscribe(params: {
  apiKey: string;
  audioBase64: string;
  format: string;
}): Promise<string> {
  const format = normalizeAudioFormat(params.format);
  const data = params.audioBase64.replace(/\s/g, '');

  const text = await zenmuxChat(
    params.apiKey,
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请将这段语音转写成简体中文。只输出说话内容，不要解释、不要标点以外的说明。若听不清，只回复：（未听清）',
          },
          {
            type: 'input_audio',
            input_audio: { data, format },
          },
        ],
      },
    ],
    { maxTokens: 2048, temperature: 0.1 },
  );

  return text.trim();
}

/**
 * ZenMux 适配器（task 11c）。
 *
 * ZenMux 是 multi-vendor 路由（OpenAI / Anthropic / Google），按 model 选协议。
 * 复用 `@xzz/shared`/`zenmuxChatModelMeta` 来路由：
 *   - 'openai'    → /api/v1/chat/completions
 *   - 'anthropic' → /api/anthropic/v1/messages
 *   - 'google'    → 暂不支持（throw bad_request）
 *
 * Spike 陷阱（务必处理）：
 * - #2 Kimi K2.6 偶发"content 为空"（200 OK）→ kind='empty_content'
 * - #3 Kimi K2.6 强制 temperature=1，传 0/0.3 会被 server 拒（factory 已处理 default
 *   但 caller 可能强行覆盖，那时直接吃 400 不二次包装）
 *
 * signal 必传，透传到底层 fetch（OpenAI / Anthropic 两条路径都要）。
 */

import {
  zenmuxBaseUrlForModel,
  zenmuxChatModelMeta,
  ZENMUX_BASE_URL,
} from '@xzz/shared';
import { recordLlmRequest } from '../../llmRequestLog.js';
import {
  LlmProviderError,
  type LlmChatClient,
  type LlmChatMessage,
  type LlmChatOptions,
  type LlmChatResult,
  type LlmChatUsage,
  type LlmModelId,
  type LlmProviderErrorKind,
} from '../types.js';
import { resolveModelProfile } from '../factory.js';

type OpenAiRawResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
};

type AnthropicRawResponse = {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

export class ZenMuxLlmClient implements LlmChatClient {
  readonly providerId = 'zenmux' as const;
  readonly modelId: LlmModelId;

  constructor(
    private readonly apiKey: string,
    modelId: LlmModelId,
  ) {
    this.modelId = modelId;
  }

  async chat(
    messages: LlmChatMessage[],
    opts: LlmChatOptions,
  ): Promise<LlmChatResult> {
    const meta = zenmuxChatModelMeta(this.modelId);
    if (meta.provider === 'google') {
      throw new LlmProviderError(
        this.providerId,
        this.modelId,
        'bad_request',
        '当前未配置 Google Vertex 对话模型，请换其他模型',
      );
    }
    const profile = resolveModelProfile(this.providerId, this.modelId);
    const maxTokens = opts.maxTokens ?? profile.defaultMaxTokens;
    const started = Date.now();
    // fixedTemperature 是 server 硬约束(如 Kimi K2.6 强制 temperature=1),必须**压过**
    // caller 传值(planner/reply 等会硬编码 0.2~0.4);没有硬约束才用 caller/profile 默认。
    const forcedTemp = meta.fixedTemperature;

    const runOnce = async (temperature: number): Promise<LlmChatResult> => {
      const result =
        meta.provider === 'anthropic'
          ? await this.chatAnthropic(messages, temperature, maxTokens, opts.signal)
          : await this.chatOpenAi(messages, temperature, maxTokens, opts.signal);
      if (opts.log) {
        void recordLlmRequest({
          ...opts.log,
          provider: 'zenmux',
          model: this.modelId,
          messages,
          responseText: result.content,
          usage: result.usage.totalTokens > 0 ? result.usage : undefined,
          responseTimeMs: Date.now() - started,
          status: 'ok',
        });
      }
      return {
        content: result.content,
        usage: result.usage,
        providerId: this.providerId,
        modelId: this.modelId,
      };
    };

    try {
      try {
        return await runOnce(forcedTemp ?? opts.temperature ?? profile.defaultTemperature);
      } catch (e) {
        // 兜底:模型有 temperature=1 硬约束但目录未标注 fixedTemperature 时,按 server
        // 错误信号(400 + "only 1")重试一次 temp=1,覆盖 qwen/gpt 等推理模型与未来模型。
        if (
          forcedTemp !== 1 &&
          e instanceof LlmProviderError &&
          (e.kind === 'bad_request' || e.status === 400) &&
          /temperature/i.test(e.message) &&
          /only\s*1|must be 1|=\s*1\b/i.test(e.message)
        ) {
          return await runOnce(1);
        }
        throw e;
      }
    } catch (e) {
      const err = e instanceof LlmProviderError ? e : this.wrapNetworkError(e);
      this.logError(opts, messages, started, err);
      throw err;
    }
  }

  // ──────────────────────────── OpenAI 协议 ────────────────────────────

  private async chatOpenAi(
    messages: LlmChatMessage[],
    temperature: number,
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<{ content: string; usage: LlmChatUsage }> {
    const res = await fetch(`${ZENMUX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelId,
        messages,
        stream: false,
        max_tokens: maxTokens,
        temperature,
      }),
      signal,
    });
    const json = await this.parseJson<OpenAiRawResponse>(res);
    this.assertOk(res, json.error?.message);
    const content = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) throw this.emptyContent();
    return {
      content,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        totalTokens:
          json.usage?.total_tokens ??
          (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0),
      },
    };
  }

  // ──────────────────────────── Anthropic 协议 ─────────────────────────

  private async chatAnthropic(
    messages: LlmChatMessage[],
    temperature: number,
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<{ content: string; usage: LlmChatUsage }> {
    const system = messages.find((m) => m.role === 'system')?.content;
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      }));

    const res = await fetch(`${zenmuxBaseUrlForModel(this.modelId)}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.modelId,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: turns,
      }),
      signal,
    });
    const json = await this.parseJson<AnthropicRawResponse>(res);
    this.assertOk(res, json.error?.message);
    const content =
      json.content
        ?.map((p) => (p.type === 'text' ? p.text ?? '' : ''))
        .join('')
        .trim() ?? '';
    if (!content) throw this.emptyContent();
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

  // ──────────────────────────── helpers ───────────────────────────────

  private async parseJson<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw new LlmProviderError(
        this.providerId,
        this.modelId,
        'unknown',
        `ZenMux 返回了非 JSON 响应（status=${res.status}）`,
        e,
        res.status,
      );
    }
  }

  private assertOk(res: Response, errMessage: string | undefined): void {
    if (res.ok) return;
    throw new LlmProviderError(
      this.providerId,
      this.modelId,
      this.classifyHttpError(res.status),
      errMessage ?? `ZenMux 请求失败（${res.status}）`,
      undefined,
      res.status,
    );
  }

  private emptyContent(): LlmProviderError {
    return new LlmProviderError(
      this.providerId,
      this.modelId,
      'empty_content',
      'ZenMux 没有返回内容（spike 陷阱 #2：Kimi K2.6 偶发；caller 应 fallback）',
    );
  }

  private classifyHttpError(status: number): LlmProviderErrorKind {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status === 408 || status === 504) return 'timeout';
    if (status >= 400 && status < 500) return 'bad_request';
    return 'unknown';
  }

  private wrapNetworkError(e: unknown): LlmProviderError {
    const isAbort =
      (e as { name?: string } | null)?.name === 'AbortError' ||
      /aborted/i.test(String(e));
    if (isAbort) {
      return new LlmProviderError(
        this.providerId,
        this.modelId,
        'timeout',
        'ZenMux 请求已取消',
        e,
      );
    }
    const detail = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ECONNREFUSED|ETIMEDOUT|TLS|socket/i.test(detail)) {
      return new LlmProviderError(
        this.providerId,
        this.modelId,
        'unknown',
        '无法连接 ZenMux（zenmux.ai）。若 API 在 Docker 里跑，请改用本机：npm run dev:api:host',
        e,
      );
    }
    return new LlmProviderError(
      this.providerId,
      this.modelId,
      'unknown',
      detail || 'ZenMux 网络请求失败',
      e,
    );
  }

  private logError(
    opts: LlmChatOptions,
    messages: LlmChatMessage[],
    started: number,
    err: LlmProviderError,
  ): void {
    if (!opts.log) return;
    void recordLlmRequest({
      ...opts.log,
      provider: 'zenmux',
      model: this.modelId,
      messages,
      responseTimeMs: Date.now() - started,
      status: 'error',
      errorMessage: `${err.kind}: ${err.message}`,
    });
  }
}

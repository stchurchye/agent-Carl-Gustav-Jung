/**
 * DeepSeek 适配器（task 11b）。
 *
 * 实现策略（spike 决策）：
 * - 直接 fetch DeepSeek /chat/completions，不复用 legacy chatCompletionRaw
 *   （legacy 不归一化 usage 也不接 signal；让两条路径解耦，便于未来 deprecate）
 * - signal 透传到 fetch
 * - 错误归一化成 LlmProviderError（auth / rate_limit / timeout / bad_request /
 *   empty_content / unknown）
 * - usage 字段从 response.usage 取，缺值降级 0 以保持 LlmChatUsage 类型完整
 * - log 字段 fire-and-forget 调 recordLlmRequest，失败不阻 chat 主流程
 */

import { DEEPSEEK_BASE_URL } from '@xzz/shared';
import { recordLlmRequest } from '../../llmRequestLog.js';
import {
  LlmProviderError,
  type LlmChatClient,
  type LlmChatMessage,
  type LlmChatOptions,
  type LlmChatResult,
  type LlmChatUsage,
  type LlmModelId,
} from '../types.js';
import { resolveModelProfile } from '../factory.js';

type DeepSeekRawResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
};

export class DeepSeekLlmClient implements LlmChatClient {
  readonly providerId = 'deepseek' as const;
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
    const profile = resolveModelProfile(this.providerId, this.modelId);
    const temperature = opts.temperature ?? profile.defaultTemperature;
    const maxTokens = opts.maxTokens ?? profile.defaultMaxTokens;
    const started = Date.now();

    let res: Response;
    try {
      res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
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
        signal: opts.signal,
      });
    } catch (e) {
      const err = this.wrapNetworkError(e);
      this.logError(opts, messages, started, err);
      throw err;
    }

    let json: DeepSeekRawResponse;
    try {
      json = (await res.json()) as DeepSeekRawResponse;
    } catch (e) {
      const err = new LlmProviderError(
        this.providerId,
        this.modelId,
        'unknown',
        `DeepSeek 返回了非 JSON 响应（status=${res.status}）`,
        e,
        res.status,
      );
      this.logError(opts, messages, started, err);
      throw err;
    }

    if (!res.ok) {
      const kind = this.classifyHttpError(res.status);
      const err = new LlmProviderError(
        this.providerId,
        this.modelId,
        kind,
        json.error?.message ?? `DeepSeek 请求失败（${res.status}）`,
        undefined,
        res.status,
      );
      this.logError(opts, messages, started, err);
      throw err;
    }

    const content = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      const err = new LlmProviderError(
        this.providerId,
        this.modelId,
        'empty_content',
        'DeepSeek 没有返回内容（reasoning model 可能 max_tokens 不足）',
        undefined,
        res.status,
      );
      this.logError(opts, messages, started, err);
      throw err;
    }

    const usage = this.normalizeUsage(json.usage);
    if (opts.log) {
      void recordLlmRequest({
        ...opts.log,
        provider: 'deepseek',
        model: this.modelId,
        messages,
        responseText: content,
        usage: usage.totalTokens > 0 ? usage : undefined,
        responseTimeMs: Date.now() - started,
        status: 'ok',
      });
    }

    return {
      content,
      usage,
      providerId: this.providerId,
      modelId: this.modelId,
    };
  }

  private normalizeUsage(
    raw: DeepSeekRawResponse['usage'],
  ): LlmChatUsage {
    const promptTokens = raw?.prompt_tokens ?? 0;
    const completionTokens = raw?.completion_tokens ?? 0;
    const totalTokens =
      raw?.total_tokens ??
      (promptTokens + completionTokens > 0
        ? promptTokens + completionTokens
        : 0);
    return { promptTokens, completionTokens, totalTokens };
  }

  private classifyHttpError(
    status: number,
  ): LlmProviderError['kind'] {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status === 408 || status === 504) return 'timeout';
    if (status >= 400 && status < 500) return 'bad_request';
    return 'unknown';
  }

  private wrapNetworkError(e: unknown): LlmProviderError {
    if (e instanceof LlmProviderError) return e;
    const isAbort =
      (e as { name?: string } | null)?.name === 'AbortError' ||
      /aborted/i.test(String(e));
    if (isAbort) {
      return new LlmProviderError(
        this.providerId,
        this.modelId,
        'timeout',
        'DeepSeek 请求已取消',
        e,
      );
    }
    const detail = e instanceof Error ? e.message : String(e);
    return new LlmProviderError(
      this.providerId,
      this.modelId,
      'unknown',
      detail || 'DeepSeek 网络请求失败',
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
      provider: 'deepseek',
      model: this.modelId,
      messages,
      responseTimeMs: Date.now() - started,
      status: 'error',
      errorMessage: `${err.kind}: ${err.message}`,
    });
  }
}

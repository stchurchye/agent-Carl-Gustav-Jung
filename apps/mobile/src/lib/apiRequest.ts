export type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
  /** 失败后额外重试次数，默认 LLM 为 2、其它为 0 */
  retries?: number;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly hint?: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function timeoutForPath(path: string): number {
  if (path.includes('/asr') || path.includes('/ocr')) return 90_000;
  if (path.includes('/assistant') || (path.includes('/chat/sessions') && path.includes('/messages'))) {
    return 120_000;
  }
  if (path.includes('/ai') || path.includes('/llm/invoke')) return 120_000;
  return 30_000;
}

function defaultRetries(path: string): number {
  if (
    path.includes('/assistant') ||
    (path.includes('/chat/sessions') && path.includes('/messages') && path.endsWith('/messages')) ||
    path.includes('/ai') ||
    path.includes('/llm/invoke')
  ) {
    return 2;
  }
  if (path.includes('/asr') || path.includes('/ocr')) return 1;
  return 0;
}

function wrapFetchError(e: unknown, path: string): ApiRequestError {
  if (e instanceof ApiRequestError) return e;

  if (e instanceof Error) {
    const msg = e.message.toLowerCase();
    if (e.name === 'AbortError' || msg.includes('aborted') || msg.includes('timeout')) {
      const isLlm = path.includes('/llm/invoke') || path.includes('/assistant') || path.includes('/ai');
      return new ApiRequestError(
        isLlm ? 'AI 回复超时了，请稍后再试' : '请求超时了，请检查网络后重试',
        'TIMEOUT',
        isLlm ? '生成较长时可能需多等几秒' : undefined,
        undefined,
        true,
      );
    }
    if (
      e instanceof TypeError ||
      msg.includes('network request failed') ||
      msg.includes('fetch failed') ||
      msg.includes('failed to connect') ||
      msg.includes('could not connect')
    ) {
      return new ApiRequestError(
        '连不上小助手服务',
        'NETWORK',
        '请确认已运行 npm run dev:api；真机请把 apps/mobile/.env 里的 API 地址改成电脑的局域网 IP',
        undefined,
        true,
      );
    }
  }

  return new ApiRequestError(
    e instanceof Error ? e.message : '出了点小问题，请稍后再试',
    'UNKNOWN',
    undefined,
    undefined,
    false,
  );
}

function shouldRetry(err: unknown, status?: number): boolean {
  if (status != null && status >= 502 && status <= 504) return true;
  if (err instanceof ApiRequestError && err.retryable) return true;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (err.message.includes('Network request failed')) return true;
  }
  return false;
}

export async function fetchJsonWithRetry<T>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<{ ok: true; data: T; requestId: string }> {
  const path = new URL(url).pathname;
  const timeoutMs = options.timeoutMs ?? timeoutForPath(path);
  const maxRetries = options.retries ?? defaultRetries(path);
  const { timeoutMs: _t, retries: _r, ...fetchInit } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...fetchInit, signal: ac.signal });
      clearTimeout(timer);

      let json: {
        ok?: boolean;
        message?: string;
        hint?: string;
        code?: string;
        data?: T;
        requestId?: string;
      };
      try {
        json = await res.json();
      } catch {
        throw new ApiRequestError(
          `服务无响应（${res.status}），请确认 API 已启动`,
          'BAD_RESPONSE',
          undefined,
          res.status,
          res.status >= 500,
        );
      }

      if (!json.ok) {
        throw new ApiRequestError(
          json.message ?? '出了点小问题，请稍后再试',
          json.code,
          json.hint,
          res.status,
          res.status >= 500 || res.status === 429,
        );
      }

      return {
        ok: true,
        data: json.data as T,
        requestId: json.requestId ?? '',
      };
    } catch (e) {
      clearTimeout(timer);
      lastError = e;

      if (e instanceof ApiRequestError && !e.retryable) throw e;

      const wrapped = wrapFetchError(e, path);

      if (attempt < maxRetries && shouldRetry(wrapped, wrapped.status)) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        lastError = wrapped;
        continue;
      }

      throw wrapped;
    }
  }

  throw lastError;
}

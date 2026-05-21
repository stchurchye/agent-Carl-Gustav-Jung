import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZenMuxLlmClient } from '../providers/zenmux.js';
import { LlmProviderError } from '../types.js';

const realFetch = global.fetch;

function mockFetchOnce(impl: (input: RequestInfo, init?: RequestInit) => Promise<Response>) {
  global.fetch = vi.fn(impl as unknown as typeof fetch);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseMessages = [
  { role: 'system' as const, content: 'you are an assistant.' },
  { role: 'user' as const, content: 'hello' },
];

describe('ZenMuxLlmClient (M1e Task 11c)', () => {
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  // ──────────────────── OpenAI 协议路径 ────────────────────

  it('OpenAI model (Kimi): happy path returns content + normalized usage', async () => {
    mockFetchOnce(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    );
    const c = new ZenMuxLlmClient('sk', 'moonshotai/kimi-k2.6');
    const r = await c.chat(baseMessages, { signal: new AbortController().signal });
    expect(r.content).toBe('ok');
    expect(r.providerId).toBe('zenmux');
    expect(r.modelId).toBe('moonshotai/kimi-k2.6');
    expect(r.usage).toEqual({
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
    });
  });

  it('OpenAI model: Kimi default temperature=1 (spike 陷阱 #3) when not overridden', async () => {
    let observedBody: Record<string, unknown> | null = null;
    mockFetchOnce(async (_input, init) => {
      observedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });
    const c = new ZenMuxLlmClient('sk', 'moonshotai/kimi-k2.6');
    await c.chat(baseMessages, { signal: new AbortController().signal });
    expect(observedBody!.temperature).toBe(1);
    expect(observedBody!.model).toBe('moonshotai/kimi-k2.6');
  });

  it('OpenAI model: caller-provided temperature wins over default', async () => {
    let observedBody: Record<string, unknown> | null = null;
    mockFetchOnce(async (_input, init) => {
      observedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
      });
    });
    const c = new ZenMuxLlmClient('sk', 'moonshotai/kimi-k2.6');
    await c.chat(baseMessages, {
      signal: new AbortController().signal,
      temperature: 0.5, // overrides default 1
    });
    expect(observedBody!.temperature).toBe(0.5);
  });

  it('OpenAI model: empty content → kind=empty_content (spike 陷阱 #2)', async () => {
    mockFetchOnce(async () =>
      jsonResponse(200, { choices: [{ message: { content: '   ' } }] }),
    );
    const c = new ZenMuxLlmClient('sk', 'moonshotai/kimi-k2.6');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'empty_content' });
  });

  // ──────────────────── Anthropic 协议路径 ────────────────────

  it('Anthropic model (Claude): routes to /v1/messages, system extracted, usage normalized', async () => {
    let observedUrl = '';
    let observedBody: Record<string, unknown> | null = null;
    let observedHeaders: Record<string, string> | null = null;
    mockFetchOnce(async (input, init) => {
      observedUrl = typeof input === 'string' ? input : (input as Request).url;
      observedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      observedHeaders = init?.headers as Record<string, string>;
      return jsonResponse(200, {
        content: [{ type: 'text', text: 'hi from claude' }],
        usage: { input_tokens: 11, output_tokens: 4 },
      });
    });
    const c = new ZenMuxLlmClient('sk', 'anthropic/claude-sonnet-4.6');
    const r = await c.chat(baseMessages, { signal: new AbortController().signal });
    expect(r.content).toBe('hi from claude');
    expect(observedUrl).toContain('/anthropic');
    expect(observedUrl).toMatch(/\/v1\/messages$/);
    expect(observedHeaders!['anthropic-version']).toBe('2023-06-01');
    expect(observedBody!.system).toBe('you are an assistant.');
    expect((observedBody!.messages as Array<{ role: string }>)[0].role).toBe('user');
    expect(r.usage).toEqual({
      promptTokens: 11,
      completionTokens: 4,
      totalTokens: 15,
    });
  });

  it('Anthropic model: multi-block text content concatenated', async () => {
    mockFetchOnce(async () =>
      jsonResponse(200, {
        content: [
          { type: 'text', text: 'foo' },
          { type: 'tool_use', text: 'IGNORE' },
          { type: 'text', text: 'bar' },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const c = new ZenMuxLlmClient('sk', 'anthropic/claude-sonnet-4.6');
    const r = await c.chat(baseMessages, { signal: new AbortController().signal });
    expect(r.content).toBe('foobar');
  });

  it('Anthropic model: empty content → empty_content', async () => {
    mockFetchOnce(async () =>
      jsonResponse(200, { content: [{ type: 'text', text: '' }], usage: { input_tokens: 1, output_tokens: 0 } }),
    );
    const c = new ZenMuxLlmClient('sk', 'anthropic/claude-sonnet-4.6');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'empty_content' });
  });

  // ──────────────────── 错误归一化 ────────────────────

  it('401 → kind=auth', async () => {
    mockFetchOnce(async () =>
      jsonResponse(401, { error: { message: 'bad key' } }),
    );
    const c = new ZenMuxLlmClient('sk-bad', 'moonshotai/kimi-k2.6');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'auth', status: 401 });
  });

  it('429 → kind=rate_limit', async () => {
    mockFetchOnce(async () => jsonResponse(429, { error: { message: 'rate' } }));
    const c = new ZenMuxLlmClient('sk', 'moonshotai/kimi-k2.6');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'rate_limit' });
  });

  it('400 invalid temperature (Kimi quirks) → kind=bad_request', async () => {
    mockFetchOnce(async () =>
      jsonResponse(400, { error: { message: 'invalid temperature: only 1 is allowed for this model' } }),
    );
    const c = new ZenMuxLlmClient('sk', 'moonshotai/kimi-k2.6');
    await expect(
      c.chat(baseMessages, {
        signal: new AbortController().signal,
        temperature: 0,
      }),
    ).rejects.toMatchObject({
      kind: 'bad_request',
      status: 400,
      message: expect.stringContaining('only 1 is allowed'),
    });
  });

  it('google provider model → kind=bad_request (not supported)', async () => {
    // 触发 zenmuxChatModelMeta 返回 google provider 的 model（非 list 内的不会自动归为 google,
    // 实际 list 里有 google 模型，我们查 shared）
    // 取巧：依赖 zenmuxChatModelMeta unknown fallback → 'openai'。
    // 所以这里我们手动构造一个已知 google modelId（必须在 shared list 里）。
    const { ZENMUX_CHAT_MODELS } = await import('@xzz/shared');
    const googleModel = ZENMUX_CHAT_MODELS.find((m) => m.provider === 'google');
    if (!googleModel) {
      // 如果 shared 里没有 google model，跳过断言
      return;
    }
    const c = new ZenMuxLlmClient('sk', googleModel.id);
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      kind: 'bad_request',
      message: expect.stringContaining('Google'),
    });
  });

  it('abort signal → kind=timeout', async () => {
    mockFetchOnce(
      (_input, init) =>
        new Promise((_, reject) => {
          const sig = init?.signal;
          sig?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const c = new ZenMuxLlmClient('sk', 'moonshotai/kimi-k2.6');
    const ctrl = new AbortController();
    const p = c.chat(baseMessages, { signal: ctrl.signal }).catch((e: unknown) => e);
    setTimeout(() => ctrl.abort(), 10);
    const err = (await p) as LlmProviderError;
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(err.kind).toBe('timeout');
  });

  it('ECONNREFUSED → kind=unknown with friendly hint', async () => {
    mockFetchOnce(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:443');
    });
    const c = new ZenMuxLlmClient('sk', 'moonshotai/kimi-k2.6');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      kind: 'unknown',
      message: expect.stringContaining('无法连接 ZenMux'),
    });
  });
});

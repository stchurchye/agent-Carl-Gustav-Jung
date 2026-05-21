import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekLlmClient } from '../providers/deepseek.js';
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

describe('DeepSeekLlmClient (M1e Task 11b)', () => {
  beforeEach(() => {
    delete process.env.DEEPSEEK_MODEL_PRO;
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('happy path: returns content + normalized usage + providerId/modelId', async () => {
    mockFetchOnce(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }),
    );
    const c = new DeepSeekLlmClient('sk-test', 'deepseek-v4-pro');
    const ctrl = new AbortController();
    const r = await c.chat(baseMessages, { signal: ctrl.signal });
    expect(r.content).toBe('ok');
    expect(r.providerId).toBe('deepseek');
    expect(r.modelId).toBe('deepseek-v4-pro');
    expect(r.usage).toEqual({
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
    });
  });

  it('per-model defaults: deepseek-v4-pro → maxTokens=4096, temperature=0.3', async () => {
    let observedBody: Record<string, unknown> | null = null;
    mockFetchOnce(async (_input, init) => {
      observedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    await c.chat(baseMessages, { signal: new AbortController().signal });
    expect(observedBody!.max_tokens).toBe(4096);
    expect(observedBody!.temperature).toBe(0.3);
    expect(observedBody!.model).toBe('deepseek-v4-pro');
    expect(observedBody!.stream).toBe(false);
  });

  it('caller can override temperature/maxTokens', async () => {
    let observedBody: Record<string, unknown> | null = null;
    mockFetchOnce(async (_input, init) => {
      observedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse(200, {
        choices: [{ message: { content: 'x' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    await c.chat(baseMessages, {
      signal: new AbortController().signal,
      temperature: 0.7,
      maxTokens: 999,
    });
    expect(observedBody!.temperature).toBe(0.7);
    expect(observedBody!.max_tokens).toBe(999);
  });

  it('401 → LlmProviderError(kind=auth, status=401)', async () => {
    mockFetchOnce(async () =>
      jsonResponse(401, { error: { message: 'invalid api key' } }),
    );
    const c = new DeepSeekLlmClient('sk-bad', 'deepseek-v4-pro');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      name: 'LlmProviderError',
      kind: 'auth',
      status: 401,
      message: expect.stringContaining('invalid api key'),
    });
  });

  it('429 → kind=rate_limit', async () => {
    mockFetchOnce(async () =>
      jsonResponse(429, { error: { message: 'rate limited' } }),
    );
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
  });

  it('504 → kind=timeout', async () => {
    mockFetchOnce(async () =>
      jsonResponse(504, { error: { message: 'gateway timeout' } }),
    );
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('400 (non-auth/rate) → kind=bad_request', async () => {
    mockFetchOnce(async () =>
      jsonResponse(400, { error: { message: 'invalid temperature' } }),
    );
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'bad_request', status: 400 });
  });

  it('500 → kind=unknown', async () => {
    mockFetchOnce(async () =>
      jsonResponse(500, { error: { message: 'internal' } }),
    );
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'unknown', status: 500 });
  });

  it('200 with empty content → kind=empty_content', async () => {
    mockFetchOnce(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: '   ' } }],
        usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
      }),
    );
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'empty_content' });
  });

  it('200 with non-JSON body → kind=unknown', async () => {
    mockFetchOnce(
      async () =>
        new Response('<html>bad gateway</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('abort → kind=timeout (signal plumbed to fetch)', async () => {
    // 模拟 fetch 真的接受 signal 并在 abort 时 throw AbortError
    mockFetchOnce(
      (_input, init) =>
        new Promise((_, reject) => {
          const sig = init?.signal;
          if (sig?.aborted) {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          sig?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    const ctrl = new AbortController();
    const p = c
      .chat(baseMessages, { signal: ctrl.signal })
      .catch((e: unknown) => e);
    setTimeout(() => ctrl.abort(), 10);
    const err = (await p) as LlmProviderError;
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(err.kind).toBe('timeout');
  });

  it('network failure (fetch throws non-abort) → kind=unknown', async () => {
    mockFetchOnce(async () => {
      throw new Error('ECONNREFUSED');
    });
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    await expect(
      c.chat(baseMessages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      kind: 'unknown',
      message: expect.stringContaining('ECONNREFUSED'),
    });
  });

  it('missing usage in response → defaults to zeros', async () => {
    mockFetchOnce(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    const r = await c.chat(baseMessages, { signal: new AbortController().signal });
    expect(r.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('only partial usage → totalTokens computed from prompt+completion', async () => {
    mockFetchOnce(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 4, completion_tokens: 6 }, // no total_tokens
      }),
    );
    const c = new DeepSeekLlmClient('sk', 'deepseek-v4-pro');
    const r = await c.chat(baseMessages, { signal: new AbortController().signal });
    expect(r.usage.totalTokens).toBe(10);
  });
});

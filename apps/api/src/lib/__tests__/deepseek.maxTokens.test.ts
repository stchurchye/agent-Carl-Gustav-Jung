import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletionRaw } from '../deepseek.js';

const realFetch = global.fetch;

/** 捕获最近一次 fetch 的请求体（已 JSON.parse）。 */
function mockFetchCapture(): { body: () => any } {
  let captured: any = null;
  global.fetch = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
    captured = init?.body ? JSON.parse(init.body as string) : null;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { body: () => captured };
}

const messages = [
  { role: 'system' as const, content: 'you are an assistant.' },
  { role: 'user' as const, content: 'hello' },
];

describe('chatCompletionRaw maxTokens 默认值（reasoning 模型对齐 factory）', () => {
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('不传 maxTokens 时，对 reasoning 模型 deepseek-v4-pro 用 4096（非 2048）', async () => {
    const cap = mockFetchCapture();
    await chatCompletionRaw('sk-test', messages);
    expect(cap.body().max_tokens).toBe(4096);
  });

  it('显式传 maxTokens 仍优先（小预算调用如 verifyDeepSeekKey 不被抬大）', async () => {
    const cap = mockFetchCapture();
    await chatCompletionRaw('sk-test', messages, { maxTokens: 16 });
    expect(cap.body().max_tokens).toBe(16);
  });
});

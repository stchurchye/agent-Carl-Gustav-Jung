import { afterEach, describe, expect, it, vi } from 'vitest';
import { zenmuxChatFromMessages } from '../zenmux.js';

// 聊天/群聊走老 zenmuxChatFromMessages。某些模型(Kimi K2.6)server 强制 temperature=1,
// 传别的值会 400 拒("invalid temperature: only 1 is allowed for this model")。
// 修复:① fixedTemperature 标注的模型覆盖调用方温度;② 未标注但报该错的模型重试一次 temp=1。

const realFetch = global.fetch;
const ok = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const tempError = () =>
  new Response(
    JSON.stringify({ error: { message: 'invalid temperature: only 1 is allowed for this model' } }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );

const msgs = [{ role: 'user' as const, content: 'hi' }];

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('zenmuxChatFromMessages temperature handling', () => {
  it('Kimi (fixedTemperature=1): 覆盖调用方温度,body 发 temperature=1', async () => {
    const bodies: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit)?.body ?? '{}')));
      return ok();
    }) as unknown as typeof fetch;
    await zenmuxChatFromMessages('sk', 'moonshotai/kimi-k2.6', msgs, { temperature: 0.7 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].temperature).toBe(1);
  });

  it('未标注模型遇 temperature 400 → 重试一次 temperature=1 并成功', async () => {
    const bodies: Record<string, unknown>[] = [];
    let call = 0;
    global.fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit)?.body ?? '{}')));
      call += 1;
      return call === 1 ? tempError() : ok();
    }) as unknown as typeof fetch;
    const r = await zenmuxChatFromMessages('sk', 'deepseek/deepseek-v4-pro', msgs, {
      temperature: 0.7,
    });
    expect(r.content).toBe('ok');
    expect(bodies).toHaveLength(2);
    expect(bodies[0].temperature).toBe(0.7); // 首发用调用方温度
    expect(bodies[1].temperature).toBe(1); // 重试强制 1
  });

  it('普通模型正常时不重试,沿用调用方温度', async () => {
    const bodies: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit)?.body ?? '{}')));
      return ok();
    }) as unknown as typeof fetch;
    await zenmuxChatFromMessages('sk', 'deepseek/deepseek-v4-pro', msgs, { temperature: 0.7 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].temperature).toBe(0.7);
  });

  it('非温度类 400 错误不触发重试,直接抛', async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    await expect(
      zenmuxChatFromMessages('sk', 'deepseek/deepseek-v4-pro', msgs, { temperature: 0.7 }),
    ).rejects.toThrow(/invalid api key/);
    expect(call).toBe(1);
  });
});

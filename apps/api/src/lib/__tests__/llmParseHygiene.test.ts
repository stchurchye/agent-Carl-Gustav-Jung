import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseIntentJson } from '../deepseek.js';
import { classifyIntent } from '../intentClassify.js';
import { zenmuxChatFromMessages } from '../zenmux.js';

/**
 * Review 2026-06-11 [P2][api-llm-context] 三小项:
 * - deepseek.ts:268 parseIntentJson 用 raw.replace(line,'') 只删第一个匹配,
 *   重复出现的 JSON 行会残留在 displayText 里展示给用户。
 * - intentClassify.ts:88 LLM 没回 JSON 时静默返回 [],一条日志都没有。
 * - zenmux.ts:256 调用方传越界 temperature(-0.5/5)原样发给服务端被 400 拒,
 *   且非「must be 1」类错误不重试。修后入口钳制到 [0,2]。
 */

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('parseIntentJson displayText 清理', () => {
  it('JSON 行重复出现时全部移出 displayText', () => {
    const json = '{"action":"修改","instruction":"x","ready":true}';
    const raw = `好的,这就改:\n${json}\n${json}`;
    const r = parseIntentJson(raw);
    expect(r.displayText).toBe('好的,这就改:');
    expect(r.action).toBe('修改');
  });

  it('displayText 与 JSON 行无关的内容原样保留', () => {
    const raw = '请问:\n{"action":"修改","instruction":"x","ready":false}\n附加说明{"other":"data"}';
    const r = parseIntentJson(raw);
    expect(r.displayText).toContain('请问:');
    expect(r.displayText).toContain('附加说明');
    expect(r.displayText).not.toContain('"action"');
  });
});

describe('classifyIntent 无 JSON 输出时可观测', () => {
  it('LLM 回纯文本 → 返回 [] 且留下 warn 日志', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'I cannot determine intent' } }],
          usage: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, 'warn');
    const out = await classifyIntent('sk-fake', '随便说点什么', 'private');
    expect(out).toEqual([]);
    const calls = warnSpy.mock.calls.map((c) => c.join(' '));
    expect(calls.some((c) => c.includes('classifyIntent'))).toBe(true);
  });
});

describe('zenmuxChatFromMessages temperature 钳制', () => {
  const msgs = [{ role: 'user' as const, content: 'hi' }];

  it('temperature=-0.5 → 发出前钳到 0', async () => {
    const bodies: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit)?.body ?? '{}')));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    await zenmuxChatFromMessages('sk', 'openai/gpt-4o-mini', msgs, { temperature: -0.5 });
    expect(bodies[0].temperature).toBe(0);
  });

  it('temperature=5 → 发出前钳到 2', async () => {
    const bodies: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit)?.body ?? '{}')));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    await zenmuxChatFromMessages('sk', 'openai/gpt-4o-mini', msgs, { temperature: 5 });
    expect(bodies[0].temperature).toBe(2);
  });
});

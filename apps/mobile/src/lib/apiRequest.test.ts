import { timeoutForPath } from './apiRequest';

// intent/execute 是主聊天/agent 入口,同步等 LLM(实测 16~36s,agent/推理更久),
// 之前漏在超时白名单外 → 落默认 30s → server 还在跑 app 已报「请求超时」。

describe('timeoutForPath', () => {
  it('gives LLM/agent paths a generous timeout (5 min)', () => {
    expect(timeoutForPath('/api/intent/execute')).toBe(300_000);
    expect(timeoutForPath('/api/chat/sessions/abc/messages')).toBe(300_000);
    expect(timeoutForPath('/api/groups/g/topics/t/ai')).toBe(300_000);
    expect(timeoutForPath('/api/assistant/reply')).toBe(300_000);
    expect(timeoutForPath('/api/llm/invoke')).toBe(300_000);
  });

  it('keeps media (asr/ocr) at 2 min', () => {
    expect(timeoutForPath('/api/asr')).toBe(120_000);
    expect(timeoutForPath('/api/ocr')).toBe(120_000);
  });

  it('keeps plain CRUD at default 30s (incl. fast intent/analyze)', () => {
    expect(timeoutForPath('/api/intent/analyze')).toBe(30_000);
    expect(timeoutForPath('/api/groups')).toBe(30_000);
    expect(timeoutForPath('/api/auth/me')).toBe(30_000);
  });
});

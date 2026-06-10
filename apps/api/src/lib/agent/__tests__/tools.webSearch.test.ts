import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webSearchTool, registerWebSearch } from '../tools/webSearch.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r',
  stepId: 's',
  ownerId: 'u',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('webSearch tool', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('registers idempotently', () => {
    registerWebSearch();
    registerWebSearch();
    expect(toolRegistry.get('search_web')).toBeDefined();
  });

  it('no TAVILY_API_KEY: returns empty results + note, does not throw', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    const out = await webSearchTool.handler({ query: 'x' }, fakeCtx);
    expect(out.results).toEqual([]);
    expect(out.note).toMatch(/搜索未配置/);
  });

  it('calls Tavily endpoint and maps results when key present', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk-test');
    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: 'Foo', url: 'https://foo', content: 'foo content' },
            { title: 'Bar', url: 'https://bar', content: 'bar content' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const out = await webSearchTool.handler(
      { query: 'family trust', maxResults: 3 },
      fakeCtx,
    );
    expect(out.results.length).toBe(2);
    expect(out.results[0]).toEqual({
      title: 'Foo',
      url: 'https://foo',
      snippet: 'foo content',
    });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.tavily.com/search');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      api_key: 'tk-test',
      query: 'family trust',
      max_results: 3,
    });
  });

  it('M1f #5: non-2xx response → { ok: false, error }, does not throw', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const out = await webSearchTool.handler({ query: 'x' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Tavily HTTP 500/);
    expect(out.results).toEqual([]);
  });

  // R1(实测驱动,2026-06-10 真 Tavily 探针):
  // ① snippet 截 300 把 Tavily 已返回的 1200-2400 字正文丢 75%;② include_answer 免费概括没要;
  // ③ search_depth 写死 basic,advanced 实测多出学术源。以下钉住修复。
  it('R1:请求体带 include_answer,searchDepth 默认 basic、可传 advanced', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await webSearchTool.handler({ query: 'x' }, fakeCtx);
    let body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ search_depth: 'basic', include_answer: true });

    await webSearchTool.handler({ query: 'x', searchDepth: 'advanced' }, fakeCtx);
    body = JSON.parse((mockFetch.mock.calls[1]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ search_depth: 'advanced' });
  });

  it('R1:Tavily answer 概括透传;snippet 保留长正文(上限 1000,不再 300)', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    const longContent = '深'.repeat(2400);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            answer: '共时性是荣格提出的非因果有意义巧合概念。',
            results: [{ title: 'T', url: 'https://t', content: longContent }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const out = await webSearchTool.handler({ query: '共时性' }, fakeCtx);
    expect(out.answer).toBe('共时性是荣格提出的非因果有意义巧合概念。');
    expect(out.results[0].snippet.length).toBe(1000);
  });

  it('R1:幂等 key 区分 searchDepth(advanced 结果集不同,不能复用 basic 缓存)', () => {
    const kBasic = webSearchTool.computeIdempotencyKey!({ query: 'x' });
    const kAdv = webSearchTool.computeIdempotencyKey!({ query: 'x', searchDepth: 'advanced' });
    expect(kBasic).not.toBe(kAdv);
  });

  // R1-2(实测驱动):生造词 query 实测不返回 0 条,而是 5 条 score<0.2 的垃圾,
  // Tavily answer 还会对生造词编故事;正经 query 实测 score>0.7。
  // → score 透传 + 全低分标 low_relevance + 丢弃幻觉 answer + 空结果标 empty。
  it('R1-2:score 透传;全部低分 → quality=low_relevance + note 提示换词 + 丢弃 answer', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            answer: '一本正经的编造解释',
            results: [
              { title: '垃圾A', url: 'https://a', content: 'x', score: 0.17 },
              { title: '垃圾B', url: 'https://b', content: 'x', score: 0.05 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const out = await webSearchTool.handler({ query: '生造词' }, fakeCtx);
    expect(out.results[0].score).toBe(0.17);
    expect(out.quality).toBe('low_relevance');
    expect(out.note).toMatch(/换关键词|换.*语言/);
    expect(out.answer).toBeUndefined(); // 低相关时 answer 是幻觉源,丢弃
  });

  it('R1-2:有高分结果 → quality=ok,answer 保留', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            answer: '靠谱概括',
            results: [{ title: '好', url: 'https://g', content: 'x', score: 0.87 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const out = await webSearchTool.handler({ query: '共时性' }, fakeCtx);
    expect(out.quality).toBe('ok');
    expect(out.answer).toBe('靠谱概括');
  });

  it('R1-2:结果为空 → quality=empty + note 提示换词', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const out = await webSearchTool.handler({ query: 'x' }, fakeCtx);
    expect(out.quality).toBe('empty');
    expect(out.note).toMatch(/换关键词/);
  });

  it('idempotency key normalizes query case + maxResults', () => {
    const k1 = webSearchTool.computeIdempotencyKey!({
      query: ' Foo Bar ',
      maxResults: 5,
    });
    const k2 = webSearchTool.computeIdempotencyKey!({
      query: 'foo bar',
      maxResults: 5,
    });
    expect(k1).toBe(k2);
  });

  it('M1f #5: happy path has ok: true', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ results: [{ title: 't', url: 'u', content: 'c' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const out = await webSearchTool.handler({ query: 'x' }, fakeCtx);
    expect(out.ok).toBe(true);
  });

  it('M1f #5: missing TAVILY_API_KEY still ok: true (silent capability gap)', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    const out = await webSearchTool.handler({ query: 'x' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.note).toBeDefined();
  });

  it('M1f #5: ctx.signal abort during fetch re-throws so runtime sees cancel', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    const ac = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener(
            'abort',
            () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            },
            { once: true },
          );
        });
      }),
    );
    const p = webSearchTool.handler({ query: 'x' }, { ...fakeCtx, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});

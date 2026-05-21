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
    expect(toolRegistry.get('web_search')).toBeDefined();
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

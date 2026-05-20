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

  it('non-2xx response throws', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    await expect(
      webSearchTool.handler({ query: 'x' }, fakeCtx),
    ).rejects.toThrow(/Tavily HTTP 500/);
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
});

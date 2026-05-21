import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUrlTool, registerFetchUrl } from '../tools/fetchUrl.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('fetch_url (Jina Reader) tool', () => {
  beforeEach(() => { vi.unstubAllGlobals(); delete process.env.JINA_API_KEY; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.JINA_API_KEY; });

  it('registers idempotently', () => {
    registerFetchUrl();
    registerFetchUrl();
    expect(toolRegistry.get('fetch_url')).toBeDefined();
  });

  it('Jina 200 → ok:true, title extracted from "Title: ..." prefix line', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('r.jina.ai');
      return new Response(
        'Title: 家族信托入门\nURL Source: https://example.com/trust\n\n# 家族信托入门\n\n段落内容...',
        { status: 200 },
      );
    }));
    const out = await fetchUrlTool.handler({ url: 'https://example.com/trust' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.title).toBe('家族信托入门');
    expect(out.content).toContain('段落内容');
    expect(out.url).toBe('https://example.com/trust');
  });

  it('Jina 404 → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const out = await fetchUrlTool.handler({ url: 'https://x.com/gone' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/HTTP 404/);
  });

  it('content over 24KB → truncated:true, content capped', async () => {
    const huge = 'a'.repeat(30_000);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(huge, { status: 200 })));
    const out = await fetchUrlTool.handler({ url: 'https://x.com/big' }, fakeCtx);
    expect(out.truncated).toBe(true);
    expect(out.content.length).toBeLessThanOrEqual(24 * 1024 + 100); // small buffer for cap msg
  });

  it('sets Authorization header when JINA_API_KEY is set', async () => {
    process.env.JINA_API_KEY = 'jina-test-key';
    const fetchSpy = vi.fn(async () => new Response('Title: t\n\nbody', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await fetchUrlTool.handler({ url: 'https://x.com/with-key' }, fakeCtx);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jina-test-key');
  });

  it('no JINA_API_KEY → no Authorization header', async () => {
    const fetchSpy = vi.fn(async () => new Response('Title: t\n\nbody', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await fetchUrlTool.handler({ url: 'https://x.com/no-key' }, fakeCtx);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('extractRef returns url ref on success', () => {
    const ref = fetchUrlTool.replyMeta!.extractRef!({
      ok: true, url: 'https://x.com/a', title: 'X', content: 'body', truncated: false,
    });
    expect(ref).toEqual({ kind: 'url', id: 'https://x.com/a', label: 'X' });
  });

  it('extractRef returns null on failure', () => {
    const ref = fetchUrlTool.replyMeta!.extractRef!({
      ok: false, url: '', title: '', content: '', truncated: false, error: 'boom',
    });
    expect(ref).toBeNull();
  });

  it('AbortError re-throws', async () => {
    const ac = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      return new Promise((_r, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
        });
      });
    }));
    const p = fetchUrlTool.handler({ url: 'https://x.com/slow' }, { ...fakeCtx, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wikipediaTool, registerWikipedia } from '../tools/wikipedia.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('wikipedia tool', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('registers idempotently', () => {
    registerWikipedia();
    registerWikipedia();
    expect(toolRegistry.get('wikipedia')).toBeDefined();
  });

  it('English title → en.wikipedia.org/api/rest_v1', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('en.wikipedia.org');
      return new Response(
        JSON.stringify({
          title: 'Prospect theory',
          extract: 'Prospect theory is a behavioral model...',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Prospect_theory' } },
          pageid: 12345,
        }),
        { status: 200 },
      );
    }));
    const out = await wikipediaTool.handler({ title: 'Prospect theory' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.lang).toBe('en');
    expect(out.summary).toContain('behavioral');
    expect(out.url).toContain('Prospect_theory');
  });

  it('CJK title → auto zh.wikipedia.org', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('zh.wikipedia.org');
      return new Response(
        JSON.stringify({
          title: '前景理论', extract: '前景理论是...',
          content_urls: { desktop: { page: 'https://zh.wikipedia.org/wiki/前景理论' } },
          pageid: 67890,
        }),
        { status: 200 },
      );
    }));
    const out = await wikipediaTool.handler({ title: '前景理论' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.lang).toBe('zh');
  });

  it('404 → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const out = await wikipediaTool.handler({ title: 'Definitely Not A Page' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/HTTP 404/);
  });

  it('extractRef returns url ref', () => {
    const ref = wikipediaTool.replyMeta!.extractRef!({
      ok: true, title: 'X', lang: 'en', summary: '', url: 'https://en.wikipedia.org/wiki/X', pageId: 1,
    });
    expect(ref).toEqual({ kind: 'url', id: 'https://en.wikipedia.org/wiki/X', label: 'Wikipedia: X' });
  });
});

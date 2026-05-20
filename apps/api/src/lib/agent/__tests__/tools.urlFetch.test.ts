import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { urlFetchTool, registerUrlFetch } from '../tools/urlFetch.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r',
  stepId: 's',
  ownerId: 'u',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p></article></body></html>`;
}

describe('urlFetch tool', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers idempotently', () => {
    registerUrlFetch();
    registerUrlFetch();
    expect(toolRegistry.get('url_fetch')).toBeDefined();
  });

  it('extracts title + text via readability', async () => {
    const longBody = '段落内容。'.repeat(400);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(htmlPage('家族信托入门', longBody), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      ),
    );
    const out = await urlFetchTool.handler(
      { url: 'https://example.com/trust', maxChars: 500 },
      fakeCtx,
    );
    expect(out.title).toContain('家族信托');
    expect(out.text.length).toBeLessThanOrEqual(500);
    expect(out.truncated).toBe(true);
    expect(out.url).toBe('https://example.com/trust');
  });

  it('does not truncate when content shorter than maxChars', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(htmlPage('Short', 'tiny body'), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      ),
    );
    const out = await urlFetchTool.handler(
      { url: 'https://example.com/short', maxChars: 5000 },
      fakeCtx,
    );
    expect(out.truncated).toBe(false);
  });

  it('non-2xx throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 404 })),
    );
    await expect(
      urlFetchTool.handler({ url: 'https://example.com/x' }, fakeCtx),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('idempotency key by url', () => {
    expect(
      urlFetchTool.computeIdempotencyKey!({ url: 'https://x.com/a' }),
    ).toBe('url:https://x.com/a');
  });
});

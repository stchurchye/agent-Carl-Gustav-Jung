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
    expect(out.ok).toBe(true);
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

  it('M1f #5: non-2xx → { ok: false, error: HTTP xxx }, does not throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 404 })),
    );
    const out = await urlFetchTool.handler(
      { url: 'https://example.com/x' },
      fakeCtx,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/HTTP 404/);
    expect(out.text).toBe('');
  });

  it('M1f #5: happy path has ok: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(htmlPage('OK', 'body'), {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );
    const out = await urlFetchTool.handler(
      { url: 'https://example.com/ok' },
      fakeCtx,
    );
    expect(out.ok).toBe(true);
  });

  it('idempotency key by url', () => {
    expect(
      urlFetchTool.computeIdempotencyKey!({ url: 'https://x.com/a' }),
    ).toBe('url:https://x.com/a');
  });

  // ========== M1e Task 13.1 ==========
  it('M1e 13.1 + M1f #5: disallowed content-type (application/pdf) → ok: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('PDF binary blob', {
            status: 200,
            headers: { 'Content-Type': 'application/pdf' },
          }),
      ),
    );
    const out = await urlFetchTool.handler(
      { url: 'https://example.com/file.pdf' },
      fakeCtx,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unsupported content-type/i);
  });

  it('M1e 13.1 + M1f #5: content-length header > 4MB → ok: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html><body>small</body></html>', {
            status: 200,
            headers: {
              'Content-Type': 'text/html',
              'Content-Length': String(5 * 1024 * 1024),
            },
          }),
      ),
    );
    const out = await urlFetchTool.handler(
      { url: 'https://example.com/big' },
      fakeCtx,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/payload too large/);
  });

  it('M1e 13.1 + M1f #5: stream actual bytes > cap → ok: false', async () => {
    // 流式喂 > 4MB（每块 1MB × 5 块），中间应当 abort
    const oneMB = 'a'.repeat(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        for (let i = 0; i < 5; i++) {
          controller.enqueue(enc.encode(oneMB));
          await new Promise((r) => setTimeout(r, 1));
        }
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );
    const out = await urlFetchTool.handler(
      { url: 'https://example.com/huge' },
      fakeCtx,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/MAX_BYTES/);
  });

  it('M1f #3: outer ctx.signal abort re-throws so runtime sees cancel', async () => {
    const ac = new AbortController();
    const ctxAborted = { ...fakeCtx, signal: ac.signal };
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
    const p = urlFetchTool.handler({ url: 'https://example.com/slow' }, ctxAborted);
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});

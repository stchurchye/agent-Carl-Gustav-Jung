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

  // ========== M1e Task 13.1 ==========
  it('M1e 13.1: rejects disallowed content-type (application/pdf)', async () => {
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
    await expect(
      urlFetchTool.handler({ url: 'https://example.com/file.pdf' }, fakeCtx),
    ).rejects.toThrow(/unsupported content-type/i);
  });

  it('M1e 13.1: rejects when content-length header exceeds 4MB', async () => {
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
    await expect(
      urlFetchTool.handler({ url: 'https://example.com/big' }, fakeCtx),
    ).rejects.toThrow(/payload too large/);
  });

  it('M1e 13.1: aborts mid-stream when actual bytes exceed cap', async () => {
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
    await expect(
      urlFetchTool.handler({ url: 'https://example.com/huge' }, fakeCtx),
    ).rejects.toThrow(/MAX_BYTES/);
  });
});

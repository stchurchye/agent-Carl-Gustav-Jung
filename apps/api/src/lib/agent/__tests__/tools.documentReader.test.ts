import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentReaderTool, registerDocumentReader } from '../tools/documentReader.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('pdf-parse', () => ({
  default: vi.fn(async (_buf: Buffer) => ({ text: 'extracted pdf text here' })),
}));
vi.mock('mammoth', () => ({
  default: { convertToMarkdown: vi.fn(async (_opts: unknown) => ({ value: '# heading\nbody' })) },
  convertToMarkdown: vi.fn(async (_opts: unknown) => ({ value: '# heading\nbody' })),
}));
vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: { '!ref': 'A1:B2' } } })),
  utils: {
    sheet_to_json: vi.fn(() => [{ a: 1, b: 2 }, { a: 3, b: 4 }]),
  },
}));

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('document_reader tool', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('registers idempotently', () => {
    registerDocumentReader();
    registerDocumentReader();
    expect(toolRegistry.get('document_reader')).toBeDefined();
  });

  it('PDF: returns extracted text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(10), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/a.pdf' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.format).toBe('pdf');
    expect(out.text).toContain('pdf text');
  });

  it('DOCX: returns markdown from mammoth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(10), {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/a.docx' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.format).toBe('docx');
    expect(out.text).toContain('heading');
  });

  it('XLSX: returns markdown table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(10), {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/a.xlsx' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.format).toBe('xlsx');
    expect(out.text).toMatch(/\|/);
  });

  it('unsupported content-type → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('binary', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/a.png' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unsupported/);
  });

  it('HTTP error → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/gone.pdf' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/HTTP 404/);
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
    const p = documentReaderTool.handler({ url: 'https://x.com/a.pdf' }, { ...fakeCtx, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});

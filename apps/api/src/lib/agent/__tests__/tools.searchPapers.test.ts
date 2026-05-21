import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  searchPapersTool,
  getPaperCitationsTool,
  registerSearchPapers,
} from '../tools/searchPapers.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r',
  stepId: 's',
  ownerId: 'u',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

const openAlexHit = {
  id: 'https://openalex.org/W123',
  title: 'Prospect Theory: An Analysis',
  publication_year: 1979,
  doi: 'https://doi.org/10.2307/1914185',
  cited_by_count: 75000,
  authorships: [
    { author: { display_name: 'Daniel Kahneman' } },
    { author: { display_name: 'Amos Tversky' } },
  ],
  abstract_inverted_index: { Decision: [0], making: [1], under: [2], risk: [3] },
};

describe('search_papers tool', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('registers both tools idempotently', () => {
    registerSearchPapers();
    registerSearchPapers();
    expect(toolRegistry.get('search_papers')).toBeDefined();
    expect(toolRegistry.get('get_paper_citations')).toBeDefined();
  });

  it('OpenAlex happy path → ok:true with mapped papers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('api.openalex.org/works');
      return new Response(JSON.stringify({ results: [openAlexHit] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const out = await searchPapersTool.handler({ query: 'prospect theory', topK: 5 }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.papers).toHaveLength(1);
    expect(out.papers[0].title).toBe('Prospect Theory: An Analysis');
    expect(out.papers[0].source).toBe('openalex');
    expect(out.papers[0].authors).toContain('Daniel Kahneman');
    expect(out.fallbackUsed).toBeUndefined();
  });

  it('OpenAlex 500 → fallback to CrossRef → ok:true with source=crossref', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('api.openalex.org')) {
        return new Response('upstream boom', { status: 500 });
      }
      if (url.includes('api.crossref.org')) {
        return new Response(
          JSON.stringify({
            message: {
              items: [
                {
                  DOI: '10.2307/1914185',
                  title: ['Prospect Theory'],
                  author: [{ given: 'Daniel', family: 'Kahneman' }],
                  issued: { 'date-parts': [[1979]] },
                  URL: 'https://doi.org/10.2307/1914185',
                  'is-referenced-by-count': 75000,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error('unexpected url ' + url);
    }));
    const out = await searchPapersTool.handler({ query: 'prospect theory' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.papers[0].source).toBe('crossref');
    expect(out.fallbackUsed).toBe('openalex_then_crossref');
    expect(calls.length).toBe(2);
  });

  it('OpenAlex returns 0 results → fallback to CrossRef', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('api.openalex.org')) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 });
    }));
    const out = await searchPapersTool.handler({ query: 'x' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(calls.length).toBe(2);
  });

  it('both sources fail → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    const out = await searchPapersTool.handler({ query: 'x' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.papers).toEqual([]);
  });

  it('AbortError re-throws', async () => {
    const ac = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const err = new Error('aborted'); err.name = 'AbortError';
          reject(err);
        });
      });
    }));
    const p = searchPapersTool.handler({ query: 'x' }, { ...fakeCtx, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });

  it('yearFrom filter passed to OpenAlex URL', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }));
    await searchPapersTool.handler({ query: 'gdp', yearFrom: 2020 }, fakeCtx);
    // Will fall through to CrossRef due to 0 results — just verify OpenAlex URL had filter
    expect(capturedUrl).toContain('2020');
  });
});

describe('get_paper_citations tool', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('citations happy path → ok:true with list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('cites:');
      return new Response(
        JSON.stringify({ results: [openAlexHit] }),
        { status: 200 },
      );
    }));
    const out = await getPaperCitationsTool.handler({ paperId: 'W123' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].source).toBe('openalex');
  });

  it('empty paperId → ok:false', async () => {
    const out = await getPaperCitationsTool.handler({ paperId: '' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/paperId required/);
  });

  it('OpenAlex 404 → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const out = await getPaperCitationsTool.handler({ paperId: 'W999' }, fakeCtx);
    expect(out.ok).toBe(false);
  });
});

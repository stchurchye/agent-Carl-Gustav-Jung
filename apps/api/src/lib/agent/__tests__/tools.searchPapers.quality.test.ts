import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchPapersTool } from '../tools/searchPapers.js';

/**
 * R1-2(实测驱动):OpenAlex(title_and_abstract 严格匹配)对生造词真返 0,
 * 随后 CrossRef 宽匹配会凑出 5 条低相关结果且无任何信号 —— 大脑会当真。
 * → fallback 时加 quality + note 警示;两边都空 → empty。
 */

const fakeCtx = { signal: new AbortController().signal } as never;

beforeEach(() => {
  vi.stubEnv('OPENALEX_USER_AGENT', 'test');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function openAlexEmptyThenCrossRef(items: unknown[]) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('openalex.org')) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ message: { items } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('R1-2:search_papers 宽匹配 fallback 警示', () => {
  it('OpenAlex 0 → CrossRef 有结果:quality=fallback_loose + note 提醒核对相关性', async () => {
    vi.stubGlobal('fetch', openAlexEmptyThenCrossRef([
      { DOI: '10.1/x', title: ['可能不相关的论文'], author: [], URL: 'https://doi.org/10.1/x' },
    ]));
    const out = await searchPapersTool.handler({ query: '生造词组合' }, fakeCtx) as never as {
      quality?: string; note?: string; papers: unknown[];
    };
    expect(out.quality).toBe('fallback_loose');
    expect(out.note).toMatch(/核对|相关性|换关键词/);
    expect(out.papers.length).toBe(1);
  });

  it('两边都 0 → quality=empty + note 提示换关键词/英文术语', async () => {
    vi.stubGlobal('fetch', openAlexEmptyThenCrossRef([]));
    const out = await searchPapersTool.handler({ query: '生造词组合' }, fakeCtx) as never as {
      quality?: string; note?: string;
    };
    expect(out.quality).toBe('empty');
    expect(out.note).toMatch(/换关键词|英文/);
  });

  it('OpenAlex 直接命中 → quality=ok,无警示 note', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ id: 'https://openalex.org/W1', title: 'T', authorships: [], doi: 'https://doi.org/10.1/y' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    ));
    const out = await searchPapersTool.handler({ query: 'Jungian archetype' }, fakeCtx) as never as {
      quality?: string; note?: string;
    };
    expect(out.quality).toBe('ok');
    expect(out.note).toBeUndefined();
  });
});

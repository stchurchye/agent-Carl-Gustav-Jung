import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type SearchPapersInput = {
  query: string;
  yearFrom?: number;
  topK?: number;
};

type Paper = {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  doi?: string;
  url: string;
  citationCount?: number;
  source: 'openalex' | 'crossref';
};

type SearchPapersOutput = {
  ok: boolean;
  papers: Paper[];
  fallbackUsed?: 'openalex_then_crossref';
  error?: string;
};

type GetPaperCitationsInput = { paperId: string };
type GetPaperCitationsOutput = {
  ok: boolean;
  paperId: string;
  citations: Paper[];
  error?: string;
};

const USER_AGENT =
  process.env.OPENALEX_USER_AGENT?.trim() ||
  'agent-runtime-m2 (mailto:dev@example.com)';
const ABSTRACT_CAP = 1000;
const AUTHORS_CAP = 5;

/**
 * OpenAlex returns `abstract_inverted_index` (token→positions). Reconstruct linear text.
 */
function decodeInvertedAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return '';
  const positions: Array<[number, string]> = [];
  for (const [word, posList] of Object.entries(inv)) {
    for (const p of posList) positions.push([p, word]);
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(' ').slice(0, ABSTRACT_CAP);
}

function mapOpenAlexWork(w: any): Paper {
  const rawId = String(w.id ?? '');
  const id = rawId.replace('https://openalex.org/', '');
  return {
    id,
    title: String(w.title ?? ''),
    authors: (w.authorships ?? [])
      .slice(0, AUTHORS_CAP)
      .map((a: any) => String(a?.author?.display_name ?? ''))
      .filter(Boolean),
    year: w.publication_year ?? undefined,
    abstract: decodeInvertedAbstract(w.abstract_inverted_index),
    doi: typeof w.doi === 'string' ? w.doi.replace('https://doi.org/', '') : undefined,
    url: w.doi || (id ? `https://openalex.org/${id}` : ''),
    citationCount: w.cited_by_count ?? undefined,
    source: 'openalex',
  };
}

function mapCrossRefWork(item: any): Paper {
  return {
    id: String(item.DOI ?? ''),
    title: Array.isArray(item.title) ? String(item.title[0] ?? '') : String(item.title ?? ''),
    authors: (item.author ?? [])
      .slice(0, AUTHORS_CAP)
      .map((a: any) => [a.given, a.family].filter(Boolean).join(' '))
      .filter(Boolean),
    year: item.issued?.['date-parts']?.[0]?.[0],
    doi: item.DOI,
    url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''),
    citationCount: item['is-referenced-by-count'],
    source: 'crossref',
  };
}

async function queryOpenAlex(
  query: string,
  yearFrom: number | undefined,
  topK: number,
  signal: AbortSignal,
): Promise<Paper[]> {
  // 用 title_and_abstract.search(只在标题+摘要里匹配)而非宽泛 search=(含全文+所有字段)。
  // 宽泛 search 对长自然语句 + 多义词(archetype/shadow)会被跨领域高频词冲淹,召不准;
  // 限定标题+摘要 + 按 relevance_score 排,niche 主题(如荣格)精确率显著提升(实测 3/5 vs 1/5)。
  const filters = [`title_and_abstract.search:${query}`];
  if (yearFrom) filters.push(`from_publication_date:${yearFrom}-01-01`);
  const params = new URLSearchParams({
    filter: filters.join(','),
    'per-page': String(topK),
    sort: 'relevance_score:desc',
  });
  const url = `https://api.openalex.org/works?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  const json = (await res.json()) as { results?: any[] };
  return (json.results ?? []).map(mapOpenAlexWork);
}

async function queryCrossRef(
  query: string,
  topK: number,
  signal: AbortSignal,
  yearFrom?: number,
): Promise<Paper[]> {
  const params = new URLSearchParams({ query, rows: String(topK) });
  if (yearFrom) params.set('filter', `from-pub-date:${yearFrom}`);
  const url = `https://api.crossref.org/works?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`CrossRef HTTP ${res.status}`);
  const json = (await res.json()) as { message?: { items?: any[] } };
  return (json.message?.items ?? []).map(mapCrossRefWork);
}

export const searchPapersTool: ToolDef<SearchPapersInput, SearchPapersOutput> = {
  name: 'search_papers',
  description:
    'Search academic papers (OpenAlex title+abstract; CrossRef fallback). Use for theory names ("prospect theory"), author+topic, "is there empirical evidence for X". ' +
    'IMPORTANT: use 2-4 SPECIFIC terms (e.g. "Jungian archetype", "Kahneman prospect theory"), NOT long natural-language sentences — generic words (empirical/evidence/theory/research) dilute relevance and pull in off-domain papers. Prefer over search_web for academic claims.',
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string' },
      yearFrom: { type: 'number', minimum: 1900, maximum: 2100 },
      topK: { type: 'number', minimum: 1, maximum: 20 },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'list',
    failureHint:
      'OpenAlex / CrossRef 都失败可能是网络或上游故障。可换关键词；如学术词不出结果可改 search_web 走通用搜索。',
  },
  computeIdempotencyKey: (input) => {
    const i = input as SearchPapersInput;
    return `q:${i.query.trim().toLowerCase()}|yf:${i.yearFrom ?? 0}|n:${i.topK ?? 10}`;
  },
  async handler(input, ctx) {
    const topK = Math.max(1, Math.min(input.topK ?? 10, 20));
    try {
      const papers = await queryOpenAlex(input.query, input.yearFrom, topK, ctx.signal);
      if (papers.length > 0) {
        return { ok: true, papers };
      }
      // 0 hits → fall through to CrossRef
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      // fall through to CrossRef
    }

    try {
      const papers = await queryCrossRef(input.query, topK, ctx.signal, input.yearFrom);
      return { ok: true, papers, fallbackUsed: 'openalex_then_crossref' };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        papers: [],
        fallbackUsed: 'openalex_then_crossref',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export const getPaperCitationsTool: ToolDef<
  GetPaperCitationsInput,
  GetPaperCitationsOutput
> = {
  name: 'get_paper_citations',
  description:
    'Fetch papers citing a given OpenAlex Work ID (W-prefixed, e.g. "W123456789"). Returns up to 20 citing papers. Use to trace influence, find rebuttals, evaluate consensus.',
  inputSchema: {
    type: 'object',
    required: ['paperId'],
    properties: { paperId: { type: 'string' } },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'list',
    failureHint:
      '论文 ID 可能不存在或非 OpenAlex 格式（W 开头）。可先用 search_papers 拿到合法 id 再查引用。',
  },
  async handler(input, ctx) {
    const id = input.paperId?.trim();
    if (!id) return { ok: false, paperId: '', citations: [], error: 'paperId required' };
    try {
      const url = `https://api.openalex.org/works?filter=cites:${encodeURIComponent(id)}&per-page=20`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: ctx.signal,
      });
      if (!res.ok) {
        return { ok: false, paperId: id, citations: [], error: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as { results?: any[] };
      return {
        ok: true,
        paperId: id,
        citations: (json.results ?? []).map(mapOpenAlexWork),
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        paperId: id,
        citations: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerSearchPapers(): void {
  if (!toolRegistry.get(searchPapersTool.name)) toolRegistry.register(searchPapersTool);
  if (!toolRegistry.get(getPaperCitationsTool.name)) toolRegistry.register(getPaperCitationsTool);
}

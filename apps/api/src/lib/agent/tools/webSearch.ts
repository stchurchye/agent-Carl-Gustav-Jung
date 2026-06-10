import { SEARCH_REF_TOP_N, toolRegistry, type ToolDef } from '../toolRegistry.js';

type WebSearchInput = {
  query: string;
  maxResults?: number;
  /** R1:Tavily 检索深度。advanced 实测多出学术源、正文更长(贵 1 credit),深研究场景用。 */
  searchDepth?: 'basic' | 'advanced';
};

type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  /** R1-2:Tavily 相关性分(实测垃圾<0.2、正经>0.7),透传让大脑自行判别。 */
  score?: number;
};

type WebSearchOutput = {
  ok: boolean;
  results: WebSearchHit[];
  /** R1:Tavily include_answer 的一段直接概括(实测中文质量不错),免费信息直送大脑。 */
  answer?: string;
  /**
   * R1-2 质量信号(实测驱动):生造词/错词 query 实测不返 0 条,而是一批 score<0.2 的
   * 不相关垃圾 —— "搜错东西"比"搜不到"更隐蔽。机器可读,供 planner/refine 门消费。
   */
  quality?: 'ok' | 'low_relevance' | 'empty';
  note?: string;
  error?: string;
};

/** 全部结果 score 低于此值 → 判 low_relevance(实测垃圾 0.03-0.17,正经 0.72-0.87)。 */
const LOW_RELEVANCE_SCORE = 0.3;

/**
 * R1(实测驱动):snippet 上限 300→1000。真 Tavily 探针显示正文常返 1200-2400 字,
 * 截 300 等于把已付费拿到的内容丢 75%;1000 字在 checkpoint digestTail 的每步预算内。
 */
const SNIPPET_MAX_CHARS = 1000;

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/**
 * 通用网页搜索（Tavily）。Tier A：auto + read-only。
 *
 * 未配置 `TAVILY_API_KEY` 时不抛错，返回 `{ results: [], note: '搜索未配置' }`，
 * 让 planner 改用 magi_system_read 或直接给 finalReply。
 */
export const webSearchTool: ToolDef<WebSearchInput, WebSearchOutput> = {
  name: 'search_web',
  description:
    'Search the public web (Tavily). Use for current events, news, blog posts, or non-academic topics. For academic papers and empirical claims, prefer search_papers.',
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string' },
      maxResults: { type: 'number', minimum: 1, maximum: 10 },
      searchDepth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description:
          'basic(默认,快/便宜)适合一般查询;advanced 返回更长正文与更多学术/深度来源,需要深入研究某主题时用',
      },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'list',
    // P0-S7:top-3 结果产 url ref(进终稿"资源清单"与 checkpoint),限量防 ref 洪水。
    extractRefs: (output) => {
      const results = (output as { results?: WebSearchHit[] } | null)?.results ?? [];
      return results
        .filter((r) => typeof r?.url === 'string' && r.url.length > 0)
        .slice(0, SEARCH_REF_TOP_N)
        .map((r) => ({ kind: 'url' as const, id: r.url, label: r.title || r.url }));
    },
    failureHint: '搜索可能限流或网络故障。可换关键词重试一次；连续失败请改走 magi_system_read 或直接给 finalReply。',
  },
  computeIdempotencyKey: (input) => {
    const { query, maxResults, searchDepth } = input as WebSearchInput;
    // depth 纳入 key:advanced 与 basic 结果集不同,不能互相复用缓存。
    return `q:${query.trim().toLowerCase()}|n:${maxResults ?? 5}|d:${searchDepth ?? 'basic'}`;
  },
  async handler(input, ctx) {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      return { ok: true, results: [], note: '搜索未配置（缺 TAVILY_API_KEY）' };
    }
    const maxResults = Math.max(1, Math.min(input.maxResults ?? 5, 10));
    try {
      const res = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: input.query,
          max_results: maxResults,
          search_depth: input.searchDepth ?? 'basic',
          // R1:免费的一段概括(实测中文质量好),透传给大脑直接用。
          include_answer: true,
        }),
        signal: ctx.signal,
      });
      if (!res.ok) {
        return {
          ok: false,
          results: [],
          error: `Tavily HTTP ${res.status}`,
        };
      }
      const json = (await res.json()) as {
        answer?: string;
        results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
      };
      const results: WebSearchHit[] = (json.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: (r.content ?? '').slice(0, SNIPPET_MAX_CHARS),
        ...(typeof r.score === 'number' ? { score: r.score } : {}),
      }));

      // R1-2 质量分级(实测驱动,见 type 注释)
      if (results.length === 0) {
        return {
          ok: true,
          results,
          quality: 'empty' as const,
          note: '0 结果:换关键词(同义词/更宽泛/另一语言)再试,不要原样重试。',
        };
      }
      const scores = results.map((r) => r.score).filter((s): s is number => typeof s === 'number');
      const allLow = scores.length > 0 && scores.every((s) => s < LOW_RELEVANCE_SCORE);
      if (allLow) {
        // answer 在低相关时是幻觉源(实测会对生造词一本正经编解释),丢弃不透传。
        return {
          ok: true,
          results,
          quality: 'low_relevance' as const,
          note: `结果相关度极低(最高 score=${Math.max(...scores).toFixed(2)}),很可能没搜到真正相关的内容——不要采信这些结果,换关键词或换语言重试。`,
        };
      }
      return {
        ok: true,
        results,
        quality: 'ok' as const,
        ...(typeof json.answer === 'string' && json.answer.length > 0
          ? { answer: json.answer }
          : {}),
      };
    } catch (e) {
      // M1f #3：AbortError 透传，让 runtime 看到 cancel；其他 error 转 soft-fail。
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        results: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerWebSearch(): void {
  if (!toolRegistry.get(webSearchTool.name)) {
    toolRegistry.register(webSearchTool);
  }
}

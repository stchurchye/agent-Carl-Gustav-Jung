import { SEARCH_REF_TOP_N, toolRegistry, type ToolDef } from '../toolRegistry.js';
import type { SearchQuality } from '../types.js';

type WebSearchInput = {
  /** 单查询(与 queries 二选一,queries 优先)。 */
  query?: string;
  /** R3-1:查询扇出 —— 一步并行发 1-4 个查询(如中英双语两路),结果按 URL 去重合并。 */
  queries?: string[];
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
  /** R3-1:扇出模式下,该结果命中了哪些查询(跨查询同 URL 合并时累积)。 */
  matchedQueries?: string[];
};

/** R3-1:单步扇出查询数上限(Tavily 限流与成本的现实约束)。 */
const FANOUT_MAX_QUERIES = 4;

type WebSearchOutput = {
  ok: boolean;
  results: WebSearchHit[];
  /** R1:Tavily include_answer 的一段直接概括(实测中文质量不错),免费信息直送大脑。 */
  answer?: string;
  /**
   * R1-2 质量信号(实测驱动):生造词/错词 query 实测不返 0 条,而是一批 score<0.2 的
   * 不相关垃圾 —— "搜错东西"比"搜不到"更隐蔽。机器可读,供 planner/refine 门消费。
   */
  quality?: SearchQuality;
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
    'Search the public web (Tavily). Use for current events, news, blog posts, or non-academic topics. For academic papers and empirical claims, prefer search_papers. ' +
    'TIP: pass `queries` (up to 4) to fan out multiple query variants in ONE step — e.g. the same topic in Chinese AND English — results are merged and deduplicated.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '单查询(与 queries 二选一)' },
      queries: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 4,
        description: '查询扇出:一步并行发多个查询变体(推荐同主题中文+英文各一路),结果合并去重',
      },
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
    const { query, queries, maxResults, searchDepth } = input as WebSearchInput;
    // R3-1:queries 排序归一(顺序无关同 key);单 query 与单元素 queries 等价。
    // depth 纳入 key:advanced 与 basic 结果集不同,不能互相复用缓存。
    const qs = (queries && queries.length > 0 ? queries : [query ?? ''])
      .map((q) => q.trim().toLowerCase())
      .sort()
      .join('');
    return `q:${qs}|n:${maxResults ?? 5}|d:${searchDepth ?? 'basic'}`;
  },
  async handler(input, ctx) {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      return { ok: true, results: [], note: '搜索未配置（缺 TAVILY_API_KEY）' };
    }
    const maxResults = Math.max(1, Math.min(input.maxResults ?? 5, 10));
    const depth = input.searchDepth ?? 'basic';
    const queries = (input.queries && input.queries.length > 0
      ? input.queries
      : [input.query ?? '']
    )
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, FANOUT_MAX_QUERIES);
    if (queries.length === 0) {
      return { ok: false, results: [], error: 'query/queries 至少要有一个非空查询' };
    }
    const isFanout = queries.length > 1;

    // R3-1:handler 内并行扇出(主循环零侵入:1 个 plan step = 1 条 step 记录,
    // 记账/审计/幂等全维持)。单查询 = 单元素扇出,路径统一。
    const settled = await Promise.all(
      queries.map(async (q) => {
        try {
          return { q, ...(await searchTavilyOnce(q, apiKey, maxResults, depth, ctx.signal)) };
        } catch (e) {
          // M1f #3:AbortError 透传,让 runtime 看到 cancel;其他 error 记为该路失败。
          if (e instanceof Error && e.name === 'AbortError') throw e;
          return { q, hits: null, answer: undefined, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );

    const failed = settled.filter((s) => s.hits == null);
    const succeeded = settled.filter((s) => s.hits != null);
    if (succeeded.length === 0) {
      return {
        ok: false,
        results: [],
        error: failed.map((f) => `"${f.q}": ${f.error}`).join('; '),
      };
    }

    // 跨查询按 URL 去重合并;扇出模式标注 matchedQueries(同 URL 多查询命中时累积)。
    const byUrl = new Map<string, WebSearchHit>();
    for (const s of succeeded) {
      for (const hit of s.hits!) {
        const existing = byUrl.get(hit.url);
        if (existing) {
          if (isFanout) existing.matchedQueries = [...(existing.matchedQueries ?? []), s.q];
          if ((hit.score ?? 0) > (existing.score ?? 0)) existing.score = hit.score;
        } else {
          byUrl.set(hit.url, { ...hit, ...(isFanout ? { matchedQueries: [s.q] } : {}) });
        }
      }
    }
    const results = [...byUrl.values()];
    const partialNote =
      failed.length > 0 ? `${failed.length} 路查询失败(${failed.map((f) => f.q).join('、')}),以下为其余查询的结果。` : '';

    // R1-2 质量分级(实测驱动,见 type 注释)
    if (results.length === 0) {
      return {
        ok: true,
        results,
        quality: 'empty' as const,
        note: `${partialNote}0 结果:换关键词(同义词/更宽泛/另一语言)再试,不要原样重试。`,
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
        note: `${partialNote}结果相关度极低(最高 score=${Math.max(...scores).toFixed(2)}),很可能没搜到真正相关的内容——不要采信这些结果,换关键词或换语言重试。`,
      };
    }
    // review 修正:混合质量 —— 有好结果时把 score<阈值 的垃圾条目滤掉(纯噪声,
    // 实测好结果 >0.7、垃圾 <0.2,混入会让大脑当真),note 透出滤除数。
    const kept = results.filter(
      (r) => typeof r.score !== 'number' || r.score >= LOW_RELEVANCE_SCORE,
    );
    const dropped = results.length - kept.length;
    const filterNote = dropped > 0 ? `已滤除 ${dropped} 条低相关(score<${LOW_RELEVANCE_SCORE})结果。` : '';

    // answer 仅单查询模式透传:扇出时各路 answer 各答各的 query,拼接是噪声。
    const answer = !isFanout ? succeeded[0].answer : undefined;
    const note = `${partialNote}${filterNote}`;
    return {
      ok: true,
      results: kept,
      quality: 'ok' as const,
      ...(note ? { note } : {}),
      ...(typeof answer === 'string' && answer.length > 0 ? { answer } : {}),
    };
  },
};

/** 单次 Tavily 调用:返回 hits + answer;HTTP 非 2xx 抛错(由扇出层按路记失败)。 */
async function searchTavilyOnce(
  query: string,
  apiKey: string,
  maxResults: number,
  depth: 'basic' | 'advanced',
  signal: AbortSignal,
): Promise<{ hits: WebSearchHit[]; answer?: string }> {
  const res = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: depth,
      // R1:免费的一段概括(实测中文质量好),透传给大脑直接用。
      include_answer: true,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const json = (await res.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
  };
  return {
    hits: (json.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: (r.content ?? '').slice(0, SNIPPET_MAX_CHARS),
      ...(typeof r.score === 'number' ? { score: r.score } : {}),
    })),
    answer: json.answer,
  };
}

export function registerWebSearch(): void {
  if (!toolRegistry.get(webSearchTool.name)) {
    toolRegistry.register(webSearchTool);
  }
}

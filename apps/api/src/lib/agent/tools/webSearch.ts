import { SEARCH_REF_TOP_N, toolRegistry, type ToolDef } from '../toolRegistry.js';

type WebSearchInput = {
  query: string;
  maxResults?: number;
};

type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

type WebSearchOutput = {
  ok: boolean;
  results: WebSearchHit[];
  note?: string;
  error?: string;
};

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
    const { query, maxResults } = input as WebSearchInput;
    return `q:${query.trim().toLowerCase()}|n:${maxResults ?? 5}`;
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
          search_depth: 'basic',
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
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      const results: WebSearchHit[] = (json.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: (r.content ?? '').slice(0, 300),
      }));
      return { ok: true, results };
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

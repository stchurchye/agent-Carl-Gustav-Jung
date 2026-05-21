import { toolRegistry, type ToolDef } from '../toolRegistry.js';

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
  results: WebSearchHit[];
  note?: string;
};

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/**
 * 通用网页搜索（Tavily）。Tier A：auto + read-only。
 *
 * 未配置 `TAVILY_API_KEY` 时不抛错，返回 `{ results: [], note: '搜索未配置' }`，
 * 让 planner 改用 magi_system_read 或直接给 finalReply。
 */
export const webSearchTool: ToolDef<WebSearchInput, WebSearchOutput> = {
  name: 'web_search',
  description:
    'Search the public web for fresh information. Use when the user asks about something that may need current external context.',
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
    failureHint: '搜索可能限流或网络故障。可换关键词重试一次；连续失败请改走 magi_system_read 或直接给 finalReply。',
  },
  computeIdempotencyKey: (input) => {
    const { query, maxResults } = input as WebSearchInput;
    return `q:${query.trim().toLowerCase()}|n:${maxResults ?? 5}`;
  },
  async handler(input, ctx) {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      return { results: [], note: '搜索未配置（缺 TAVILY_API_KEY）' };
    }
    const maxResults = Math.max(1, Math.min(input.maxResults ?? 5, 10));
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
      throw new Error(`Tavily HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const results: WebSearchHit[] = (json.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: (r.content ?? '').slice(0, 300),
    }));
    return { results };
  },
};

export function registerWebSearch(): void {
  if (!toolRegistry.get(webSearchTool.name)) {
    toolRegistry.register(webSearchTool);
  }
}

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type UrlFetchInput = {
  url: string;
  maxChars?: number;
};

type UrlFetchOutput = {
  url: string;
  title: string;
  excerpt: string;
  text: string;
  truncated: boolean;
};

const DEFAULT_MAX_CHARS = 8000;
const FETCH_TIMEOUT_MS = 30_000;

/**
 * 抓取 URL 并用 Mozilla Readability 提取正文。Tier A：auto + read-only。
 *
 * - 失败抛错（由 runtime 重试一次或 replan）。
 * - 用 `maxChars` 截断 text，避免吃满 LLM context。
 */
export const urlFetchTool: ToolDef<UrlFetchInput, UrlFetchOutput> = {
  name: 'url_fetch',
  description:
    'Download a URL and extract its main readable text. Use after web_search to deeply read a result.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string' },
      maxChars: { type: 'number', minimum: 500, maximum: 30000 },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  computeIdempotencyKey: (input) => `url:${(input as UrlFetchInput).url.trim()}`,
  async handler(input, ctx) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    // 串行响应外层 cancel
    const onOuterAbort = () => ac.abort();
    ctx.signal.addEventListener('abort', onOuterAbort, { once: true });
    try {
      const res = await fetch(input.url, {
        method: 'GET',
        signal: ac.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; XingdongZhongzhipai-Agent/0.1; +https://example.invalid)',
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${input.url}`);
      }
      const html = await res.text();
      const dom = new JSDOM(html, { url: input.url });
      const article = new Readability(dom.window.document).parse();
      const rawText = (article?.textContent ?? '').trim();
      const max = Math.max(500, Math.min(input.maxChars ?? DEFAULT_MAX_CHARS, 30_000));
      const truncated = rawText.length > max;
      return {
        url: input.url,
        title: article?.title ?? '',
        excerpt: (article?.excerpt ?? '').slice(0, 300),
        text: truncated ? rawText.slice(0, max) : rawText,
        truncated,
      };
    } finally {
      clearTimeout(t);
      ctx.signal.removeEventListener('abort', onOuterAbort);
    }
  },
};

export function registerUrlFetch(): void {
  if (!toolRegistry.get(urlFetchTool.name)) {
    toolRegistry.register(urlFetchTool);
  }
}

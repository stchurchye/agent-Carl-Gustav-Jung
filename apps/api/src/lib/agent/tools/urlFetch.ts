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
// M1e Task 13.1：HTML 上限 4MB。超过会 abort，避免一个恶意/大 URL 把 worker 内存打爆。
const MAX_BYTES = 4 * 1024 * 1024;
// M1e Task 13.1：只接受 text/html 系列 + text/plain。pdf/video/zip 等先 reject，
// M2 真要 pdf_reader 之类再走专门工具。
const ALLOWED_CT = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

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
  replyMeta: {
    summaryKind: 'text',
    failureHint: '该 URL 可能 404 / 超时 / 非 HTML。可跳过此 URL 用其他搜索结果，或换 web_search 重新搜更可靠的来源。',
  },
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
      // M1e Task 13.1：内容类型守卫 + 大小上限（header + 真实读流双重防御）
      const ct = res.headers.get('content-type') ?? '';
      if (ct && !ALLOWED_CT.test(ct)) {
        throw new Error(`unsupported content-type: ${ct}`);
      }
      const clHeader = res.headers.get('content-length');
      const cl = clHeader ? Number(clHeader) : 0;
      if (cl > 0 && cl > MAX_BYTES) {
        throw new Error(`payload too large per content-length: ${cl} > ${MAX_BYTES}`);
      }

      const html = await readBodyWithCap(res, MAX_BYTES);
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

/**
 * 边读边累计字节数，超阈值 abort 并 cancel reader。返回 utf-8 文本。
 * @internal exported for tests.
 */
export async function readBodyWithCap(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let html = '';
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new Error(
          `payload exceeded MAX_BYTES (${maxBytes}) at ${bytes} bytes; aborting`,
        );
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return html;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

export function registerUrlFetch(): void {
  if (!toolRegistry.get(urlFetchTool.name)) {
    toolRegistry.register(urlFetchTool);
  }
}

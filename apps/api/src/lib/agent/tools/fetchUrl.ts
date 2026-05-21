import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type FetchUrlInput = { url: string };

type FetchUrlOutput = {
  ok: boolean;
  url: string;
  title: string;
  content: string;
  truncated: boolean;
  error?: string;
};

const MAX_CHARS = 24 * 1024;

/**
 * 解析 Jina Reader 返回的 markdown 文本。
 * r.jina.ai 在正文前加元数据行（"Title: ...", "URL Source: ..."），
 * 后跟空行，再是正文。
 */
function parseJinaResponse(raw: string): { title: string; body: string } {
  const lines = raw.split('\n');
  let title = '';
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Title: ')) {
      title = line.slice(7).trim();
    } else if (line.trim() === '') {
      i++;
      break;
    } else if (!/^(URL Source|Markdown Content|Content-Length|X-|Published Time):/i.test(line)) {
      // 遇到非元数据行且非空行 → 元数据结束
      break;
    }
  }
  return { title, body: lines.slice(i).join('\n').trim() };
}

export const fetchUrlTool: ToolDef<FetchUrlInput, FetchUrlOutput> = {
  name: 'fetch_url',
  description:
    'Fetch a URL and extract its readable content as markdown (via Jina Reader). Use after search_web / search_papers to deeply read a result, or when the user pastes a link. Does not support PDF/binary — use document_reader for those.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string' } },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'text',
    extractRef: (output: unknown) => {
      const o = output as FetchUrlOutput;
      if (!o?.ok || !o.url) return null;
      return { kind: 'url' as const, id: o.url, label: o.title || o.url };
    },
    failureHint:
      '该 URL 可能 404 / 超时 / Jina 限流。可跳过此 URL 用其他搜索结果；PDF 改用 document_reader；学术摘要改用 search_papers。',
  },
  computeIdempotencyKey: (input) => `url:${(input as FetchUrlInput).url.trim()}`,
  async handler(input, ctx) {
    const jinaUrl = `https://r.jina.ai/${input.url}`;
    const apiKey = process.env.JINA_API_KEY?.trim();
    const headers: Record<string, string> = {
      Accept: 'text/plain',
      'X-With-Links-Summary': 'true',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    try {
      const res = await fetch(jinaUrl, { headers, signal: ctx.signal });
      if (!res.ok) {
        return { ok: false, url: input.url, title: '', content: '', truncated: false,
          error: `HTTP ${res.status} from Jina Reader` };
      }
      const raw = await res.text();
      const { title, body } = parseJinaResponse(raw);
      const truncated = body.length > MAX_CHARS;
      return {
        ok: true,
        url: input.url,
        title,
        content: truncated ? body.slice(0, MAX_CHARS) : body,
        truncated,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return { ok: false, url: input.url, title: '', content: '', truncated: false,
        error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export function registerFetchUrl(): void {
  if (!toolRegistry.get(fetchUrlTool.name)) {
    toolRegistry.register(fetchUrlTool);
  }
}

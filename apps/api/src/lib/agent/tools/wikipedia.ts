import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type WikipediaInput = {
  title: string;
  lang?: string;
};

type WikipediaOutput = {
  ok: boolean;
  title: string;
  lang: string;
  summary: string;
  url: string;
  pageId: number;
  error?: string;
};

function detectLang(title: string): string {
  return /[\u3400-\u9fff]/.test(title) ? 'zh' : 'en';
}

export const wikipediaTool: ToolDef<WikipediaInput, WikipediaOutput> = {
  name: 'wikipedia',
  description:
    'Look up a Wikipedia article by title. Returns a 1-2 paragraph summary. Use for concept definitions, background context, biographies, historical events. Auto-detects language (CJK → zh, otherwise en); pass `lang` to override.',
  inputSchema: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
      lang: { type: 'string', minLength: 2, maxLength: 5 },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'text',
    extractRef: (output: unknown) => {
      const o = output as WikipediaOutput;
      if (!o?.ok || !o.url) return null;
      return { kind: 'url' as const, id: o.url, label: `Wikipedia: ${o.title}` };
    },
    failureHint:
      'Wikipedia 失败可能是词条不存在 / 标题拼写错。可改 search_web 找正确标题再调；中文词条不全时 fallback en lang。',
  },
  computeIdempotencyKey: (input) => `wiki:${(input as WikipediaInput).lang ?? 'auto'}:${(input as WikipediaInput).title.trim()}`,
  async handler(input, ctx) {
    const lang = input.lang ?? detectLang(input.title);
    const encoded = encodeURIComponent(input.title.replace(/ /g, '_'));
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
    try {
      const res = await fetch(url, { signal: ctx.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        return {
          ok: false, title: input.title, lang, summary: '', url: '', pageId: 0,
          error: `HTTP ${res.status} for ${input.title} (${lang})`,
        };
      }
      const json = (await res.json()) as {
        title?: string;
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
        pageid?: number;
      };
      return {
        ok: true,
        title: String(json.title ?? input.title),
        lang,
        summary: String(json.extract ?? '').slice(0, 2048),
        url: json.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encoded}`,
        pageId: Number(json.pageid ?? 0),
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false, title: input.title, lang, summary: '', url: '', pageId: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerWikipedia(): void {
  if (!toolRegistry.get(wikipediaTool.name)) {
    toolRegistry.register(wikipediaTool);
  }
}

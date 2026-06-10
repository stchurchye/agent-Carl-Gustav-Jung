import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { listDocuments } from '../../../store/pg.js';

type ReadDocumentInput = {
  titleQuery: string;
};

type ReadDocumentOutput = {
  ok: boolean;
  matches: Array<{ documentId: string; title: string }>;
  /** 最佳匹配(标题最短 = 最精确)的正文,截 8K。 */
  title?: string;
  documentId?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
};

const CONTENT_MAX = 8 * 1024;
const MATCHES_MAX = 10;

/**
 * K7:读回写作区文档 —— 覆盖 deep_research 自动存档的《研究报告：…》与
 * doc_export_markdown 导出的文档。"基于上次那份报告继续深入"的读侧。
 *
 * 索引常驻 + 正文按需的共识模式:finding(可检索摘要)在 MAGI 向量库,
 * 报告全文在 documents 按 title 取 —— 不给 documents 建向量索引
 * (几十篇量级 title 包含匹配足够)。只读、owner 锁、fail-open。
 */
export const readDocumentTool: ToolDef<ReadDocumentInput, ReadDocumentOutput> = {
  name: 'read_document',
  description:
    "Read back a document from the user's writing workspace by title (substring match) — including auto-archived deep research reports (《研究报告：…》) and previously exported docs. Use when the user refers to a past report/document (\"基于上次那份报告\"). Returns matched titles and the best match's content.",
  inputSchema: {
    type: 'object',
    required: ['titleQuery'],
    properties: {
      titleQuery: { type: 'string', minLength: 1, description: '标题(或其中的关键词)' },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  computeIdempotencyKey: (input) =>
    `readdoc:${(input as ReadDocumentInput).titleQuery.trim().toLowerCase().slice(0, 256)}`,
  replyMeta: {
    summaryKind: 'text',
    failureHint: '文档读取失败一般是 DB 故障;也可能该文档不存在 —— 可用 recall_memory 查相关结论代替全文。',
  },
  async handler(input, ctx) {
    try {
      const q = input.titleQuery.trim().toLowerCase();
      // owner 锁 ctx.ownerId —— 绝不信 input
      const all = await listDocuments(ctx.ownerId);
      const visible = all.filter((d) => !d.hiddenAt && d.title.toLowerCase().includes(q));
      const matches = visible
        .slice(0, MATCHES_MAX)
        .map((d) => ({ documentId: d.id, title: d.title }));
      if (visible.length === 0) {
        return { ok: true, matches: [] };
      }
      // 最佳匹配 = 标题最短(包含同一 query 时,短标题更接近精确命中)
      const best = [...visible].sort((a, b) => a.title.length - b.title.length)[0]!;
      const raw = best.chapters?.[0]?.blocks?.[0]?.content ?? '';
      const truncated = raw.length > CONTENT_MAX;
      return {
        ok: true,
        matches,
        title: best.title,
        documentId: best.id,
        content: truncated ? raw.slice(0, CONTENT_MAX) : raw,
        truncated,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return { ok: false, matches: [], error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export function registerReadDocument(): void {
  if (!toolRegistry.get(readDocumentTool.name)) {
    toolRegistry.register(readDocumentTool);
  }
}

import { createHash } from 'crypto';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import {
  createDocument,
  listDocuments,
  updateDocument,
  saveDocumentContent,
} from '../../../store/pg.js';

type DocExportMarkdownInput = {
  title: string;
  markdown: string;
};

type DocExportMarkdownOutput = {
  documentId: string;
  title: string;
  created: boolean;
};

/**
 * 把 markdown 写成「写作」页里的一篇文档。
 *
 * 行为：
 * - 按 (ownerId, title) 做 upsert：同 ownerId 已有同 title 文档则覆盖第一块内容；
 *   没有则 createDocument 后填入。
 * - approvalMode 设 `auto`：写自己的私有文档库，不需要每次都问；
 *   M1d 可在 topic_skill 里临时改成 ask。
 * - 幂等：runtime idempotency gate 会按 (ownerId, title) 哈希阻止同 run 重复写。
 *
 * Tier B：hasSideEffects=true（写入 documents 表），idempotent=true（同 title 覆盖）。
 */
export const docExportMarkdownTool: ToolDef<
  DocExportMarkdownInput,
  DocExportMarkdownOutput
> = {
  name: 'doc_export_markdown',
  description:
    'Save markdown as a document in the user\'s writing workspace. Upserts by title within the owner\'s docs.',
  inputSchema: {
    type: 'object',
    required: ['title', 'markdown'],
    properties: {
      title: { type: 'string', minLength: 1 },
      markdown: { type: 'string' },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: true,
  idempotent: true,
  computeIdempotencyKey: (input) => {
    const { title } = input as DocExportMarkdownInput;
    return (
      'doc:' +
      createHash('sha256').update(title.trim().toLowerCase()).digest('hex')
    );
  },
  async handler(input, ctx) {
    const title = input.title.trim();
    const ownerId = ctx.ownerId;

    // upsert by (ownerId, exact title)
    const existing = (await listDocuments(ownerId)).find(
      (d) => d.title === title && !d.hiddenAt,
    );

    let docId: string;
    let created = false;

    if (existing) {
      docId = existing.id;
    } else {
      const doc = await createDocument(ownerId, title);
      docId = doc.id;
      created = true;
    }

    // 把 markdown 写到第一章第一块
    const fresh = (await listDocuments(ownerId)).find((d) => d.id === docId);
    const chapter = fresh?.chapters[0];
    const block = chapter?.blocks[0];
    if (chapter && block) {
      await saveDocumentContent(ownerId, docId, chapter.id, block.id, input.markdown);
    } else {
      // Fallback: 仅更新 globalSummary 字段
      await updateDocument(ownerId, docId, { globalSummary: input.markdown });
    }

    return { documentId: docId, title, created };
  },
};

export function registerDocExportMarkdown(): void {
  if (!toolRegistry.get(docExportMarkdownTool.name)) {
    toolRegistry.register(docExportMarkdownTool);
  }
}

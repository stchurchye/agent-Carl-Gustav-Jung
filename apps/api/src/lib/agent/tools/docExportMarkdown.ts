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
  /** 写入实际使用的 title（命中用户编辑保护时可能是 "原 title v2"）。 */
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
    const newHash = createHash('sha256').update(input.markdown).digest('hex');

    // upsert by (ownerId, exact title)
    const all = await listDocuments(ownerId);
    const existing = all.find((d) => d.title === title && !d.hiddenAt);

    let docId: string;
    let created = false;
    let versionedTitle = title;

    if (existing) {
      // M1e Task 13.2：用户编辑保护。如果当前 block.content 的 hash 与上次 agent
      // 写入时存的 hash 不一致，说明用户改过文档。这次不覆盖，改成创建一个 v2 标题
      // 的新文档，并 emit DOC_EXPORT_VERSIONED notice 告诉用户。
      const lastHash = existing.agentLastExportHash ?? null;
      const currentText =
        existing.chapters?.[0]?.blocks?.[0]?.content ?? '';
      const currentHash = currentText
        ? createHash('sha256').update(currentText).digest('hex')
        : null;
      const userEdited = lastHash !== null && currentHash !== null && lastHash !== currentHash;

      if (userEdited) {
        versionedTitle = await pickVersionedTitle(all, title);
        const doc = await createDocument(ownerId, versionedTitle);
        docId = doc.id;
        created = true;
        const { emitNotice } = await import('../notices.js');
        await emitNotice({
          runId: ctx.runId,
          severity: 'info',
          code: 'DOC_EXPORT_VERSIONED',
          message: `检测到《${title}》已被你编辑过，本次写入存为新文档《${versionedTitle}》，未覆盖你原稿。`,
          context: { originalDocumentId: existing.id, versionedTitle },
        });
      } else {
        docId = existing.id;
      }
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
    // M1e Task 13.2：记录本次 agent 写入的 hash，下次再调本工具时用于检测用户编辑。
    await updateDocument(ownerId, docId, { agentLastExportHash: newHash });

    return { documentId: docId, title: versionedTitle, created };
  },
};

/**
 * 在已有 doc list 里找一个不冲突的 v2/v3/... 标题。
 * @internal exported for tests.
 */
export function pickVersionedTitle(
  existingDocs: Array<{ title: string }>,
  baseTitle: string,
): string {
  const taken = new Set(existingDocs.map((d) => d.title));
  for (let v = 2; v < 100; v++) {
    const candidate = `${baseTitle} v${v}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${baseTitle} v${Date.now()}`;
}

export function registerDocExportMarkdown(): void {
  if (!toolRegistry.get(docExportMarkdownTool.name)) {
    toolRegistry.register(docExportMarkdownTool);
  }
}

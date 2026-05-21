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
  ok: boolean;
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
  replyMeta: {
    summaryKind: 'export_ref',
    extractRef: (output) => {
      const o = output as { documentId?: string; title?: string } | null;
      if (!o?.documentId) return null;
      return { kind: 'document', id: o.documentId, label: o.title };
    },
    failureHint: '文档写入失败一般是 DB 故障。可重试一次；如失败 2 次请直接在 finalReply 里把 markdown 内容贴出来给用户。',
  },
  computeIdempotencyKey: (input) => {
    const { title } = input as DocExportMarkdownInput;
    return (
      'doc:' +
      createHash('sha256').update(title.trim().toLowerCase()).digest('hex')
    );
  },
  async handler(input, ctx) {
    // M1f #3：cancel signal audit。pg driver 不接 signal，只能在长 await 间穿插 check。
    if (ctx.signal.aborted) throw new Error('aborted');
    const title = input.title.trim();
    const ownerId = ctx.ownerId;
    const newHash = createHash('sha256').update(input.markdown).digest('hex');

    // upsert by (ownerId, exact title)
    const all = await listDocuments(ownerId);
    if (ctx.signal.aborted) throw new Error('aborted');
    const existing = all.find((d) => d.title === title && !d.hiddenAt);

    let docId: string;
    let created = false;
    let versionedTitle = title;

    if (existing) {
      // M1e Task 13.2 + review followup：用户编辑保护。
      // - 已有 `agentLastExportHash` 且 hash 对不上当前内容 → 用户改过 → 走 v2
      // - **从未有 agentLastExportHash**（lastHash=null）且当前文档非空 → 这文档
      //   是用户自己手写的（不是 agent 写的），同样不能覆盖 → 也走 v2。
      //   reviewer 指出的"first-touch overwrite" 就是 fix 这里。
      // - lastHash=null 但当前文档为空 → 几乎肯定是空 shell（如手动创建后没填内容），
      //   允许覆盖。
      const lastHash = existing.agentLastExportHash ?? null;
      const currentText =
        existing.chapters?.[0]?.blocks?.[0]?.content ?? '';
      const currentHash = currentText
        ? createHash('sha256').update(currentText).digest('hex')
        : null;
      const userEditedKnownAgentDoc =
        lastHash !== null && currentHash !== null && lastHash !== currentHash;
      const userOwnedExistingDoc = lastHash === null && currentHash !== null;
      const protect = userEditedKnownAgentDoc || userOwnedExistingDoc;

      if (protect) {
        versionedTitle = await pickVersionedTitle(all, title);
        const doc = await createDocument(ownerId, versionedTitle);
        docId = doc.id;
        created = true;
        const { emitNotice } = await import('../notices.js');
        const reason = userEditedKnownAgentDoc ? 'user_edited' : 'pre_existing_user_doc';
        const userVisibleReason = userEditedKnownAgentDoc ? '已被你编辑过' : '不是 agent 创建的';
        await emitNotice({
          runId: ctx.runId,
          severity: 'info',
          code: 'DOC_EXPORT_VERSIONED',
          message: `检测到《${title}》${userVisibleReason}，本次写入存为新文档《${versionedTitle}》，未覆盖你原稿。`,
          context: { originalDocumentId: existing.id, versionedTitle, reason },
        });
      } else {
        docId = existing.id;
      }
    } else {
      const doc = await createDocument(ownerId, title);
      docId = doc.id;
      created = true;
    }

    if (ctx.signal.aborted) throw new Error('aborted');
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

    return { ok: true, documentId: docId, title: versionedTitle, created };
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

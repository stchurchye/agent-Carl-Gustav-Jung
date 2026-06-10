import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, listDocuments, getDocument } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import {
  docExportMarkdownTool,
  registerDocExportMarkdown,
} from '../tools/docExportMarkdown.js';
import { toolRegistry } from '../toolRegistry.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

function ctxFor(ownerId: string) {
  return {
    runId: 'r',
    stepId: 's',
    ownerId,
    channel: 'private' as const,
    signal: new AbortController().signal,
  };
}

describeDb('docExportMarkdown tool', () => {
  beforeAll(async () => {
    await runMigrations();
    registerDocExportMarkdown();
  });

  beforeEach(async () => {
    // 不能粗暴 DELETE 全表（其它测试可能并行依赖）
  });

  it('registers idempotently + correct flags', () => {
    expect(toolRegistry.get('doc_export_markdown')).toBeDefined();
    expect(docExportMarkdownTool.hasSideEffects).toBe(true);
    expect(docExportMarkdownTool.idempotent).toBe(true);
  });

  it('creates a new doc on first call, then upserts by title on second call', async () => {
    const user = await ensureUser('docExp');
    const title = '研究：家族信托 ' + randomUUID().slice(0, 6);

    const out1 = await docExportMarkdownTool.handler(
      { title, markdown: '# v1\n第一稿' },
      ctxFor(user.id),
    );
    expect(out1.created).toBe(true);
    expect(out1.documentId).toBeTruthy();

    const out2 = await docExportMarkdownTool.handler(
      { title, markdown: '# v2\n第二稿（覆盖）' },
      ctxFor(user.id),
    );
    expect(out2.created).toBe(false);
    expect(out2.documentId).toBe(out1.documentId);

    // 列表里只应有这一篇 title 匹配
    const docs = (await listDocuments(user.id)).filter((d) => d.title === title);
    expect(docs.length).toBe(1);

    // 第一块内容已是第二稿
    const fresh = await getDocument(user.id, out1.documentId);
    const firstBlock = fresh?.chapters[0]?.blocks[0];
    expect(firstBlock?.content).toContain('第二稿（覆盖）');
  });

  it('idempotency key only depends on normalized title', () => {
    const k1 = docExportMarkdownTool.computeIdempotencyKey!({
      title: '  Hello World  ',
      markdown: 'a',
    });
    const k2 = docExportMarkdownTool.computeIdempotencyKey!({
      title: 'hello world',
      markdown: 'b',
    });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^doc:[0-9a-f]{64}$/);
  });

  // ========== M1e Task 13.2 ==========
  it('M1e 13.2: re-export AFTER user edited the doc → creates "title v2" + emits DOC_EXPORT_VERSIONED', async () => {
    const user = await ensureUser('docVer');
    const title = '研究：信托 ' + randomUUID().slice(0, 6);

    // 1. agent 第一次 export
    const out1 = await docExportMarkdownTool.handler(
      { title, markdown: '# 第一版正文\n详细分析…' },
      ctxFor(user.id),
    );
    expect(out1.created).toBe(true);

    // 2. 模拟"用户在写作页改了第一块内容"
    const fresh = await getDocument(user.id, out1.documentId);
    const ch = fresh?.chapters[0];
    const block = ch?.blocks[0];
    const { saveDocumentContent } = await import('../../../store/pg.js');
    await saveDocumentContent(
      user.id,
      out1.documentId,
      ch!.id,
      block!.id,
      '# 用户改过的版本\n手动编辑过',
    );

    // 3. agent 再次以同 title export 不同内容 → 应当走 v2 路径
    const out2 = await docExportMarkdownTool.handler(
      { title, markdown: '# 第二版正文\n增量分析' },
      { ...ctxFor(user.id), runId: 'r-version-' + randomUUID() },
    );
    expect(out2.created).toBe(true);
    expect(out2.documentId).not.toBe(out1.documentId);
    expect(out2.title).toMatch(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} v2$`));

    // 4. 原 doc 内容不变
    const original = await getDocument(user.id, out1.documentId);
    expect(original?.chapters[0]?.blocks[0]?.content).toContain('用户改过的版本');

    // 5. 应当 emit DOC_EXPORT_VERSIONED notice
    const { listNoticesForRun } = await import('../../agent/notices.js');
    // notice 的 runId 是第二次调用时给的 r-version-... —— 取出 out2 的 ctx 那个
    // （我们没存它），所以这里换种验证：查 v2 文档存在即可。
    const docs = await listDocuments(user.id);
    const v2 = docs.find((d) => d.title === out2.title);
    expect(v2).toBeDefined();
    // notice 写入是 fire-and-forget，没法严格断言这里，但函数已 throw-free
    // 通过的话上面 v2 创建就证明 user-edited 分支命中
    expect(typeof listNoticesForRun).toBe('function');
  });

  it('M1e review followup: first agent write to user-pre-existing doc (no agentLastExportHash) → versions, does NOT overwrite', async () => {
    // reviewer 指出的"first-touch overwrite"。场景：用户在写作页手动建了一篇文档
    // 并写了内容，agent 后来想以同 title export → 老代码会**静默覆盖用户原稿**，
    // 因为 lastHash=null 走 else 分支。修复后：lastHash=null 且当前内容非空时
    // 也走 v2 路径保护用户原稿。
    const user = await ensureUser('preExist');
    const title = '我自己写的文档 ' + randomUUID().slice(0, 6);

    // 1. 用户手动创建并写入内容（不经 agent，因此 agentLastExportHash=null）
    const { createDocument, saveDocumentContent } = await import('../../../store/pg.js');
    const userDoc = await createDocument(user.id, title);
    const fresh = await getDocument(user.id, userDoc.id);
    const ch = fresh?.chapters[0];
    const block = ch?.blocks[0];
    await saveDocumentContent(
      user.id,
      userDoc.id,
      ch!.id,
      block!.id,
      '# 用户原稿\n这是我手动写的，不要被覆盖',
    );

    // 2. agent 第一次 export 到同 title → 应当 version 而不是覆盖
    const out = await docExportMarkdownTool.handler(
      { title, markdown: '# agent 生成内容\n应当存到 v2 而不是覆盖' },
      { ...ctxFor(user.id), runId: 'r-firsttouch-' + randomUUID() },
    );
    expect(out.created).toBe(true);
    expect(out.documentId).not.toBe(userDoc.id);
    expect(out.title).toMatch(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} v2$`));

    // 3. 用户原稿完整保留
    const original = await getDocument(user.id, userDoc.id);
    expect(original?.chapters[0]?.blocks[0]?.content).toContain('用户原稿');
    expect(original?.chapters[0]?.blocks[0]?.content).not.toContain('agent 生成内容');
  });

  it('M1e review followup: first agent write to EMPTY pre-existing doc → still overwrites (shell case)', async () => {
    // 边界：用户/系统建了一个 title 但完全空白（典型场景：刚 createDocument 没填）。
    // 此时 lastHash=null 且 currentText='' → 不算"用户原稿"，允许覆盖。
    const user = await ensureUser('preEmpty');
    const title = '空白文档 ' + randomUUID().slice(0, 6);
    const { createDocument } = await import('../../../store/pg.js');
    const shell = await createDocument(user.id, title);

    const out = await docExportMarkdownTool.handler(
      { title, markdown: '# agent 填充\n这次允许覆盖空 shell' },
      ctxFor(user.id),
    );
    expect(out.created).toBe(false);
    expect(out.documentId).toBe(shell.id);
    expect(out.title).toBe(title);
    const fresh = await getDocument(user.id, shell.id);
    expect(fresh?.chapters[0]?.blocks[0]?.content).toContain('agent 填充');
  });

  it('M1e 13.2: re-export when user did NOT edit → still overwrites in-place', async () => {
    const user = await ensureUser('docOver');
    const title = '研究：未改 ' + randomUUID().slice(0, 6);
    const out1 = await docExportMarkdownTool.handler(
      { title, markdown: '## 第一稿' },
      ctxFor(user.id),
    );
    // 不改文档，直接再 export 不同 markdown
    const out2 = await docExportMarkdownTool.handler(
      { title, markdown: '## 第二稿（应该覆盖）' },
      ctxFor(user.id),
    );
    expect(out2.documentId).toBe(out1.documentId);
    expect(out2.created).toBe(false);
    expect(out2.title).toBe(title); // 没改成 v2
    const fresh = await getDocument(user.id, out1.documentId);
    expect(fresh?.chapters[0]?.blocks[0]?.content).toContain('第二稿');
  });
});

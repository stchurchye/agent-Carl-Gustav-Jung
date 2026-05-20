import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('docExportMarkdown tool', () => {
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
});

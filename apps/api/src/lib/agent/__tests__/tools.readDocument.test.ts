import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../store/pg.js', () => ({
  listDocuments: vi.fn(async () => []),
}));

import { listDocuments } from '../../../store/pg.js';
import { readDocumentTool, registerReadDocument } from '../tools/readDocument.js';
import { toolRegistry } from '../toolRegistry.js';

const list = vi.mocked(listDocuments);

const ctx = {
  runId: 'r', stepId: 's', ownerId: 'userA', channel: 'private' as const,
  signal: new AbortController().signal,
};

const doc = (id: string, title: string, content: string, hiddenAt: string | null = null) => ({
  id,
  title,
  hiddenAt,
  chapters: [{ id: 'c1', blocks: [{ id: 'b1', content }] }],
});

describe('read_document tool (K7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue([] as never);
  });

  it('registers idempotently', () => {
    registerReadDocument();
    registerReadDocument();
    expect(toolRegistry.get('read_document')).toBeDefined();
  });

  it('title 命中(含模糊包含) → 返回最佳匹配正文 + 匹配清单;owner 锁 ctx.ownerId', async () => {
    list.mockResolvedValue([
      doc('d1', '研究报告：禀赋效应的实证支持', '## 报告\n正文内容'),
      doc('d2', '购物清单', '鸡蛋'),
    ] as never);
    const out = await readDocumentTool.handler({ titleQuery: '禀赋效应' }, ctx);
    expect(out.ok).toBe(true);
    expect(out.title).toBe('研究报告：禀赋效应的实证支持');
    expect(out.content).toContain('正文内容');
    expect(out.matches).toEqual([
      { documentId: 'd1', title: '研究报告：禀赋效应的实证支持' },
    ]);
    expect(list).toHaveBeenCalledWith('userA');
  });

  it('无命中 → ok:true 空清单(让 planner 知道没有这份文档,不是错误)', async () => {
    list.mockResolvedValue([doc('d1', '别的', 'x')] as never);
    const out = await readDocumentTool.handler({ titleQuery: '不存在的报告' }, ctx);
    expect(out.ok).toBe(true);
    expect(out.matches).toEqual([]);
    expect(out.content).toBeUndefined();
  });

  it('hidden 文档不参与匹配', async () => {
    list.mockResolvedValue([doc('d1', '研究报告：X', '正文', '2026-06-01')] as never);
    const out = await readDocumentTool.handler({ titleQuery: '研究报告' }, ctx);
    expect(out.matches).toEqual([]);
  });

  it('正文超 8K 截断并标记 truncated', async () => {
    list.mockResolvedValue([doc('d1', '长文', 'x'.repeat(10000))] as never);
    const out = await readDocumentTool.handler({ titleQuery: '长文' }, ctx);
    expect(out.content!.length).toBeLessThanOrEqual(8192);
    expect(out.truncated).toBe(true);
  });

  it('多个命中 → 清单全列(≤10),正文取标题最短的精确侧匹配', async () => {
    list.mockResolvedValue([
      doc('d1', '研究报告：A 主题', 'A 正文'),
      doc('d2', '研究报告：A 主题的扩展续篇', '续篇正文'),
    ] as never);
    const out = await readDocumentTool.handler({ titleQuery: '研究报告：A 主题' }, ctx);
    expect(out.matches).toHaveLength(2);
    expect(out.title).toBe('研究报告：A 主题'); // 最短=最精确
  });

  it('DB 抛错 → ok:false 不抛;AbortError 透传', async () => {
    list.mockRejectedValueOnce(new Error('db down'));
    const out = await readDocumentTool.handler({ titleQuery: 'x' }, ctx);
    expect(out.ok).toBe(false);

    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    list.mockRejectedValueOnce(abortErr);
    await expect(readDocumentTool.handler({ titleQuery: 'x' }, ctx)).rejects.toThrow('aborted');
  });
});

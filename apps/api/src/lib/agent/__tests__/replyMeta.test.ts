import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../toolRegistry.js';
import { collectReplyRefs, summarizeStepOutput } from '../replyGen.js';
import type { AgentStep } from '../types.js';

function fakeStep(toolName: string, output: unknown): AgentStep {
  return {
    id: `s-${toolName}`,
    runId: 'r',
    idx: 1,
    kind: 'observe',
    toolName,
    toolCallKey: null,
    input: null,
    output,
    tokens: 0,
    durationMs: 0,
    error: null,
    byUserId: null,
    createdAt: new Date(),
  };
}

describe('M1f collectReplyRefs / summarizeStepOutput', () => {
  it('collectReplyRefs: doc_export_markdown emits document ref via replyMeta.extractRef', () => {
    const docTool: Pick<ToolDef, 'name' | 'replyMeta'> = {
      name: 'doc_export_markdown',
      replyMeta: {
        summaryKind: 'export_ref',
        extractRef: (o) => {
          const x = o as { documentId?: string; title?: string };
          return x.documentId
            ? { kind: 'document', id: x.documentId, label: x.title }
            : null;
        },
      },
    };
    const steps = [
      fakeStep('doc_export_markdown', { documentId: 'd1', title: '研究信托' }),
      fakeStep('search_web', { results: [] }),
    ];
    const refs = collectReplyRefs(steps, new Map([[docTool.name, docTool as ToolDef]]));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ kind: 'document', id: 'd1', label: '研究信托' });
  });

  it('collectReplyRefs: tools without replyMeta.extractRef are ignored', () => {
    const tool: Pick<ToolDef, 'name' | 'replyMeta'> = {
      name: 'echo_after_sleep',
      replyMeta: { summaryKind: 'silent' },
    };
    const refs = collectReplyRefs(
      [fakeStep('echo_after_sleep', { text: 'hi' })],
      new Map([[tool.name, tool as ToolDef]]),
    );
    expect(refs).toEqual([]);
  });

  it('summarizeStepOutput: list kind picks first 5 titles', () => {
    const out = {
      results: [
        { title: 't1' }, { title: 't2' }, { title: 't3' },
        { title: 't4' }, { title: 't5' }, { title: 't6' },
      ],
    };
    const summary = summarizeStepOutput(out, 'list');
    expect(summary).toContain('t1');
    expect(summary).toContain('t5');
    expect(summary).not.toContain('t6');
  });

  it('summarizeStepOutput: silent kind returns empty string', () => {
    expect(summarizeStepOutput({ anything: 'x' }, 'silent')).toBe('');
  });

  it('summarizeStepOutput: export_ref kind returns short marker only', () => {
    const s = summarizeStepOutput({ documentId: 'd1', title: 't' }, 'export_ref');
    expect(s).toMatch(/^\[已写入资源/);
  });

  it('summarizeStepOutput: default text kind truncates to 200 chars', () => {
    const long = 'x'.repeat(500);
    expect(summarizeStepOutput(long, 'text').length).toBeLessThanOrEqual(200);
  });

  it("summarizeStepOutput: list kind with neither 'results' nor 'items' falls back to text path", () => {
    const out = { something: 'else', payload: 'data' };
    const summary = summarizeStepOutput(out, 'list');
    // 应该 fallback 到 text 路径 (JSON.stringify 截断)
    expect(summary).toMatch(/\{|\"/);
  });

  it('collectReplyRefs: extractRef that throws is swallowed (does not poison reply)', () => {
    const buggyTool: Pick<ToolDef, 'name' | 'replyMeta'> = {
      name: 'buggy',
      replyMeta: {
        summaryKind: 'export_ref',
        extractRef: () => { throw new Error('boom'); },
      },
    };
    const refs = collectReplyRefs(
      [fakeStep('buggy', { x: 1 })],
      new Map([[buggyTool.name, buggyTool as ToolDef]]),
    );
    expect(refs).toEqual([]);
  });

  it('summarizeStepOutput: primitive number output stringifies', () => {
    expect(summarizeStepOutput(42, 'text')).toBe('42');
  });

  // M1f polish #3：ok=false 是失败 observation，绝不该出现在用户回复的资源清单里。
  // 当前 prod 路径靠 docExport throw、magiIngest 清 videoUrl 来"碰巧"返回 null，
  // 但新 tool 作者很容易踩坑。把契约钉在 collectReplyRefs，不依赖各 tool 自检。
  it('M1f polish #3: collectReplyRefs skips ok=false output even if id present', () => {
    const docTool: Pick<ToolDef, 'name' | 'replyMeta'> = {
      name: 'doc_export_markdown',
      replyMeta: {
        summaryKind: 'export_ref',
        extractRef: (o) => {
          const x = o as { documentId?: string; title?: string };
          return x.documentId
            ? { kind: 'document', id: x.documentId, label: x.title }
            : null;
        },
      },
    };
    const refs = collectReplyRefs(
      [
        fakeStep('doc_export_markdown', {
          ok: false,
          documentId: 'd1',
          title: 't',
          error: 'DB down',
        }),
      ],
      new Map([[docTool.name, docTool as ToolDef]]),
    );
    expect(refs).toEqual([]);
  });

  // 同上但 ok=false 包在 { result: ... }（runtime 写 step.output 时实际的 shape）
  it('M1f polish #3: collectReplyRefs skips ok=false under { result } wrapper too', () => {
    const docTool: Pick<ToolDef, 'name' | 'replyMeta'> = {
      name: 'doc_export_markdown',
      replyMeta: {
        summaryKind: 'export_ref',
        extractRef: (o) => {
          const x = o as { documentId?: string };
          return x.documentId
            ? { kind: 'document', id: x.documentId }
            : null;
        },
      },
    };
    const refs = collectReplyRefs(
      [
        fakeStep('doc_export_markdown', {
          result: { ok: false, documentId: 'd1', error: 'x' },
          retried: false,
        }),
      ],
      new Map([[docTool.name, docTool as ToolDef]]),
    );
    expect(refs).toEqual([]);
  });
});

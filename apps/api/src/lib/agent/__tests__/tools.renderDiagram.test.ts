import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderDiagramTool, registerRenderDiagram } from '../tools/renderDiagram.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('../../../db/client.js', () => ({
  getPool: () => ({
    query: vi.fn(async (_sql: string, _params: unknown[]) => ({
      rows: [{ id: 'msg_diag_1' }],
    })),
  }),
}));

const fakeCtx = {
  runId: 'r',
  stepId: 's',
  ownerId: 'u',
  channel: 'private' as const,
  topicId: 't1',
  signal: new AbortController().signal,
};

describe('render_diagram tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers idempotently', () => {
    registerRenderDiagram();
    registerRenderDiagram();
    expect(toolRegistry.get('render_diagram')).toBeDefined();
  });

  it('valid mermaid → ok:true with diagramId and no warnings', async () => {
    const out = await renderDiagramTool.handler(
      { mermaid: 'graph TD\n  A-->B', title: '示意图' },
      fakeCtx,
    );
    expect(out.ok).toBe(true);
    expect(out.diagramId).toBe('msg_diag_1');
    expect(out.title).toBe('示意图');
    expect(out.validationWarnings).toEqual([]);
  });

  it('invalid first token → ok:true with non-empty validationWarnings (not fatal)', async () => {
    const out = await renderDiagramTool.handler(
      { mermaid: 'banana TD\n A-->B', title: 't' },
      fakeCtx,
    );
    expect(out.ok).toBe(true);
    expect(out.validationWarnings.length).toBeGreaterThan(0);
  });

  it('mermaid over 8KB → ok:false', async () => {
    const huge = 'graph TD\n  ' + 'A-->B\n  '.repeat(2000);
    const out = await renderDiagramTool.handler(
      { mermaid: huge, title: 't' },
      fakeCtx,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/too large/);
  });

  it('extractRef returns diagram kind ref on success', () => {
    const ref = renderDiagramTool.replyMeta!.extractRef!({
      ok: true,
      diagramId: 'msg_diag_1',
      title: '示意图',
      validationWarnings: [],
    });
    expect(ref).toEqual({ kind: 'diagram', id: 'msg_diag_1', label: '示意图' });
  });

  it('extractRef returns null on failure', () => {
    const ref = renderDiagramTool.replyMeta!.extractRef!({
      ok: false,
      diagramId: '',
      title: '',
      validationWarnings: [],
      error: 'boom',
    });
    expect(ref).toBeNull();
  });
});

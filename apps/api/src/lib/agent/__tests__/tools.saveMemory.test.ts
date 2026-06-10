import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../integrations/magi.js', () => ({
  magiSystemEnabled: vi.fn(() => true),
  searchAgentMemory: vi.fn(async () => []),
  writeAgentMemory: vi.fn(async () => ({ id: 100 })),
}));
vi.mock('../../memoryReconcile.js', () => ({
  reconcileMemoryWrite: vi.fn(async () => ({ action: 'new', writtenId: 100, invalidatedIds: [] })),
}));
vi.mock('../store.js', () => ({
  listSteps: vi.fn(async () => []),
  getAgentRun: vi.fn(async () => ({ id: 'run-1', providerId: 'deepseek', modelId: 'm' })),
}));
vi.mock('../runLlmClient.js', () => ({
  resolveLlmClient: vi.fn(async () => ({ chat: vi.fn() })),
}));

import { magiSystemEnabled, searchAgentMemory, writeAgentMemory } from '../../integrations/magi.js';
import { reconcileMemoryWrite } from '../../memoryReconcile.js';
import * as store from '../store.js';
import { resolveLlmClient } from '../runLlmClient.js';
import { saveMemoryTool, registerSaveMemory } from '../tools/saveMemory.js';
import { toolRegistry } from '../toolRegistry.js';

const enabled = vi.mocked(magiSystemEnabled);
const search = vi.mocked(searchAgentMemory);
const write = vi.mocked(writeAgentMemory);
const reconcile = vi.mocked(reconcileMemoryWrite);
const listSteps = vi.mocked(store.listSteps);

const privCtx = {
  runId: 'run-1', stepId: 's1', ownerId: 'userA', channel: 'private' as const,
  topicId: undefined, groupId: undefined, signal: new AbortController().signal,
};
const groupCtx = { ...privCtx, channel: 'group' as const, groupId: 'g1', topicId: 't1' };

const findingHit = (id: number, score: number, url: string) => ({
  id, text: 'x', sourceRunId: null, sourceSessionId: null, topicId: null,
  createdAt: null, score, kind: 'finding' as const,
  sources: [{ url }], truthStatus: 'unverified' as const, truthNote: null, counterSources: null,
});

describe('save_memory tool (K4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enabled.mockReturnValue(true);
    search.mockResolvedValue([]);
    write.mockResolvedValue({ id: 100 });
    reconcile.mockResolvedValue({ action: 'new', writtenId: 100, invalidatedIds: [] });
    listSteps.mockResolvedValue([]);
  });

  it('registers idempotently', () => {
    registerSaveMemory();
    registerSaveMemory();
    expect(toolRegistry.get('save_memory')).toBeDefined();
  });

  it('fact 路径(无 source_url)走 reconcile:owner 锁 ctx.ownerId,supersede 结果透传', async () => {
    reconcile.mockResolvedValue({ action: 'supersede', writtenId: 101, invalidatedIds: [7] });
    const out = await saveMemoryTool.handler({ text: '其实用户改用 Rust 了' }, privCtx);
    expect(out.ok).toBe(true);
    expect(out.kind).toBe('fact');
    expect(out.id).toBe(101);
    expect(out.supersededIds).toEqual([7]);
    const args = reconcile.mock.calls[0]!;
    expect(args[1]).toBe('userA'); // owner = ctx.ownerId,绝不信 input
    expect(write).not.toHaveBeenCalled(); // 写入由 reconcile 内部做
  });

  it('fact 路径 LLM 不可用 → 降级普通写入(fail-open 不丢保存)', async () => {
    vi.mocked(resolveLlmClient).mockResolvedValueOnce(null as never);
    const out = await saveMemoryTool.handler({ text: '一条事实' }, privCtx);
    expect(out.ok).toBe(true);
    expect(reconcile).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'userA', kind: 'fact', status: 'approved' }),
      privCtx.signal,
    );
  });

  it('finding 路径(source_url):写入带 sources + sourceRunId,confidence 0.9 → approved', async () => {
    const out = await saveMemoryTool.handler(
      { text: 'λ≈2.25', source_url: 'https://doi.org/10.1/tk', source_title: 'Prospect Theory' },
      privCtx,
    );
    expect(out.ok).toBe(true);
    expect(out.kind).toBe('finding');
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'userA',
        kind: 'finding',
        status: 'approved',
        sources: [{ url: 'https://doi.org/10.1/tk', title: 'Prospect Theory', runId: 'run-1' }],
        sourceRunId: 'run-1',
      }),
      privCtx.signal,
    );
    expect(reconcile).not.toHaveBeenCalled(); // finding 不走 LLM 取代(证据保全)
  });

  it('finding 近重门:top1≥0.92 且同源 → deduped 不写', async () => {
    search.mockResolvedValue([findingHit(55, 0.95, 'https://doi.org/10.1/tk')]);
    const out = await saveMemoryTool.handler(
      { text: 'λ≈2.25', source_url: 'https://doi.org/10.1/tk' },
      privCtx,
    );
    expect(out.ok).toBe(true);
    expect(out.deduped).toBe(true);
    expect(out.id).toBe(55);
    expect(write).not.toHaveBeenCalled();
  });

  it('finding 近重但不同源 → 仍写(不同来源的同结论是佐证不是重复)', async () => {
    search.mockResolvedValue([findingHit(55, 0.95, 'https://other.com/p')]);
    const out = await saveMemoryTool.handler(
      { text: 'λ≈2.25', source_url: 'https://doi.org/10.1/tk' },
      privCtx,
    );
    expect(out.ok).toBe(true);
    expect(out.deduped).toBeFalsy();
    expect(write).toHaveBeenCalled();
  });

  it('群聊 run:finding 落群共享池 group:{gid},fact 仍落个人(隐私底线)', async () => {
    await saveMemoryTool.handler(
      { text: '结论', source_url: 'https://x.com/p' }, groupCtx,
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'group:g1', kind: 'finding' }),
      groupCtx.signal,
    );
    vi.clearAllMocks();
    listSteps.mockResolvedValue([]);
    reconcile.mockResolvedValue({ action: 'new', writtenId: 1, invalidatedIds: [] });
    vi.mocked(store.getAgentRun).mockResolvedValue({ id: 'run-1', providerId: 'deepseek', modelId: 'm' } as never);
    vi.mocked(resolveLlmClient).mockResolvedValue({ chat: vi.fn() } as never);
    enabled.mockReturnValue(true);
    await saveMemoryTool.handler({ text: '个人事实' }, groupCtx);
    expect(reconcile.mock.calls[0]![1]).toBe('userA'); // fact 恒私有
  });

  it('每 run 5 次硬上限:第 6 次被拒', async () => {
    const saveStep = (idx: number) => ({
      id: `s${idx}`, runId: 'run-1', idx, kind: 'tool_call', toolName: 'save_memory',
      toolCallKey: null, input: null, output: { result: { ok: true } }, tokens: 0,
      durationMs: 0, error: null, byUserId: null, createdAt: new Date(),
    });
    listSteps.mockResolvedValue(Array.from({ length: 5 }, (_, i) => saveStep(i)) as never);
    const out = await saveMemoryTool.handler({ text: '第六条' }, privCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/cap/i);
    expect(write).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('MAGI 未启用 → ok:false enabled:false 不抛', async () => {
    enabled.mockReturnValue(false);
    const out = await saveMemoryTool.handler({ text: 'x' }, privCtx);
    expect(out.ok).toBe(false);
    expect(out.enabled).toBe(false);
  });

  it('非 http(s) 的 source_url → 不当 finding,拒收 url(防 script-URL 入库)', async () => {
    const out = await saveMemoryTool.handler(
      { text: 'x', source_url: 'javascript:alert(1)' }, privCtx,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/http/);
  });

  it('AbortError 透传(让 runtime 看到 cancel)', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    reconcile.mockRejectedValue(abortErr);
    await expect(saveMemoryTool.handler({ text: 'x' }, privCtx)).rejects.toThrow('aborted');
  });
});

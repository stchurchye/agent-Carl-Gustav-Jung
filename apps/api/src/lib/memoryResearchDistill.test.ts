import { describe, expect, it, vi } from 'vitest';
import type { LlmChatClient } from './llm/types.js';
import {
  distillResearchFindings,
  refsToSources,
} from './memoryResearchDistill.js';
import type { ReplyRef } from './agent/types.js';

function fakeLlm(reply: string): LlmChatClient {
  return {
    providerId: 'deepseek',
    modelId: 'm',
    chat: vi.fn().mockResolvedValue({ content: reply }),
  } as unknown as LlmChatClient;
}

const REFS: ReplyRef[] = [
  { kind: 'url', id: 'https://doi.org/10.1/tk', label: 'Advances in Prospect Theory (1992)' },
  { kind: 'url', id: 'https://x.com/page', label: '某网页' },
];

describe('distillResearchFindings (K5)', () => {
  it('解析 findings:sourceIdx 映射为带 url/title/year 的 sources(label 年份提取)', async () => {
    const llm = fakeLlm(
      '{"findings":[{"text":"损失厌恶系数约 2.25","confidence":0.9,"sourceIdx":[1]}]}',
    );
    const out = await distillResearchFindings(llm, '终稿正文 [1]', REFS, {});
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('损失厌恶系数约 2.25');
    expect(out[0]!.confidence).toBe(0.9);
    expect(out[0]!.sources).toEqual([
      { url: 'https://doi.org/10.1/tk', title: 'Advances in Prospect Theory', year: 1992 },
    ]);
  });

  it('sourceIdx 越界 → 整条丢弃(反幻觉:无真出处的结论不进库)', async () => {
    const llm = fakeLlm(
      '{"findings":[{"text":"幻觉结论","confidence":0.9,"sourceIdx":[7]},{"text":"合法结论","confidence":0.8,"sourceIdx":[2]}]}',
    );
    const out = await distillResearchFindings(llm, '正文', REFS, {});
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('合法结论');
  });

  it('sourceIdx 为空 → 整条丢弃(没有出处的"结论"正是要消灭的)', async () => {
    const llm = fakeLlm('{"findings":[{"text":"无出处","confidence":0.9,"sourceIdx":[]}]}');
    expect(await distillResearchFindings(llm, '正文', REFS, {})).toEqual([]);
  });

  it('>4 条硬截断;text 截 300 字', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      text: `结论${i}` + 'x'.repeat(400),
      confidence: 0.9,
      sourceIdx: [1],
    }));
    const llm = fakeLlm(JSON.stringify({ findings: many }));
    const out = await distillResearchFindings(llm, '正文', REFS, {});
    expect(out).toHaveLength(4);
    expect(out[0]!.text.length).toBeLessThanOrEqual(300);
  });

  it('LLM 输出不是 JSON → [](fail-open)', async () => {
    const llm = fakeLlm('抱歉,我无法……');
    expect(await distillResearchFindings(llm, '正文', REFS, {})).toEqual([]);
  });

  it('refsToSources:非 url 类 ref 不进编号清单(document/diagram 是产物不是出处)', () => {
    const mixed: ReplyRef[] = [
      { kind: 'document', id: 'd1', label: '导出文档' },
      ...REFS,
    ];
    const sources = refsToSources(mixed);
    expect(sources).toHaveLength(2);
    expect(sources[0]!.url).toBe('https://doi.org/10.1/tk');
  });
});

// ───────────── persistResearchFindings:近重门 + 争议判官 ─────────────

vi.mock('./integrations/magi.js', () => ({
  searchAgentMemory: vi.fn(async () => []),
  writeAgentMemory: vi.fn(async () => ({ id: 100 })),
  markTruthAgentMemory: vi.fn(async () => ({ updated: 1 })),
}));

import {
  searchAgentMemory,
  writeAgentMemory,
  markTruthAgentMemory,
} from './integrations/magi.js';
import { persistResearchFindings } from './memoryResearchDistill.js';
import { beforeEach } from 'vitest';

const search = vi.mocked(searchAgentMemory);
const write = vi.mocked(writeAgentMemory);
const markTruth = vi.mocked(markTruthAgentMemory);

const FINDING = {
  text: '损失厌恶系数约 2.25',
  confidence: 0.9,
  sources: [{ url: 'https://doi.org/10.1/tk', title: 'PT', year: 1992 }],
};

const nearHit = (id: number, score: number, url: string) => ({
  id, text: '损失厌恶系数大约是 2.25', sourceRunId: null, sourceSessionId: null,
  topicId: null, createdAt: null, score, kind: 'finding' as const,
  sources: [{ url }], truthStatus: 'unverified' as const, truthNote: null, counterSources: null,
});

describe('persistResearchFindings (K5:近重门 + 争议判官)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.mockResolvedValue([]);
    write.mockResolvedValue({ id: 100 });
    markTruth.mockResolvedValue({ updated: 1 });
  });

  it('无近邻 → 直接写 kind=finding + sources + sourceRunId(0.85 质量门沿用)', async () => {
    const llm = fakeLlm('{}');
    const n = await persistResearchFindings(llm, 'userA', [FINDING], { sourceRunId: 'run-1' });
    expect(n.written).toBe(1);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'userA', kind: 'finding', status: 'approved',
        sources: FINDING.sources, sourceRunId: 'run-1',
      }),
      undefined,
    );
  });

  it('近重 ≥0.92 且同源 → 跳过写入(机械去重,不调判官)', async () => {
    search.mockResolvedValue([nearHit(7, 0.95, 'https://doi.org/10.1/tk')]);
    const llm = fakeLlm('{}');
    const n = await persistResearchFindings(llm, 'userA', [FINDING], {});
    expect(n.written).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect((llm.chat as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('近邻 ≥0.85 → 判官 contradicts:写新 + 旧条标 disputed(反证=新条来源)', async () => {
    search.mockResolvedValue([nearHit(7, 0.88, 'https://other.com/p')]);
    const llm = fakeLlm('{"verdict":"contradicts","reason":"两研究结论相反"}');
    const n = await persistResearchFindings(llm, 'userA', [FINDING], {});
    expect(n.written).toBe(1);
    expect(write).toHaveBeenCalled();
    expect(markTruth).toHaveBeenCalledWith(
      'userA', 7, 'disputed',
      expect.objectContaining({
        truthNote: '两研究结论相反',
        counterSources: FINDING.sources,
      }),
      undefined,
    );
  });

  it('判官 duplicate → 跳过写入', async () => {
    search.mockResolvedValue([nearHit(7, 0.88, 'https://other.com/p')]);
    const llm = fakeLlm('{"verdict":"duplicate","reason":"同义重述"}');
    const n = await persistResearchFindings(llm, 'userA', [FINDING], {});
    expect(n.written).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(markTruth).not.toHaveBeenCalled();
  });

  it('判官失败 → 按 distinct 并存写入(宁并存不误标,fail-open)', async () => {
    search.mockResolvedValue([nearHit(7, 0.88, 'https://other.com/p')]);
    const llm = { providerId: 'deepseek', modelId: 'm', chat: vi.fn().mockRejectedValue(new Error('llm down')) } as never;
    const n = await persistResearchFindings(llm, 'userA', [FINDING], {});
    expect(n.written).toBe(1);
    expect(markTruth).not.toHaveBeenCalled();
  });

  it('单条写失败不影响其余(逐条 fail-open)', async () => {
    write.mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce({ id: 101 });
    const llm = fakeLlm('{}');
    const second = { ...FINDING, text: '另一条结论', sources: [{ url: 'https://b.com/x' }] };
    const n = await persistResearchFindings(llm, 'userA', [FINDING, second], {});
    expect(n.written).toBe(1);
  });
});

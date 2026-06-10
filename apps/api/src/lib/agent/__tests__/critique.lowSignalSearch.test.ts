import { describe, expect, it } from 'vitest';
import { isLowSignalSearch, runCritique } from '../critique.js';
import type { AgentStep, Plan } from '../types.js';

/**
 * R2-3 refine 门:R1-2 的 quality 信号(empty/low_relevance)→ 连续低信号搜索触发重规划
 * 改写查询。不动 isToolFailure 语义(657 存量测试的安全线);fallback_loose 不计入
 * (CrossRef 宽匹配结果可能仍相关,由 LLM 自行核对)。
 */

function step(idx: number, quality?: string, error: string | null = null): AgentStep {
  return {
    id: `s${idx}`, runId: 'r', idx, kind: 'tool_call', toolName: 'search_web',
    toolCallKey: null, input: { query: 'q' },
    output: { result: { ok: true, ...(quality ? { quality } : {}), results: [] } },
    tokens: 0, durationMs: 0, error, byUserId: null, createdAt: new Date(),
  };
}

const plan: Plan = {
  intentSummary: 'x', steps: [], todos: [], finalReplyHint: '', reasoning: null, version: 1,
};

describe('R2-3:isLowSignalSearch', () => {
  it('quality=empty / low_relevance → true;ok / fallback_loose / 无 quality → false', () => {
    expect(isLowSignalSearch(step(1, 'empty'))).toBe(true);
    expect(isLowSignalSearch(step(2, 'low_relevance'))).toBe(true);
    expect(isLowSignalSearch(step(3, 'ok'))).toBe(false);
    expect(isLowSignalSearch(step(4, 'fallback_loose'))).toBe(false);
    expect(isLowSignalSearch(step(5))).toBe(false);
  });

  it('soft-fail 步(有 error)不重复计入 —— 那是 isToolFailure 的辖区', () => {
    expect(isLowSignalSearch(step(1, 'empty', 'HTTP 500'))).toBe(false);
  });
});

describe('R2-3:runCritique low_signal_search', () => {
  it('最近 4 步 ≥2 条低信号搜索 → shouldReplan,理由提示改写查询', () => {
    const c = runCritique({
      plan,
      recentSteps: [step(1, 'empty'), step(2, 'ok'), step(3, 'low_relevance')],
      reason: 'low_signal_search',
    });
    expect(c.shouldReplan).toBe(true);
    expect(c.reason).toMatch(/改写|换关键词|换.*语言/);
  });

  it('仅 1 条低信号 → 不触发(给单次失误留余地)', () => {
    const c = runCritique({
      plan,
      recentSteps: [step(1, 'empty'), step(2, 'ok')],
      reason: 'low_signal_search',
    });
    expect(c.shouldReplan).toBe(false);
  });
});

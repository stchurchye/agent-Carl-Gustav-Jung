import { describe, expect, it } from 'vitest';
import { estimateTokens, trimTextToTokenBudget } from './contextBudget.js';

/**
 * S7：token 估算改 CJK/ASCII 分别估。
 * 旧版 len/1.6 对英文严重高估（~3.5x）、对中文略低估。新版：CJK ~1 token/char（保守），
 * ASCII ~1 token/3.5 chars（更接近真实）。偏保守 = 早压更安全。
 */
describe('estimateTokens (CJK/ASCII-aware)', () => {
  it('empty → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('CJK ≈ 1 token/char (conservative; >= the old len/1.6 estimate)', () => {
    const cjk = '你好世界你好世界'; // 8 CJK 字
    expect(estimateTokens(cjk)).toBeGreaterThanOrEqual(8);
  });

  it('ASCII is much more accurate than len/1.6 (no longer ~3.5x over-estimate)', () => {
    const ascii = 'the quick brown fox jumps over the lazy dog'; // 43 chars
    const naive = Math.ceil(ascii.length / 1.6); // 27
    const est = estimateTokens(ascii);
    expect(est).toBeLessThan(naive); // 比裸 1.6 更小（更准）
    expect(est).toBeGreaterThan(0);
    // ~ ascii/3.5 ≈ 12-13
    expect(est).toBeLessThanOrEqual(20);
  });

  it('mixed text sits between (CJK counted heavier than ASCII)', () => {
    const mixed = '搜索 reinforcement learning 的 Richard Sutton';
    const est = estimateTokens(mixed);
    expect(est).toBeGreaterThan(0);
    // 至少 >= CJK 字数（搜索的/共 4 个汉字按 1/char）
    expect(est).toBeGreaterThanOrEqual(4);
  });
});

describe('trimTextToTokenBudget consistency with estimateTokens', () => {
  it('CJK text trimmed to maxTokens does NOT exceed the budget (no 1.6x over-fill)', () => {
    const cjk = '研'.repeat(500); // 500 CJK 字 ≈ 500 tokens
    const trimmed = trimTextToTokenBudget(cjk, 100);
    // 关键：裁后真实 token 估算 <= 预算（旧版会按 100*1.6=160 字裁 → ~160 token，超 60%）
    expect(estimateTokens(trimmed)).toBeLessThanOrEqual(100);
  });
  it('ASCII text keeps more chars per token (not over-trimmed to maxTokens chars)', () => {
    const ascii = 'word '.repeat(500); // 2500 ASCII chars ≈ 714 tokens
    const trimmed = trimTextToTokenBudget(ascii, 100);
    expect(estimateTokens(trimmed)).toBeLessThanOrEqual(100);
    expect(trimmed.length).toBeGreaterThan(100); // ASCII 不被裁到只剩 100 字
  });
  it('returns empty (not a suffix-only over-budget string) when budget cannot fit the trim suffix', () => {
    // TRIM_SUFFIX 本身 ≈14 tokens；预算比它还小时旧版会返回仅后缀 → 仍超预算。
    const cjk = '压'.repeat(500);
    const trimmed = trimTextToTokenBudget(cjk, 5);
    expect(estimateTokens(trimmed)).toBeLessThanOrEqual(5);
  });
});

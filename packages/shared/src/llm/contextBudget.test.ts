import { describe, expect, it } from 'vitest';
import { assembleWritingIntentContext, estimateTokens, trimTextToTokenBudget } from './contextBudget.js';

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

/**
 * Review 2026-06-11 [P1][shared-pkg] contextBudget.ts:281/:292
 * fixedWithoutDoc 已含 breakdown.pendingUser；docBudget 与重算的 historyBudget
 * 再各减一次 → 双重扣减，文档被多裁 ~pendingUser、历史被多丢。
 * 数值设计：全 CJK（1 token/char），pendingUser = 4(用户说：) + userMessage 字数。
 */
describe('assembleWritingIntentContext: pendingUser 只扣一次（不双重扣减）', () => {
  const systemPrompt = 'S'; // 1 token
  const userMessage = '问'.repeat(100); // pendingUser = 104
  const chapterBlock = '章'.repeat(50); // 50 tokens

  it('docBudget 不重复扣 pendingUser：压缩后的文档应保留到正确预算', () => {
    // limit=5000, fixedWithoutDoc=1+0+104+100=205
    // 初始 historyBudget=5000-205-3050=1745 → 800×3 的历史 fit 2 丢 1（used=1600）→ 触发压缩
    // 正确 docBudget = 5000-205-1600-50-500 = 2645 → 裁后 ≈ floor(2645*0.9)+14 = 2394
    // 双重扣减 docBudget = 2541 → 裁后 ≈ 2300
    const result = assembleWritingIntentContext({
      systemPrompt,
      history: [
        { role: 'user', content: '史'.repeat(800) },
        { role: 'assistant', content: '答'.repeat(800) },
        { role: 'user', content: '追'.repeat(800) },
      ],
      chapterBlock,
      documentBlock: `全篇${'档'.repeat(2998)}`, // 3000 tokens，以「全篇」开头免加前缀
      userMessage,
      limitTokens: 5000,
      outputReserve: 100,
    });
    const docTokens = estimateTokens(result.documentBlockForModel);
    expect(docTokens).toBeLessThanOrEqual(2645); // 不超正确预算
    expect(docTokens).toBeGreaterThan(2350); // 双重扣减最多到 ~2300，修后 ~2394
  });

  it('重算 historyBudget 不重复扣 pendingUser：能多保留一轮历史', () => {
    // limit=2400, fixedWithoutDoc=205, doc=50+1000=1050
    // 初始 historyBudget=1145 → 510×4 fit 2（used=1020）→ 触发压缩
    // 正确 docBudget = max(600, 2400-205-1020-50-500)=625 → 裁后 ≈ 562+14=576
    //   → historyBudget = 2400-205-(50+576) = 1569 ≥ 510×3=1530 → fit 3 轮
    // 双重扣减：docBudget=600(钳) → 裁后 ≈554 → historyBudget=2400-205-604-104=1487 < 1530 → 只 fit 2 轮
    const history = [
      { role: 'user' as const, content: '一'.repeat(510) },
      { role: 'assistant' as const, content: '二'.repeat(510) },
      { role: 'user' as const, content: '三'.repeat(510) },
      { role: 'assistant' as const, content: '四'.repeat(510) },
    ];
    const result = assembleWritingIntentContext({
      systemPrompt,
      history,
      chapterBlock,
      documentBlock: `全篇${'档'.repeat(998)}`, // 1000 tokens
      userMessage,
      limitTokens: 2400,
      outputReserve: 100,
    });
    // messages = [system, ...fitted, finalUser] → fitted = length-2
    const fittedCount = result.messages.length - 2;
    expect(fittedCount).toBe(3);
    expect(result.messagesToCompact).toHaveLength(1);
  });
});

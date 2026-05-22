import { describe, it, expect } from 'vitest';
import { computeCallCostCny, MODEL_PRICING } from '../modelPricing.js';

describe('modelPricing.computeCallCostCny', () => {
  it('returns unknownModel=true and cost=0 when modelId is null', () => {
    const r = computeCallCostCny(null, 1000, 500);
    expect(r.unknownModel).toBe(true);
    expect(r.costCny).toBe(0);
  });

  it('returns unknownModel=true and cost=0 for unknown model', () => {
    const r = computeCallCostCny('some/never-heard-of', 1000, 500);
    expect(r.unknownModel).toBe(true);
    expect(r.costCny).toBe(0);
  });

  it('deepseek-chat: 1000 prompt + 1000 completion → ¥0.0020 + ¥0.0080 = ¥0.0100', () => {
    const r = computeCallCostCny('deepseek-chat', 1000, 1000);
    expect(r.unknownModel).toBe(false);
    expect(r.costCny).toBeCloseTo(0.01, 4);
  });

  it('deepseek-reasoner: 2000 prompt + 1000 completion → ¥0.008 + ¥0.016 = ¥0.024', () => {
    const r = computeCallCostCny('deepseek-reasoner', 2000, 1000);
    expect(r.costCny).toBeCloseTo(0.024, 4);
  });

  it('claude-sonnet-4.5: 1000 + 1000 → ¥0.0216 + ¥0.108 = ¥0.1296', () => {
    const r = computeCallCostCny('anthropic/claude-sonnet-4.5', 1000, 1000);
    expect(r.costCny).toBeCloseTo(0.1296, 4);
  });

  it('zero tokens → zero cost (known model)', () => {
    const r = computeCallCostCny('deepseek-chat', 0, 0);
    expect(r.unknownModel).toBe(false);
    expect(r.costCny).toBe(0);
  });

  it('1M tokens does not overflow; result rounded to 4 decimal places', () => {
    const r = computeCallCostCny('deepseek-chat', 1_000_000, 0);
    // 1M / 1000 * 0.002 = 2.0000
    expect(r.costCny).toBe(2.0);
  });

  it('MODEL_PRICING contains both DeepSeek default & deepseek-v4-pro fallback', () => {
    expect(MODEL_PRICING['deepseek-v4-pro']).toBeDefined();
    expect(MODEL_PRICING['deepseek-chat']).toBeDefined();
    expect(MODEL_PRICING['deepseek-reasoner']).toBeDefined();
  });

  it('MODEL_PRICING entries all use positive numbers', () => {
    for (const [model, entry] of Object.entries(MODEL_PRICING)) {
      expect(entry.promptCny, `${model}.promptCny`).toBeGreaterThanOrEqual(0);
      expect(entry.completionCny, `${model}.completionCny`).toBeGreaterThanOrEqual(0);
    }
  });

  it('M5B newly priced models (verified 2026-05-22)', () => {
    const cases: Array<[string, number, number]> = [
      // [modelId, promptTokens, expectedCostCny (approx)]
      ['deepseek-v4-flash', 1000, 0.0011],   // 1000 prompt @ 0.0011/1000
      ['openai/gpt-5.5', 1000, 0.036],       // 1000 prompt @ 0.036/1000
      ['anthropic/claude-opus-4.7', 1000, 0.036],
      ['moonshotai/kimi-k2.6', 1000, 0.0069],
    ];
    for (const [modelId, promptTokens, expected] of cases) {
      const r = computeCallCostCny(modelId, promptTokens, 0);
      expect(r.unknownModel, `${modelId} should be priced`).toBe(false);
      expect(r.costCny, modelId).toBeCloseTo(expected, 3);
    }
  });
});

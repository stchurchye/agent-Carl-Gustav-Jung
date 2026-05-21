import { describe, expect, it } from 'vitest';
import {
  buildLlmClient,
  DEFAULT_MODEL_FOR_PROVIDER,
  resolveModelProfile,
  MODEL_OVERRIDES,
} from '../factory.js';
import { DeepSeekLlmClient } from '../providers/deepseek.js';

describe('llm/factory (M1e Task 11b)', () => {
  it('buildLlmClient(deepseek, ...) → DeepSeekLlmClient with right modelId', () => {
    const c = buildLlmClient({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      apiKey: 'sk-fake',
    });
    expect(c).toBeInstanceOf(DeepSeekLlmClient);
    expect(c.providerId).toBe('deepseek');
    expect(c.modelId).toBe('deepseek-v4-pro');
  });

  it('buildLlmClient(zenmux, ...) → throws "not yet implemented" (task 11c stub)', () => {
    expect(() =>
      buildLlmClient({
        providerId: 'zenmux',
        modelId: 'anthropic/claude-sonnet-4.6',
        apiKey: 'sk-fake',
      }),
    ).toThrow(/zenmux provider not yet implemented/);
  });

  it('buildLlmClient(unknown) → throws "unsupported"', () => {
    expect(() =>
      buildLlmClient({
        providerId: 'bogus' as unknown as 'deepseek',
        modelId: 'x',
        apiKey: 'k',
      }),
    ).toThrow(/unsupported llm provider/);
  });

  it('resolveModelProfile: deepseek default profile uses defaults', () => {
    const p = resolveModelProfile('deepseek', DEFAULT_MODEL_FOR_PROVIDER.deepseek.modelId);
    expect(p.modelId).toBe(DEFAULT_MODEL_FOR_PROVIDER.deepseek.modelId);
    expect(p.defaultTemperature).toBe(0.3);
    expect(p.defaultMaxTokens).toBeGreaterThanOrEqual(4096);
  });

  it('resolveModelProfile: Kimi K2.6 override → temperature=1', () => {
    const p = resolveModelProfile('zenmux', 'moonshotai/kimi-k2.6');
    expect(p.defaultTemperature).toBe(1);
    expect(p.modelId).toBe('moonshotai/kimi-k2.6');
  });

  it('resolveModelProfile: deepseek-reasoner override → maxTokens=8192', () => {
    const p = resolveModelProfile('deepseek', 'deepseek-reasoner');
    expect(p.defaultMaxTokens).toBe(8192);
  });

  it('resolveModelProfile: unknown modelId → falls back to provider defaults + modelId set', () => {
    const p = resolveModelProfile('deepseek', 'deepseek-unknown-v9');
    expect(p.modelId).toBe('deepseek-unknown-v9');
    expect(p.defaultTemperature).toBe(0.3);
  });

  it('MODEL_OVERRIDES is a partial map (no required modelId field, allows pure overrides)', () => {
    // sanity: 至少包含 Kimi K2.6 + deepseek-reasoner
    expect(MODEL_OVERRIDES['moonshotai/kimi-k2.6']).toBeDefined();
    expect(MODEL_OVERRIDES['deepseek-reasoner']).toBeDefined();
  });
});

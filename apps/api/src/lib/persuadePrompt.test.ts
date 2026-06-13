import { describe, expect, it } from 'vitest';
import { buildPersuadeSystemPrompt } from './persuadePrompt.js';

describe('buildPersuadeSystemPrompt', () => {
  it('点明要求 / 软肋 / 雷区 / 露破绽 / JSON / 防越狱', () => {
    const p = buildPersuadeSystemPrompt({
      demand: '去洗澡',
      personality: '傲娇',
      stubbornness: 6,
      softSpot: '零食贿赂',
      landmine: '讲道理',
    });
    expect(p).toContain('去洗澡');
    expect(p).toContain('零食贿赂'); // 软肋写进提示
    expect(p).toContain('讲道理'); // 雷区写进提示
    expect(p).toContain('破绽'); // 要求露破绽暗示软肋
    expect(p).toContain('JSON');
    expect(p).toMatch(/服从|越狱|耍赖/); // 防越狱条款
  });

  it('没给软肋/雷区时也能生成(无破绽段),仍含基本要素', () => {
    const p = buildPersuadeSystemPrompt({ demand: '睡觉', stubbornness: 5 });
    expect(p).toContain('睡觉');
    expect(p).toContain('JSON');
    expect(p).not.toContain('破绽');
  });
});

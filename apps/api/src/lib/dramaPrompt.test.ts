import { describe, expect, it } from 'vitest';
import { buildDramaSayPrompt } from './dramaPrompt.js';

describe('buildDramaSayPrompt', () => {
  it('点明角色 / 场景 / 戏剧意图 / 打分 / JSON / 防越狱', () => {
    const p = buildDramaSayPrompt({
      npcName: '金羽贵妃',
      npcPersonality: '傲慢',
      sceneContext: '前殿初见,贵妃当众刁难新人',
      intent: '不卑不亢地化解刁难,既不示弱也不冒犯',
    });
    expect(p).toContain('金羽贵妃');
    expect(p).toContain('前殿初见');
    expect(p).toContain('不卑不亢地化解刁难'); // 戏剧意图写进提示
    expect(p).toContain('JSON');
    expect(p).toMatch(/0[~\-]?10|0 ?到 ?10|0-10/); // 打分区间
    expect(p).toMatch(/越狱|耍赖|满分|跑题/); // 防越狱条款
  });

  it('缺 personality 也能生成', () => {
    const p = buildDramaSayPrompt({ npcName: '老福嬷嬷', sceneContext: '宫门', intent: '恭谨自报家门' });
    expect(p).toContain('老福嬷嬷');
    expect(p).toContain('恭谨自报家门');
  });
});

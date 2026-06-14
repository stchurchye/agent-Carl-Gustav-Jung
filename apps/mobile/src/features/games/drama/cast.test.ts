import { CAST } from './cast';
import { buildHeaddress } from '../../../pixel/grids/palaceParts';
import { DOG_COATS } from '@xzz/shared';

describe('犬朝后宫 角色立绘完整', () => {
  it('每个角色的头饰 key 都能编译出精灵(不会静默无冠)', () => {
    const bad: string[] = [];
    for (const [id, m] of Object.entries(CAST)) {
      if (m.headdress && !buildHeaddress(m.headdress)) bad.push(`${id}:${m.headdress}`);
    }
    expect(bad).toEqual([]);
  });

  it('犬皇用专属帝冕(emperor),且能编译', () => {
    expect(CAST.quanhuang.headdress).toBe('emperor');
    expect(buildHeaddress('emperor')).not.toBeNull();
  });

  it('所有角色毛色都是合法枚举', () => {
    const ok = new Set<string>(DOG_COATS);
    const bad = Object.entries(CAST)
      .filter(([, m]) => !ok.has(m.dog.coat))
      .map(([id]) => id);
    expect(bad).toEqual([]);
  });
});

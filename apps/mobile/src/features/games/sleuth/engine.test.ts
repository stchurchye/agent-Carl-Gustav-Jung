import {
  DOG_BODIES,
  DOG_COATS,
  DOG_PATTERNS,
  DOG_EARS,
  DOG_TAILS,
  DOG_ACCESSORIES,
  ACCENT_COLORS,
  DOG_PERSONALITIES,
} from '@xzz/shared';
import type { DogConfig } from '@xzz/shared';
import { DEFAULT_DOG } from '@xzz/shared';
import { mulberry32 } from '../shared/rng';
import {
  generateCase,
  minSniffsToSolve,
  randomDog,
  SNIFFABLE_ATTRS,
  survivingSuspects,
} from './engine';

describe('randomDog 种子生成合法狗', () => {
  it('八维都取自对应枚举,且同种子同结果', () => {
    const dog = randomDog(mulberry32(1));
    expect(DOG_BODIES).toContain(dog.body);
    expect(DOG_COATS).toContain(dog.coat);
    expect(DOG_PATTERNS).toContain(dog.pattern);
    expect(DOG_EARS).toContain(dog.ears);
    expect(DOG_TAILS).toContain(dog.tail);
    expect(DOG_ACCESSORIES).toContain(dog.accessory);
    expect(ACCENT_COLORS).toContain(dog.accessoryColor);
    expect(DOG_PERSONALITIES).toContain(dog.personality);

    expect(randomDog(mulberry32(1))).toEqual(dog);
    expect(randomDog(mulberry32(2))).not.toEqual(dog);
  });

  it('SNIFFABLE_ATTRS 正好是 DogConfig 的八个可推理维度', () => {
    expect([...SNIFFABLE_ATTRS].sort()).toEqual(
      ['accessory', 'accessoryColor', 'body', 'coat', 'ears', 'pattern', 'personality', 'tail'],
    );
  });
});

describe('survivingSuspects 按线索排除嫌疑狗', () => {
  const pointyA: DogConfig = { ...DEFAULT_DOG, ears: 'pointy', coat: 'malt' };
  const floppyB: DogConfig = { ...DEFAULT_DOG, ears: 'floppy', coat: 'snow' };
  const pointyC: DogConfig = { ...DEFAULT_DOG, ears: 'pointy', coat: 'ebony' };
  const suspects = [pointyA, floppyB, pointyC];

  it('无线索时所有狗都在场', () => {
    expect(survivingSuspects(suspects, [])).toEqual([0, 1, 2]);
  });

  it('单线索按属性筛掉不符的', () => {
    expect(survivingSuspects(suspects, [{ attr: 'ears', value: 'floppy' }])).toEqual([1]);
    expect(survivingSuspects(suspects, [{ attr: 'ears', value: 'pointy' }])).toEqual([0, 2]);
  });

  it('多线索取交集', () => {
    expect(
      survivingSuspects(suspects, [
        { attr: 'ears', value: 'pointy' },
        { attr: 'coat', value: 'ebony' },
      ]),
    ).toEqual([2]);
  });
});

describe('minSniffsToSolve 最少嗅探数(最小命中集)', () => {
  const culprit: DogConfig = { ...DEFAULT_DOG, ears: 'floppy', coat: 'malt' };
  const diffEarsOnly: DogConfig = { ...DEFAULT_DOG, ears: 'pointy', coat: 'malt' };
  const diffCoatOnly: DogConfig = { ...DEFAULT_DOG, ears: 'floppy', coat: 'snow' };

  it('一个属性就能区分所有其他狗 → 1', () => {
    expect(minSniffsToSolve([culprit, diffEarsOnly], 0)).toBe(1);
  });

  it('两个嫌疑各只在一个不同维度上有别 → 需要 2', () => {
    expect(minSniffsToSolve([culprit, diffEarsOnly, diffCoatOnly], 0)).toBe(2);
  });

  it('存在与真凶完全相同的狗 → 不可解(Infinity)', () => {
    expect(minSniffsToSolve([culprit, { ...culprit }], 0)).toBe(Infinity);
  });

  it('只有真凶一只 → 0(无需嗅探)', () => {
    expect(minSniffsToSolve([culprit], 0)).toBe(0);
  });
});

describe('generateCase 公平可解的关卡', () => {
  it('跨多种子:count 只互不相同、真凶下标合法、预算内保证可解', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = generateCase(mulberry32(seed), { count: 5, budget: 3 });
      expect(c.suspects).toHaveLength(5);
      const keys = c.suspects.map((d) => JSON.stringify(d));
      expect(new Set(keys).size).toBe(5);
      expect(c.culpritIndex).toBeGreaterThanOrEqual(0);
      expect(c.culpritIndex).toBeLessThan(5);
      expect(minSniffsToSolve(c.suspects, c.culpritIndex)).toBeLessThanOrEqual(3);
    }
  });

  it('同种子生成同一关卡(可复现)', () => {
    expect(generateCase(mulberry32(7), { count: 5, budget: 3 })).toEqual(
      generateCase(mulberry32(7), { count: 5, budget: 3 }),
    );
  });
});

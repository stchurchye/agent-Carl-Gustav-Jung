import type { DogConfig } from '@xzz/shared';
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
import { pick } from '../shared/rng';

/** 可“嗅”的属性 = DogConfig 的八个维度,每个都是一条可推理线索 */
export type SniffAttr = keyof DogConfig;

export const SNIFFABLE_ATTRS: SniffAttr[] = [
  'body',
  'coat',
  'pattern',
  'ears',
  'tail',
  'accessory',
  'accessoryColor',
  'personality',
];

/** 一条嗅出的线索:真凶在某维度上的取值 */
export type Clue = { attr: SniffAttr; value: string };

/** 满足全部线索(每条 dog[attr] === value)的嫌疑狗下标 */
export function survivingSuspects(suspects: DogConfig[], clues: Clue[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < suspects.length; i++) {
    if (clues.every((c) => suspects[i][c.attr] === c.value)) out.push(i);
  }
  return out;
}

function popcount(x: number): number {
  let c = 0;
  let v = x;
  while (v) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}

/**
 * 唯一锁定真凶所需的最少嗅探属性数(对各嫌疑“与真凶有别的属性集合”求最小命中集)。
 * 存在与真凶完全相同的狗 → Infinity(永远区分不开);只有真凶一只 → 0。
 * 维度仅 8 个,2^8=256 子集暴力即可,远快于任何启发式且给出精确最小值(公平性需要精确)。
 */
export function minSniffsToSolve(suspects: DogConfig[], culpritIndex: number): number {
  const culprit = suspects[culpritIndex];
  const diffMasks: number[] = [];
  for (let j = 0; j < suspects.length; j++) {
    if (j === culpritIndex) continue;
    let mask = 0;
    for (let i = 0; i < SNIFFABLE_ATTRS.length; i++) {
      if (suspects[j][SNIFFABLE_ATTRS[i]] !== culprit[SNIFFABLE_ATTRS[i]]) mask |= 1 << i;
    }
    if (mask === 0) return Infinity;
    diffMasks.push(mask);
  }
  if (diffMasks.length === 0) return 0;

  const n = SNIFFABLE_ATTRS.length;
  let best = Infinity;
  for (let chosen = 0; chosen < 1 << n; chosen++) {
    if (diffMasks.every((d) => (chosen & d) !== 0)) {
      best = Math.min(best, popcount(chosen));
    }
  }
  return best;
}

/** 一桩案件:一排嫌疑狗 + 其中真凶的下标 */
export type SleuthCase = { suspects: DogConfig[]; culpritIndex: number };

/** 抽 count 只互不相同的狗(组合空间 ~38万,5 只去重几乎零碰撞) */
function distinctDogs(rng: () => number, count: number): DogConfig[] {
  const dogs: DogConfig[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (dogs.length < count && guard++ < 10000) {
    const d = randomDog(rng);
    const key = JSON.stringify(d);
    if (!seen.has(key)) {
      seen.add(key);
      dogs.push(d);
    }
  }
  return dogs;
}

/**
 * 生成一桩“预算内保证可解”的案件:count 只互不相同的嫌疑狗,真凶能在 ≤budget 次嗅探内被唯一锁定。
 * 做法:重采直到命中预算(拒绝采样 → 公平性由构造保证,可在测试里证明)。
 * 兜底:极端情况下取这批里最易解的一桩,保证函数总能终止并返回合法案件。
 */
export function generateCase(
  rng: () => number,
  opts: { count: number; budget: number },
): SleuthCase {
  const { count, budget } = opts;
  let best: SleuthCase | null = null;
  let bestSniffs = Infinity;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const suspects = distinctDogs(rng, count);
    // 用实际长度而非入参 count,避免 distinctDogs 万一没凑够时下标越界
    const culpritIndex = Math.floor(rng() * suspects.length);
    const need = minSniffsToSolve(suspects, culpritIndex);
    if (need <= budget) return { suspects, culpritIndex };
    if (need < bestSniffs) {
      bestSniffs = need;
      best = { suspects, culpritIndex };
    }
  }
  return best ?? { suspects: distinctDogs(rng, count), culpritIndex: 0 };
}

/** 按 rng 生成一只各维度独立随机的狗 */
export function randomDog(rng: () => number): DogConfig {
  return {
    body: pick(DOG_BODIES, rng),
    coat: pick(DOG_COATS, rng),
    pattern: pick(DOG_PATTERNS, rng),
    ears: pick(DOG_EARS, rng),
    tail: pick(DOG_TAILS, rng),
    accessory: pick(DOG_ACCESSORIES, rng),
    accessoryColor: pick(ACCENT_COLORS, rng),
    personality: pick(DOG_PERSONALITIES, rng),
  };
}

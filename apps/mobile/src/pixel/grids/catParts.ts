import type { DogAccessory } from '@xzz/shared';
import type { PixelGrid } from '../types';
import { DOG_EXPRESSION_GRIDS } from './dogParts';

/**
 * 德文卷毛猫(Devon Rex)部件库,24×24,与 dogParts 同一套字符语义与锚点规范:
 * 头 bbox 行2-12 列5-18(眼行6-7 列9-10/13-14,嘴行11-12 列10-13)——
 * 所以五套性格表情直接复用狗的(CAT_EXPRESSION_GRIDS 即 re-export)。
 * 品种特征:超大宽底蝙蝠耳、精灵小尖脸、细脖小身、细长尾;卷毛用 S 波点表现。
 */

const E24 = '........................';

function grid(rows: Array<[number, string, number]>): PixelGrid {
  // 同 dogParts:同一行多段基于当前行拼接
  const g = Array(24).fill(E24) as string[];
  for (const [y, s, x] of rows) {
    const row = g[y];
    g[y] = `${row.slice(0, x)}${s}${row.slice(x + s.length)}`;
  }
  return g;
}

/** 身体(不含眼/嘴/尾/耳):精灵脸 + 细脖 + 小胸卷毛 + 细前腿 */
export const CAT_BODY_GRID: PixelGrid = [
  E24,
  E24,
  '.......IIIIIIIIII.......',
  '......ILLLLLLLLLLI......',
  '.....ILBBBBBBBBBBLI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBLLNNLLBBBI.....',
  '......IBBLLLLLLBBI......',
  '......IBBLLLLLLBBI......',
  '.......ISBLLLLBSI.......',
  '........IBBBBBBI........',
  '.......IBBBBBBBBI.......',
  '.......IBSBBBBSBI.......',
  '.......IBBBSSBBBI.......',
  '.......IBSBBBBSBI.......',
  '.......IBBBBBBBBI.......',
  '.......IBIBBBBIBI.......',
  '.......IBIBBBBIBI.......',
  '.......ILLISSILLI.......',
  '.......IIIIIIIIII.......',
  E24,
];

/** 德文卷毛猫标志性大耳:宽底、低位、外扩(比狗的立耳大一倍),内耳 S */
export const CAT_EAR_GRID: PixelGrid = [
  '...II..............II...',
  '...IBBI..........IBBI...',
  '..IBSSBI........IBSSBI..',
  '..IBSSBBI......IBBSSBI..',
  '..IBBSSBBI....IBBSSBBI..',
  '...IBBBBBI....IBBBBBI...',
  ...Array(18).fill(E24),
];

/** 细长尾:idle 高翘 S 弯;wag 横扫低摆 */
export const CAT_TAIL_GRIDS: { idle: PixelGrid; wag: PixelGrid } = {
  idle: grid([
    [13, 'II', 19],
    [14, 'IBI', 19],
    [15, 'IBI', 18],
    [16, 'IBI', 17],
    [17, 'IBI', 16],
    [18, 'II', 16],
  ]),
  wag: grid([
    [18, 'II', 16],
    [19, 'IBI', 16],
    [20, 'IBBI', 17],
    [21, 'IBI', 19],
    [20, 'II', 21],
  ]),
};

/** 配饰:窄版(猫脖列9-14),锚行13-16;flower 别在左耳根 */
export const CAT_ACCESSORY_GRIDS: Record<Exclude<DogAccessory, 'none'>, PixelGrid> = {
  scarf: grid([
    [13, 'AAAAAA', 9],
    [14, 'AAAAAA', 9],
    [15, 'CAA', 10],
    [16, 'CA', 10],
  ]),
  bell: grid([
    [13, 'IIIIII', 9],
    [14, 'IAAI', 10],
    [15, 'IACI', 10],
    [16, 'II', 11],
  ]),
  bandana: grid([
    [13, 'AAAAAA', 9],
    [14, 'ACCA', 10],
    [15, 'AA', 11],
  ]),
  flower: grid([
    [1, 'AA', 13],
    [2, 'ACA', 12],
    [3, 'AA', 13],
  ]),
};

/** 表情与狗同锚点,直接复用(性格→神态的规范一致) */
export const CAT_EXPRESSION_GRIDS = DOG_EXPRESSION_GRIDS;

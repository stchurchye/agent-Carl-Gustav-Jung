import type { HumanHair } from '@xzz/shared';
import type { PixelGrid } from '../types';

/**
 * 像素小人部件库(16×16)。
 * 字符:'.'透明 F肤 D肤影 H发 O衣主 Q衣浅 I描边 E眼 G眼高光 T舌/嘴 N口腔深。
 * 眼锚点:行4 列6/9;嘴锚点:行5-6 列7-8。发型为头顶叠层。
 */

const E16 = '................';

function grid(rows: Array<[number, string, number]>): PixelGrid {
  // 同一行可多段,基于当前行拼接(不能用 E16,否则后段抹前段)
  const g = Array(16).fill(E16) as string[];
  for (const [y, s, x] of rows) {
    const row = g[y];
    g[y] = `${row.slice(0, x)}${s}${row.slice(x + s.length)}`;
  }
  return g;
}

export const HUMAN_BODY_GRID: PixelGrid = [
  E16,
  '....IIIIIIII....',
  '....IFFFFFFI....',
  '....IFFFFFFI....',
  '....IFFFFFFI....',
  '....IFFFFFFI....',
  '.....IFFFFI.....',
  '......IDDI......',
  '....IOOOOOOI....',
  '...IOOOOOOOOI...',
  '...IOOOOOOOOI...',
  '...IOOQQQQOOI...',
  '....IDI..IDI....',
  '....IDI..IDI....',
  '...IIII..IIII...',
  E16,
];

export const HUMAN_HAIR_GRIDS: Record<HumanHair, PixelGrid> = {
  /** 清爽短发:平刘海 */
  short: grid([
    [0, 'IIIIIIII', 4],
    [1, 'IHHHHHHI', 4],
    [2, 'IHHHHHHI', 4],
  ]),
  /** 齐耳波波:包脸两侧垂下 */
  bob: grid([
    [0, 'IIIIIIII', 4],
    [1, 'IHHHHHHHHI', 3],
    [2, 'IHHHHHHHHI', 3],
    [3, 'IHI', 3],
    [3, 'IHI', 10],
    [4, 'IHI', 3],
    [4, 'IHI', 10],
    [5, 'II', 3],
    [5, 'II', 11],
  ]),
  /** 头顶双丸子 */
  buns: grid([
    [0, 'IHHI', 2],
    [0, 'IHHI', 10],
    [1, 'IHHHHHHHHI', 3],
    [2, 'IHHHHHHI', 4],
  ]),
  /** 锯齿刺头 */
  spiky: grid([
    [0, 'I.I.I.I', 4],
    [1, 'IHIHIHIHI', 3],
    [2, 'IHHHHHHI', 4],
  ]),
};

export const HUMAN_EXPRESSION_GRIDS = {
  eyesOpen: grid([
    [4, 'E', 6],
    [4, 'E', 9],
  ]),
  eyesClosed: grid([
    [4, 'I', 6],
    [4, 'I', 9],
  ]),
  mouthIdle: grid([[6, 'II', 7]]),
  mouthTalk: grid([
    [5, 'II', 7],
    [6, 'TT', 7],
  ]),
};

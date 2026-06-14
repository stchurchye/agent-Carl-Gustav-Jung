import type { PixelGrid } from '../types';

/**
 * 犬朝后宫的全像素场景背景。沿用 compile 的 role→色 体系,但用一套**场景调色板**,
 * 大画布(48×56)组合式构图(分带 + 摆 motif),非角色精灵。
 */
export const SCENE_W = 48;
export const SCENE_H = 56;

/** 场景角色字符 → 颜色(暖调宫廷:朱红 / 鎏金 / 深木 / 石地) */
export const SCENE_COLORS: Record<string, string> = {
  K: '#3D3229', // 深木 / 梁柱描边
  R: '#9E3B2E', // 朱红
  r: '#7A2C22', // 朱红暗
  G: '#C9A24B', // 鎏金
  g: '#A6822F', // 金暗
  W: '#E3CBA0', // 暖墙
  w: '#CDB184', // 墙暗
  F: '#B9A988', // 石地
  f: '#9C8C6C', // 地缝
  D: '#8A2E28', // 帷幔深红
  S: '#EAD9B5', // 室内上方暖光
  N: '#AFC6D6', // 室外天色
  n: '#90AFC2', // 天色暗
  J: '#5E7A4E', // 草木
  j: '#46603A', // 草木暗
  B: '#8C8275', // 石砖
  b: '#73695C', // 砖缝
  L: '#E7A93C', // 灯笼
  l: '#C7842A', // 灯笼暗
};

type Canvas = string[][];

function blank(fill: string): Canvas {
  return Array.from({ length: SCENE_H }, () => Array.from({ length: SCENE_W }, () => fill));
}
function px(c: Canvas, x: number, y: number, ch: string): void {
  if (y >= 0 && y < SCENE_H && x >= 0 && x < SCENE_W) c[y][x] = ch;
}
function rect(c: Canvas, x0: number, y0: number, x1: number, y1: number, ch: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(c, x, y, ch);
}
/** 椭圆盘 */
function disc(c: Canvas, cx: number, cy: number, rx: number, ry: number, ch: string): void {
  for (let y = cy - ry; y <= cy + ry; y++)
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(c, x, y, ch);
    }
}
function toGrid(c: Canvas): PixelGrid {
  return c.map((r) => r.join(''));
}

/** 一根朱红立柱(带金顶座 + 描边) */
function pillar(c: Canvas, x: number, top: number, bottom: number): void {
  rect(c, x, top, x + 4, bottom, 'R');
  rect(c, x + 3, top, x + 4, bottom, 'r'); // 右侧暗面
  rect(c, x, top, x, bottom, 'K'); // 左描边
  rect(c, x + 4, top, x + 4, bottom, 'K'); // 右描边
  rect(c, x, top, x + 4, top + 1, 'G'); // 金顶
  rect(c, x, bottom - 1, x + 4, bottom, 'g'); // 柱础
}

/** 一盏红灯笼 */
function lantern(c: Canvas, x: number, y: number): void {
  px(c, x + 1, y - 1, 'K'); // 挂绳
  rect(c, x, y, x + 2, y + 2, 'L');
  rect(c, x, y + 1, x + 2, y + 1, 'l'); // 中线暗
  rect(c, x, y, x + 2, y, 'g'); // 金顶
  rect(c, x, y + 3, x + 2, y + 3, 'g'); // 金底
}

/** 前殿:金梁 + 红柱 + 帷幔 + 御座 + 石地 */
function hall(): PixelGrid {
  const c = blank('S');
  rect(c, 0, 42, SCENE_W - 1, SCENE_H - 1, 'F'); // 石地
  rect(c, 0, 47, SCENE_W - 1, 47, 'f');
  rect(c, 0, 52, SCENE_W - 1, 52, 'f');
  rect(c, 0, 4, SCENE_W - 1, 41, 'W'); // 后墙
  rect(c, 0, 0, SCENE_W - 1, 3, 'K'); // 屋梁
  rect(c, 0, 3, SCENE_W - 1, 3, 'G'); // 金线
  // 帷幔
  rect(c, 18, 5, 29, 30, 'D');
  rect(c, 18, 5, 29, 6, 'G');
  px(c, 23, 16, 'G');
  px(c, 24, 16, 'G');
  // 御座
  rect(c, 20, 30, 27, 42, 'R');
  rect(c, 20, 30, 20, 42, 'K');
  rect(c, 27, 30, 27, 42, 'K');
  rect(c, 20, 30, 27, 31, 'G');
  rect(c, 17, 40, 30, 42, 'g'); // 座基
  // 红柱
  pillar(c, 5, 4, 42);
  pillar(c, 39, 4, 42);
  // 灯笼
  lantern(c, 12, 7);
  lantern(c, 33, 7);
  return toGrid(c);
}

/** 宫门:檐顶 + 红墙 + 朱红金钉大门(闭合,带门框/门钉)+ 牌匾 + 石阶 */
function gate(): PixelGrid {
  const c = blank('N');
  rect(c, 0, 6, SCENE_W - 1, 9, 'n'); // 远天
  // 红墙
  rect(c, 0, 10, SCENE_W - 1, 44, 'R');
  rect(c, 0, 10, 1, 44, 'r');
  rect(c, SCENE_W - 2, 10, SCENE_W - 1, 44, 'r');
  // 檐顶(深木梁 + 金脊)
  rect(c, 0, 10, SCENE_W - 1, 14, 'K');
  rect(c, 0, 10, SCENE_W - 1, 10, 'G');
  rect(c, 2, 8, SCENE_W - 3, 9, 'r');
  // 牌匾
  rect(c, 18, 16, 29, 21, 'G');
  rect(c, 17, 15, 30, 15, 'K');
  rect(c, 17, 22, 30, 22, 'K');
  rect(c, 17, 15, 17, 22, 'K');
  rect(c, 30, 15, 30, 22, 'K');
  // 大门(闭合朱红双扇,金框)
  const dx0 = 13, dx1 = 34, dy0 = 24, dy1 = 44;
  rect(c, dx0, dy0, dx1, dy1, 'r'); // 门扇(暗红)
  rect(c, dx0, dy0, dx1, dy0, 'G'); // 上框
  rect(c, dx0, dy0, dx0, dy1, 'G'); // 左框
  rect(c, dx1, dy0, dx1, dy1, 'G'); // 右框
  rect(c, 23, dy0, 24, dy1, 'K'); // 中缝
  // 门钉(每扇 2 列 × 4 行)
  for (let r = dy0 + 3; r <= dy1 - 3; r += 5)
    for (const gx of [16, 19, 28, 31]) px(c, gx, r, 'G');
  // 门环
  px(c, 20, 35, 'G');
  px(c, 27, 35, 'G');
  // 石阶
  rect(c, 0, 45, SCENE_W - 1, SCENE_H - 1, 'B');
  rect(c, 0, 49, SCENE_W - 1, 49, 'b');
  rect(c, 0, 53, SCENE_W - 1, 53, 'b');
  return toGrid(c);
}

/** 御花园:天色 + 月亮门 + 草木 + 石径 */
function garden(): PixelGrid {
  const c = blank('N');
  rect(c, 0, 24, SCENE_W - 1, 26, 'n'); // 远景
  rect(c, 0, 40, SCENE_W - 1, SCENE_H - 1, 'J'); // 草地
  rect(c, 0, 44, SCENE_W - 1, 44, 'j');
  // 石径
  rect(c, 19, 44, 28, SCENE_H - 1, 'F');
  rect(c, 19, 48, 28, 48, 'f');
  rect(c, 19, 52, 28, 52, 'f');
  // 院墙 + 月亮门
  rect(c, 8, 10, 39, 41, 'W');
  rect(c, 8, 10, 39, 11, 'K'); // 墙脊
  rect(c, 8, 40, 39, 41, 'w');
  disc(c, 24, 27, 11, 12, 'K'); // 门框
  disc(c, 24, 27, 9, 10, 'N'); // 门内透景
  rect(c, 20, 38, 28, 41, 'N'); // 门下接地
  // 草木
  disc(c, 6, 36, 6, 7, 'J');
  disc(c, 6, 34, 4, 4, 'j');
  disc(c, 42, 36, 6, 7, 'J');
  disc(c, 42, 34, 4, 4, 'j');
  return toGrid(c);
}

export const SCENE_GRIDS: Record<string, PixelGrid> = {
  hall: hall(),
  gate: gate(),
  garden: garden(),
};

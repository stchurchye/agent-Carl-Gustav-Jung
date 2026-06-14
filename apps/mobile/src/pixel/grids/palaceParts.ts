import type { PixelGrid } from '../types';
import { compileSprite } from '../compile';
import type { CompiledSprite } from '../types';

/**
 * 宫廷头饰:24×24 叠层(与狗精灵同尺寸),只在头部区域有像素,绝对定位叠在狗头上。
 * 不动 shared 的 DogConfig 枚举——纯剧情侧装饰,零侵入。
 * 头部锚点:头顶行2-3、眼行6-7、列7-16(避开眼睛,饰品落在额前与头顶)。
 */
export const HEADDRESS_COLORS: Record<string, string> = {
  G: '#D7AE4E', // 金
  H: '#F1D67E', // 金高光
  g: '#A6822F', // 金暗
  R: '#C0392B', // 红宝石
  P: '#FAF6EC', // 珠
  K: '#3D3229', // 描边
};

/** 稀疏写法:全透明底,逐行打补丁 */
function grid24(patches: Array<[number, string, number]>): PixelGrid {
  const g = Array.from({ length: 24 }, () => '.'.repeat(24));
  for (const [y, s, x] of patches) g[y] = `${g[y].slice(0, x)}${s}${g[y].slice(x + s.length)}`;
  return g;
}

/** 凤冠:顶饰 + 额前金带 + 两侧步摇红坠(贵妃/高位) */
const PHOENIX: PixelGrid = grid24([
  [0, 'P', 11],
  [1, 'GPG', 10],
  [2, 'GRRG', 10],
  [3, 'GGGGGG', 9],
  [4, 'GHHHHHHG', 8],
  [5, 'GGGGGGGG', 8],
  [6, 'R', 8],
  [6, 'R', 15],
  [7, 'P', 8],
  [7, 'P', 15],
]);

/** 步摇:一侧小金钗 + 红坠(低位/姐妹) */
const BUYAO: PixelGrid = grid24([
  [3, 'GH', 14],
  [4, 'GRG', 14],
  [5, 'GG', 14],
  [6, 'R', 15],
  [7, 'P', 15],
]);

/** 朝冠:素净金额带 + 中央红点(嬷嬷/内官) */
const COURT: PixelGrid = grid24([
  [4, 'KKKKKKKK', 8],
  [5, 'GGGGGGGG', 8],
  [5, 'R', 11],
]);

const HEADDRESS_GRIDS: Record<string, PixelGrid> = {
  phoenix: PHOENIX,
  buyao: BUYAO,
  court: COURT,
};

const cache = new Map<string, CompiledSprite>();

/** 头饰 key → 编译精灵(模块级缓存);未知 key 返回 null */
export function buildHeaddress(key: string): CompiledSprite | null {
  const grid = HEADDRESS_GRIDS[key];
  if (!grid) return null;
  const hit = cache.get(key);
  if (hit) return hit;
  const compiled = compileSprite(grid, HEADDRESS_COLORS);
  cache.set(key, compiled);
  return compiled;
}

export const HEADDRESS_KEYS = Object.keys(HEADDRESS_GRIDS);
export { HEADDRESS_GRIDS };

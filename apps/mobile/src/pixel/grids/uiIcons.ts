/**
 * 通用 UI 像素图标（10×10 字符画布）。
 * 角色: B = 主色, '.' = 透明。
 * 用 buildUiIconSprite(key, color) 编译。
 */

import { compileSprite } from '../compile';
import type { CompiledSprite, PixelGrid } from '../types';

/** 扬声器 + 声波点 */
const ICON_SOUND: PixelGrid = [
  '..........',
  '....BB....',
  '...BBB.B..',
  '..BBBBBBB.',
  '..BBBBBBB.',
  '..BBBBBBB.',
  '..BBBBBBB.',
  '...BBB.B..',
  '....BB....',
  '..........',
];

/** 问号 = 帮助/使用提示面板 */
const ICON_MENU: PixelGrid = [
  '..........',
  '...BBBB...',
  '..BB..BB..',
  '.......BB.',
  '......BB..',
  '.....BB...',
  '.....BB...',
  '..........',
  '.....BB...',
  '..........',
];

/** Z 形闪电 = AI 模式开关 */
const ICON_AI: PixelGrid = [
  '..........',
  '....BBB...',
  '...BB.....',
  '..BB......',
  '.BBBBBB...',
  '...BBBBBB.',
  '......BB..',
  '.....BB...',
  '....BBB...',
  '..........',
];

export type UiIconKey = 'sound' | 'menu' | 'ai';

const GRIDS: Record<UiIconKey, PixelGrid> = {
  sound: ICON_SOUND,
  menu: ICON_MENU,
  ai: ICON_AI,
};

const _cache = new Map<string, CompiledSprite>();

export function buildUiIconSprite(key: UiIconKey, color: string): CompiledSprite {
  const cacheKey = `${key}:${color}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;
  const sprite = compileSprite(GRIDS[key], { B: color });
  _cache.set(cacheKey, sprite);
  return sprite;
}

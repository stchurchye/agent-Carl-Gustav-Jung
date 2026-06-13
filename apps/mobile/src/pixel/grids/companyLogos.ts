/**
 * 模型公司像素 logo（10×10 字符画布）。
 * 角色: B = 主色, S = 暗部, '.' = 透明。
 * 渲染时由 buildCompanySprite 将 B/S 映射到各公司品牌色。
 */

import { compileSprite } from '../compile';
import type { CompiledSprite, PixelGrid } from '../types';

/**
 * Anthropic / Claude：橙色放射星芒形（品牌标志抽象）
 * 中心实心方块 + 8 方向放射臂，模拟 Claude 多瓣旋转 logo 的像素版。
 */
const ANTHROPIC: PixelGrid = [
  '..B....B..',
  '...B..B...',
  '....BB....',
  '.BBBBBBBB.',
  'BBBBBBBBBB',
  'BBBBBBBBBB',
  '.BBBBBBBB.',
  '....BB....',
  '...B..B...',
  '..B....B..',
];

/**
 * OpenAI / GPT：圆环 + 内置十字臂
 * 外圈 = 品牌圆形轮廓；内臂 = 多瓣旋转标志的像素简化。
 */
const OPENAI: PixelGrid = [
  '..BBBBBB..',
  '.BB....BB.',
  'B..BBBB..B',
  'B.BB..BB.B',
  'B.B....B.B',
  'B.B....B.B',
  'B.BB..BB.B',
  'B..BBBB..B',
  '.BB....BB.',
  '..BBBBBB..',
];

/**
 * Kimi / MoonShot：真月牙剪影
 * 外圆弧从右上划向左下，向右翘起的两个月角 = 经典新月外形。
 */
const KIMI: PixelGrid = [
  '..........',
  '....BBBB..',
  '..BBBB....',
  '.BBBBB....',
  'BBBBBB....',
  'BBBBBB....',
  '.BBBBB....',
  '..BBBB....',
  '....BBBB..',
  '..........',
];

/**
 * DeepSeek：蓝色鲸鱼剪影
 * 圆润身体弧线 + 底部 V 形尾鳍，模拟品牌鲸鱼跃出水面的姿态。
 */
const DEEPSEEK: PixelGrid = [
  '..........',
  '...BBBB...',
  '..BBBBBB..',
  '.BBBBBBBB.',
  '..BBBBBBB.',
  '...BBBBB..',
  '....BBB...',
  '..BB..BB..',
  '.BB....BB.',
  '..........',
];

/**
 * Qwen / Alibaba 通义：圆环 + 内置旋涡臂
 * 圆形外廓 + 从右侧切入向内卷曲的流线臂，模拟通义千问的圆弧流线标志。
 */
const QWEN: PixelGrid = [
  '..BBBBBB..',
  '.BB....BB.',
  'B......BBB',
  'B....BBB..',
  'B...BBB...',
  'B......BB.',
  '.BB....BB.',
  '..BBBBBB..',
  '..........',
  '..........',
];

export type CompanyLogoKey = 'anthropic' | 'openai' | 'kimi' | 'deepseek' | 'qwen';

const GRIDS: Record<CompanyLogoKey, PixelGrid> = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  kimi: KIMI,
  deepseek: DEEPSEEK,
  qwen: QWEN,
};

function hexDarken(hex: string, amount = 0.3): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const _cache = new Map<string, CompiledSprite>();

/** 按 companyId + brandColor 编译并缓存 logo 精灵 */
export function buildCompanySprite(key: CompanyLogoKey, brandColor: string): CompiledSprite {
  const cacheKey = `${key}:${brandColor}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const grid = GRIDS[key] ?? GRIDS.openai;
  const sprite = compileSprite(grid, {
    B: brandColor,
    S: hexDarken(brandColor),
  });
  _cache.set(cacheKey, sprite);
  return sprite;
}

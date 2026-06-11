import type { AccentColor, DogCoat, DogPersonality, HumanHairColor, HumanSkin } from '@xzz/shared';
import type { CharacterMotion } from './types';

/** 统一描边(= tokens.ts 阴影色),全员同一描边是像素风"高级感"的关键 */
export const INK = '#3D3229';
/** 眼/鼻深色 */
export const EYE = '#2A231C';
export const GLEAM = '#FFFFFF';
export const TONGUE = '#E8837E';
/** 花纹白(雪白毛色的 light,白脸/白手套用) */
export const PATCH_WHITE = '#FAF6EC';
/** 斑点深色 */
export const SPOT_DARK = '#36312B';

/** 毛色三阶:base/shade/light,统一灰度暖化,与 app 暖调主题(oat/crail)同族 */
export const COAT_COLORS: Record<DogCoat, { base: string; shade: string; light: string }> = {
  cream: { base: '#F2E3C8', shade: '#D9C39A', light: '#FAF1DE' },
  malt: { base: '#D9975D', shade: '#B5713B', light: '#EFD3AE' },
  terra: { base: '#C96F4A', shade: '#A1502F', light: '#E8B898' },
  cocoa: { base: '#8C5A3C', shade: '#6B4129', light: '#B98A64' },
  ebony: { base: '#4A443E', shade: '#36312B', light: '#6E675F' },
  mist: { base: '#A39B8F', shade: '#837B6F', light: '#C6BFB3' },
  snow: { base: '#FAF6EC', shade: '#E2DACA', light: '#FFFFFF' },
  tanpoint: { base: '#3D352B', shade: '#2A231C', light: '#C98F5A' },
};

/** 配饰色:取自 avatarPalette 暖 8 色子集,main+soft 两阶 */
export const ACCENT_PAIRS: Record<AccentColor, { main: string; soft: string }> = {
  brick: { main: '#B3542F', soft: '#D98B6A' },
  olive: { main: '#5A7340', soft: '#8AA36B' },
  indigo: { main: '#576B95', soft: '#8B9BC1' },
  gold: { main: '#8F6000', soft: '#C29A3D' },
  plum: { main: '#7E5A8C', soft: '#A989B5' },
  teal: { main: '#2F7D6D', soft: '#67A99B' },
};

export const SKIN_COLORS: Record<HumanSkin, { base: string; shade: string }> = {
  fair: { base: '#F2D6B8', shade: '#D9B894' },
  tan: { base: '#D9A878', shade: '#BC8C5F' },
  deep: { base: '#8C5A3C', shade: '#6B4129' },
};

export const HAIR_COLORS: Record<HumanHairColor, string> = {
  ink: '#2A231C',
  brown: '#6B4129',
  grey: '#837B6F',
};

/** 性格 → 动画参数:同一只狗换性格,神态节奏立刻不同 */
export const PERSONALITY_MOTION: Record<DogPersonality, CharacterMotion> = {
  playful: { blinkMinMs: 2200, blinkMaxMs: 4200, wagMs: 280, bounceRatio: 0.06 },
  calm: { blinkMinMs: 3800, blinkMaxMs: 6500, wagMs: 700, bounceRatio: 0.03 },
  sassy: { blinkMinMs: 4200, blinkMaxMs: 7000, wagMs: 900, bounceRatio: 0.04 },
  sweet: { blinkMinMs: 3000, blinkMaxMs: 5500, wagMs: 420, bounceRatio: 0.05 },
  goofy: { blinkMinMs: 2400, blinkMaxMs: 4600, wagMs: 320, bounceRatio: 0.07 },
};

/** 人的动画参数(无尾) */
export const HUMAN_MOTION: CharacterMotion = {
  blinkMinMs: 3200,
  blinkMaxMs: 6000,
  wagMs: 0,
  bounceRatio: 0.04,
};

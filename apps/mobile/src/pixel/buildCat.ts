import type { CatConfig } from '@xzz/shared';
import {
  ACCENT_PAIRS,
  COAT_COLORS,
  EYE,
  GLEAM,
  INK,
  PATCH_WHITE,
  SPOT_DARK,
  TONGUE,
} from './palette';
import { composeGrids } from './compose';
import { compileSprite } from './compile';
import type { CompiledCharacter, PixelGrid } from './types';
import {
  CAT_ACCESSORY_GRIDS,
  CAT_BODY_GRID,
  CAT_EAR_GRID,
  CAT_EXPRESSION_GRIDS,
  CAT_TAIL_GRIDS,
} from './grids/catParts';

const cache = new Map<string, CompiledCharacter>();

/** 德文卷毛猫:与 buildDogCharacter 同管线/同色板/同缓存策略 */
export function buildCatCharacter(config: CatConfig): CompiledCharacter {
  const key = JSON.stringify(config);
  const hit = cache.get(key);
  if (hit) return hit;

  const coat = COAT_COLORS[config.coat];
  const accent = ACCENT_PAIRS[config.accessoryColor];
  const roleColors: Record<string, string> = {
    B: coat.base,
    S: coat.shade,
    L: coat.light,
    I: INK,
    N: EYE,
    E: EYE,
    G: GLEAM,
    W: PATCH_WHITE,
    K: SPOT_DARK,
    T: TONGUE,
    A: accent.main,
    C: accent.soft,
  };

  const overlays: PixelGrid[] = [CAT_EAR_GRID];
  if (config.accessory !== 'none') overlays.push(CAT_ACCESSORY_GRIDS[config.accessory]);
  const baseGrid = composeGrids(CAT_BODY_GRID, ...overlays);

  const expr = CAT_EXPRESSION_GRIDS[config.personality];
  const built: CompiledCharacter = {
    size: 24,
    base: compileSprite(baseGrid, roleColors),
    eyesOpen: compileSprite(expr.eyesOpen, roleColors),
    eyesClosed: compileSprite(expr.eyesClosed, roleColors),
    mouthIdle: compileSprite(expr.mouthIdle, roleColors),
    mouthTalk: compileSprite(expr.mouthTalk, roleColors),
    tailIdle: compileSprite(CAT_TAIL_GRIDS.idle, roleColors),
    tailWag: compileSprite(CAT_TAIL_GRIDS.wag, roleColors),
    still: compileSprite(
      composeGrids(baseGrid, expr.eyesOpen, expr.mouthIdle, CAT_TAIL_GRIDS.idle),
      roleColors,
    ),
  };
  cache.set(key, built);
  return built;
}

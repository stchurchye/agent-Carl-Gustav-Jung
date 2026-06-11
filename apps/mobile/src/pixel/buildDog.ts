import type { DogConfig } from '@xzz/shared';
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
import { applyPattern, composeGrids } from './compose';
import { compileSprite } from './compile';
import type { CompiledCharacter, PixelGrid } from './types';
import {
  DOG_ACCESSORY_GRIDS,
  DOG_BODY_GRIDS,
  DOG_EAR_GRIDS,
  DOG_EXPRESSION_GRIDS,
  DOG_PATTERN_GRIDS,
  DOG_TAIL_GRIDS,
} from './grids/dogParts';

const cache = new Map<string, CompiledCharacter>();

/** config → 编译角色;模块级缓存(同配置同引用,React.memo 友好) */
export function buildDogCharacter(config: DogConfig): CompiledCharacter {
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

  const body = applyPattern(DOG_BODY_GRIDS[config.body], DOG_PATTERN_GRIDS[config.pattern]);
  const overlays: PixelGrid[] = [DOG_EAR_GRIDS[config.ears]];
  if (config.accessory !== 'none') overlays.push(DOG_ACCESSORY_GRIDS[config.accessory]);
  const baseGrid = composeGrids(body, ...overlays);

  const expr = DOG_EXPRESSION_GRIDS[config.personality];
  const tail = DOG_TAIL_GRIDS[config.tail];
  const built: CompiledCharacter = {
    size: 24,
    base: compileSprite(baseGrid, roleColors),
    eyesOpen: compileSprite(expr.eyesOpen, roleColors),
    eyesClosed: compileSprite(expr.eyesClosed, roleColors),
    mouthIdle: compileSprite(expr.mouthIdle, roleColors),
    mouthTalk: compileSprite(expr.mouthTalk, roleColors),
    tailIdle: compileSprite(tail.idle, roleColors),
    tailWag: compileSprite(tail.wag, roleColors),
    still: compileSprite(
      composeGrids(baseGrid, expr.eyesOpen, expr.mouthIdle, tail.idle),
      roleColors,
    ),
  };
  cache.set(key, built);
  return built;
}

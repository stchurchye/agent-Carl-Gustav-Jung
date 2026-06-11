import type { HumanConfig } from '@xzz/shared';
import { ACCENT_PAIRS, EYE, GLEAM, HAIR_COLORS, INK, PATCH_WHITE, SKIN_COLORS, TONGUE } from './palette';
import { composeGrids } from './compose';
import { compileSprite } from './compile';
import type { CompiledCharacter } from './types';
import { HUMAN_BODY_GRID, HUMAN_EXPRESSION_GRIDS, HUMAN_HAIR_GRIDS } from './grids/humanParts';

const cache = new Map<string, CompiledCharacter>();

export function buildHumanCharacter(config: HumanConfig): CompiledCharacter {
  const key = JSON.stringify(config);
  const hit = cache.get(key);
  if (hit) return hit;

  const skin = SKIN_COLORS[config.skin];
  const outfit = ACCENT_PAIRS[config.outfit];
  const roleColors: Record<string, string> = {
    F: skin.base,
    D: skin.shade,
    H: HAIR_COLORS[config.hairColor],
    O: outfit.main,
    Q: outfit.soft,
    I: INK,
    E: EYE,
    G: GLEAM,
    W: PATCH_WHITE,
    T: TONGUE,
  };

  const baseGrid = composeGrids(HUMAN_BODY_GRID, HUMAN_HAIR_GRIDS[config.hair]);
  const expr = HUMAN_EXPRESSION_GRIDS;
  const built: CompiledCharacter = {
    size: 16,
    base: compileSprite(baseGrid, roleColors),
    eyesOpen: compileSprite(expr.eyesOpen, roleColors),
    eyesClosed: compileSprite(expr.eyesClosed, roleColors),
    mouthIdle: compileSprite(expr.mouthIdle, roleColors),
    mouthTalk: compileSprite(expr.mouthTalk, roleColors),
    still: compileSprite(composeGrids(baseGrid, expr.eyesOpen, expr.mouthIdle), roleColors),
  };
  cache.set(key, built);
  return built;
}

import { presetDogForSeed, presetHumanForSeed, type PixelAvatarSettings } from '@xzz/shared';
import { buildDogCharacter } from '../../pixel/buildDog';
import { buildHumanCharacter } from '../../pixel/buildHuman';
import { HUMAN_MOTION, PERSONALITY_MOTION } from '../../pixel/palette';
import type { ResolvedCharacter } from './components/StageView';
import type { StageActor } from './stageTypes';

/**
 * actor → 编译角色。pixelMap 按 userId 提供各自的 pixelAvatar
 * ('self' 键 = 私聊里自己的配置);没配置的按 seed 落到预设(人人有狗)。
 */
export function resolveStageCharacter(
  actor: StageActor,
  pixelMap: ReadonlyMap<string, PixelAvatarSettings | null | undefined>,
): ResolvedCharacter {
  if (actor.kind === 'dog') {
    const ownerKey = actor.id === 'dog:self' ? 'self' : actor.id.slice('dog:'.length);
    const dog = pixelMap.get(ownerKey)?.dog ?? presetDogForSeed(actor.seed).dog;
    return { character: buildDogCharacter(dog), motion: PERSONALITY_MOTION[dog.personality] };
  }
  const userKey = actor.id.startsWith('user:') ? actor.id.slice('user:'.length) : actor.seed;
  const human = pixelMap.get(userKey)?.human ?? presetHumanForSeed(actor.seed).human;
  return { character: buildHumanCharacter(human), motion: HUMAN_MOTION };
}

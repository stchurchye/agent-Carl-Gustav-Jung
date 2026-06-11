import { presetDogForSeed, presetHumanForSeed, type PixelAvatarSettings } from '@xzz/shared';
import { buildCatCharacter } from '../../pixel/buildCat';
import { buildDogCharacter } from '../../pixel/buildDog';
import { buildHumanCharacter } from '../../pixel/buildHuman';
import { HUMAN_MOTION, PERSONALITY_MOTION } from '../../pixel/palette';
import { HUMAN_REACTIONS, petReactionsFor } from './petReactions';
import type { ResolvedCharacter } from './components/StageView';
import type { StageActor } from './stageTypes';

/**
 * actor → 编译角色。pixelMap 按 userId 提供各自的 pixelAvatar
 * ('self' 键 = 私聊里自己的配置);没配置的按 seed 落到预设(人人有狗)。
 * species=cat 时 agent 渲染成德文卷毛猫;摸一摸彩蛋按 物种×性格 分级。
 */
export function resolveStageCharacter(
  actor: StageActor,
  pixelMap: ReadonlyMap<string, PixelAvatarSettings | null | undefined>,
): ResolvedCharacter {
  if (actor.kind === 'dog') {
    const ownerKey = actor.id === 'dog:self' ? 'self' : actor.id.slice('dog:'.length);
    const settings = pixelMap.get(ownerKey);
    if (settings?.species === 'cat' && settings.cat) {
      return {
        character: buildCatCharacter(settings.cat),
        motion: PERSONALITY_MOTION[settings.cat.personality],
        reactions: petReactionsFor('cat', settings.cat.personality),
      };
    }
    const dog = settings?.dog ?? presetDogForSeed(actor.seed).dog;
    return {
      character: buildDogCharacter(dog),
      motion: PERSONALITY_MOTION[dog.personality],
      reactions: petReactionsFor('dog', dog.personality),
    };
  }
  const userKey = actor.id.startsWith('user:') ? actor.id.slice('user:'.length) : actor.seed;
  const human = pixelMap.get(userKey)?.human ?? presetHumanForSeed(actor.seed).human;
  return {
    character: buildHumanCharacter(human),
    motion: HUMAN_MOTION,
    reactions: HUMAN_REACTIONS,
  };
}

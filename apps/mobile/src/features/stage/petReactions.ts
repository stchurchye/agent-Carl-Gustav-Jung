import type { AvatarSpecies, DogPersonality } from '@xzz/shared';

/**
 * 摸狗/摸猫彩蛋:连点按 物种×性格 轮换不同反应(ActorSlot 用 count % len 取)。
 * 第一条保持简短拟声(汪/喵),后面越摸越亲。
 */
const DOG_REACTIONS: Record<DogPersonality, string[]> = {
  playful: ['汪!', '汪汪汪!', '(开心转圈)'],
  calm: ['汪。', '(平静地看着你)', '(尾巴轻轻摆了一下)'],
  sassy: ['哼。', '汪?', '(勉为其难地被摸了)'],
  sweet: ['呜~', '(蹭蹭你)', '汪!'],
  goofy: ['汪?', '(歪头)', '(倒地露肚皮)'],
};

const CAT_REACTIONS: Record<DogPersonality, string[]> = {
  playful: ['喵!', '喵喵!', '(扑过来)'],
  calm: ['喵。', '(眯起眼睛)', '(尾巴尖动了动)'],
  sassy: ['哼喵。', '(甩了甩尾巴)', '(转过头去)'],
  sweet: ['喵~', '(咕噜咕噜)', '(蹭蹭你)'],
  goofy: ['喵?', '(歪头)', '(追自己的尾巴)'],
};

export function petReactionsFor(
  species: AvatarSpecies,
  personality: DogPersonality,
): string[] {
  return species === 'cat' ? CAT_REACTIONS[personality] : DOG_REACTIONS[personality];
}

export const HUMAN_REACTIONS = ['!'];

import type { DogConfig } from '@xzz/shared';
import { DEFAULT_DOG } from '@xzz/shared';
import type { CharId } from './story';

/** 犬朝后宫角色:id → 名号 + 像素狗立绘配置(宫廷配饰在 D4 叠加) */
export type CastMember = { name: string; dog: DogConfig };

/** 原创人物(全原创,非任何版权作品角色) */
export const CAST: Record<CharId, CastMember> = {
  // 主角:新入宫的低位答应
  xuetuan: {
    name: '雪团',
    dog: { ...DEFAULT_DOG, coat: 'snow', ears: 'floppy', tail: 'fluffy', personality: 'calm' },
  },
  // 把门嬷嬷
  laofu: {
    name: '老福嬷嬷',
    dog: { ...DEFAULT_DOG, coat: 'cocoa', ears: 'fold', tail: 'stub', personality: 'sassy' },
  },
  // 当红贵妃·对手
  jinyu: {
    name: '金羽贵妃',
    dog: { ...DEFAULT_DOG, coat: 'cream', ears: 'pointy', tail: 'curl', accessory: 'flower', accessoryColor: 'gold', personality: 'sassy' },
  },
  // 结盟姐妹
  molan: {
    name: '墨兰',
    dog: { ...DEFAULT_DOG, coat: 'ebony', ears: 'longdrop', tail: 'straight', personality: 'sweet' },
  },
};

export function castMember(id: CharId): CastMember | null {
  return CAST[id] ?? null;
}

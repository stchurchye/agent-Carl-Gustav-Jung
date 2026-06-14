import type { DogConfig } from '@xzz/shared';
import { DEFAULT_DOG } from '@xzz/shared';
import type { CharId } from './story';

/** 犬朝后宫角色:id → 名号 + 像素狗立绘 + 宫廷头饰(叠层 key) */
export type CastMember = { name: string; dog: DogConfig; headdress?: string };

/** 原创人物(全原创,非任何版权作品角色) */
export const CAST: Record<CharId, CastMember> = {
  // 主角:新入宫的低位答应,素净步摇
  xuetuan: {
    name: '雪团',
    dog: { ...DEFAULT_DOG, coat: 'snow', ears: 'floppy', tail: 'fluffy', personality: 'calm' },
    headdress: 'buyao',
  },
  // 把门嬷嬷:朝冠
  laofu: {
    name: '老福嬷嬷',
    dog: { ...DEFAULT_DOG, coat: 'cocoa', ears: 'fold', tail: 'stub', personality: 'sassy' },
    headdress: 'court',
  },
  // 当红贵妃·对手:凤冠
  jinyu: {
    name: '金羽贵妃',
    dog: { ...DEFAULT_DOG, coat: 'cream', ears: 'pointy', tail: 'curl', accessory: 'flower', accessoryColor: 'gold', personality: 'sassy' },
    headdress: 'phoenix',
  },
  // 结盟姐妹:步摇
  molan: {
    name: '墨兰',
    dog: { ...DEFAULT_DOG, coat: 'ebony', ears: 'longdrop', tail: 'straight', personality: 'sweet' },
    headdress: 'buyao',
  },
  // 犬朝之主·圣眷所系:赭红威仪 + 专属帝冕
  quanhuang: {
    name: '犬皇',
    dog: { ...DEFAULT_DOG, body: 'sturdy', coat: 'terra', ears: 'pointy', tail: 'curl', personality: 'calm' },
    headdress: 'emperor',
  },
  // 幕后至高权柄·立后定夺:银发沉静 + 最隆重太后冠
  taihou: {
    name: '太后',
    dog: { ...DEFAULT_DOG, body: 'sturdy', coat: 'mist', ears: 'fold', tail: 'curl', personality: 'calm' },
    headdress: 'taihou',
  },
};

export function castMember(id: CharId): CastMember | null {
  return CAST[id] ?? null;
}

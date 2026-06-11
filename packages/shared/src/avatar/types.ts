/**
 * Bow wow know 像素形象配置(存 users.pixel_avatar JSONB)。
 * 全枚举字段:服务端只存配置,渲染永远在客户端(SVG),所以序列化天然 <1KB。
 */

export const DOG_BODIES = ['round', 'slim', 'sturdy', 'long'] as const;
export type DogBody = (typeof DOG_BODIES)[number];

/** 毛色 id;三阶色值(base/shade/light)在 mobile 端 palette 定义 */
export const DOG_COATS = [
  'cream',
  'malt',
  'terra',
  'cocoa',
  'ebony',
  'mist',
  'snow',
  'tanpoint',
] as const;
export type DogCoat = (typeof DOG_COATS)[number];

export const DOG_PATTERNS = ['solid', 'patch', 'mask', 'socks', 'spots'] as const;
export type DogPattern = (typeof DOG_PATTERNS)[number];

export const DOG_EARS = ['pointy', 'floppy', 'fold', 'longdrop'] as const;
export type DogEars = (typeof DOG_EARS)[number];

export const DOG_TAILS = ['curl', 'straight', 'stub', 'fluffy'] as const;
export type DogTail = (typeof DOG_TAILS)[number];

export const DOG_ACCESSORIES = ['none', 'scarf', 'bell', 'bandana', 'flower'] as const;
export type DogAccessory = (typeof DOG_ACCESSORIES)[number];

export const ACCENT_COLORS = ['brick', 'olive', 'indigo', 'gold', 'plum', 'teal'] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

/** 性格:决定表情部件(眼/嘴)与动画参数(眨眼/摇尾/弹跳),不只是文案 */
export const DOG_PERSONALITIES = ['playful', 'calm', 'sassy', 'sweet', 'goofy'] as const;
export type DogPersonality = (typeof DOG_PERSONALITIES)[number];

export type DogConfig = {
  body: DogBody;
  coat: DogCoat;
  pattern: DogPattern;
  ears: DogEars;
  tail: DogTail;
  accessory: DogAccessory;
  accessoryColor: AccentColor;
  personality: DogPersonality;
};

export const HUMAN_SKINS = ['fair', 'tan', 'deep'] as const;
export type HumanSkin = (typeof HUMAN_SKINS)[number];

export const HUMAN_HAIRS = ['short', 'bob', 'buns', 'spiky'] as const;
export type HumanHair = (typeof HUMAN_HAIRS)[number];

export const HUMAN_HAIR_COLORS = ['ink', 'brown', 'grey'] as const;
export type HumanHairColor = (typeof HUMAN_HAIR_COLORS)[number];

export type HumanConfig = {
  skin: HumanSkin;
  hair: HumanHair;
  hairColor: HumanHairColor;
  outfit: AccentColor;
};

export type PixelAvatarSettings = {
  v: 1;
  dog: DogConfig;
  human: HumanConfig;
};

export const DEFAULT_DOG: DogConfig = {
  body: 'sturdy',
  coat: 'malt',
  pattern: 'mask',
  ears: 'pointy',
  tail: 'curl',
  accessory: 'none',
  accessoryColor: 'brick',
  personality: 'playful',
};

export const DEFAULT_HUMAN: HumanConfig = {
  skin: 'fair',
  hair: 'short',
  hairColor: 'ink',
  outfit: 'indigo',
};

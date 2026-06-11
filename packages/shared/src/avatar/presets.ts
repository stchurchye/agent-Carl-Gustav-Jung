import type { DogConfig, HumanConfig } from './types.js';

export type DogPreset = { id: string; name: string; dog: DogConfig };
export type HumanPreset = { id: string; name: string; human: HumanConfig };

function d(
  id: string,
  name: string,
  body: DogConfig['body'],
  coat: DogConfig['coat'],
  pattern: DogConfig['pattern'],
  ears: DogConfig['ears'],
  tail: DogConfig['tail'],
  accessory: DogConfig['accessory'],
  accessoryColor: DogConfig['accessoryColor'],
  personality: DogConfig['personality'],
): DogPreset {
  return { id, name, dog: { body, coat, pattern, ears, tail, accessory, accessoryColor, personality } };
}

/**
 * 36 只策展狗:体型/毛色/花纹/耳/尾/配饰/性格组合,
 * 两两差异 ≥2 维(avatar.test.ts 守门),保证网格里观感各异。
 */
export const DOG_PRESETS: DogPreset[] = [
  d('shiba', '柴柴', 'sturdy', 'malt', 'mask', 'pointy', 'curl', 'none', 'brick', 'playful'),
  d('kuroshiba', '黑柴', 'sturdy', 'ebony', 'mask', 'pointy', 'curl', 'none', 'brick', 'calm'),
  d('akita', '秋田', 'sturdy', 'cream', 'mask', 'pointy', 'curl', 'scarf', 'brick', 'sassy'),
  d('corgi', '柯基', 'long', 'malt', 'socks', 'pointy', 'stub', 'none', 'gold', 'sweet'),
  d('dachs', '腊肠', 'long', 'cocoa', 'solid', 'floppy', 'straight', 'none', 'brick', 'sassy'),
  d('husky', '二哈', 'slim', 'mist', 'mask', 'pointy', 'fluffy', 'none', 'indigo', 'goofy'),
  d('malamute', '阿拉斯加', 'sturdy', 'mist', 'mask', 'floppy', 'fluffy', 'none', 'indigo', 'calm'),
  d('golden', '金毛', 'sturdy', 'cream', 'solid', 'floppy', 'fluffy', 'none', 'gold', 'sweet'),
  d('lab', '拉布拉多', 'sturdy', 'ebony', 'solid', 'floppy', 'straight', 'none', 'teal', 'playful'),
  d('dalmatian', '斑点', 'slim', 'snow', 'spots', 'floppy', 'straight', 'none', 'brick', 'playful'),
  d('poodle', '泰迪', 'round', 'terra', 'solid', 'fold', 'stub', 'none', 'plum', 'sweet'),
  d('bichon', '比熊', 'round', 'snow', 'solid', 'fold', 'curl', 'flower', 'plum', 'sweet'),
  d('pug', '巴哥', 'round', 'malt', 'mask', 'fold', 'curl', 'none', 'olive', 'goofy'),
  d('frenchie', '法斗', 'sturdy', 'mist', 'patch', 'pointy', 'stub', 'none', 'teal', 'goofy'),
  d('border', '边牧', 'slim', 'ebony', 'mask', 'fold', 'fluffy', 'none', 'olive', 'calm'),
  d('jack', '杰克罗素', 'slim', 'snow', 'patch', 'fold', 'straight', 'none', 'brick', 'playful'),
  d('samoyed', '萨摩耶', 'round', 'snow', 'solid', 'pointy', 'fluffy', 'none', 'indigo', 'sweet'),
  d('chow', '松狮', 'round', 'terra', 'solid', 'fold', 'fluffy', 'scarf', 'gold', 'calm'),
  d('shepherd', '黑背', 'sturdy', 'tanpoint', 'solid', 'pointy', 'straight', 'none', 'brick', 'calm'),
  d('doberman', '杜宾', 'slim', 'tanpoint', 'solid', 'pointy', 'stub', 'none', 'indigo', 'sassy'),
  d('rottweiler', '罗威纳', 'sturdy', 'tanpoint', 'patch', 'floppy', 'stub', 'none', 'gold', 'calm'),
  d('beagle', '比格', 'slim', 'malt', 'patch', 'longdrop', 'straight', 'none', 'teal', 'playful'),
  d('basset', '巴吉度', 'long', 'cocoa', 'patch', 'longdrop', 'straight', 'none', 'olive', 'calm'),
  d('spaniel', '可卡', 'round', 'malt', 'solid', 'longdrop', 'straight', 'bandana', 'olive', 'sweet'),
  d('papillon', '蝴蝶犬', 'slim', 'cream', 'patch', 'longdrop', 'fluffy', 'none', 'plum', 'sweet'),
  d('maltese', '马尔济斯', 'round', 'snow', 'solid', 'longdrop', 'straight', 'none', 'gold', 'calm'),
  d('schnauzer', '雪纳瑞', 'slim', 'mist', 'solid', 'fold', 'straight', 'none', 'indigo', 'sassy'),
  d('westie', '西高地', 'round', 'snow', 'solid', 'pointy', 'straight', 'bell', 'teal', 'playful'),
  d('pom', '博美', 'round', 'cream', 'solid', 'pointy', 'curl', 'none', 'brick', 'playful'),
  d('chihuahua', '吉娃娃', 'slim', 'terra', 'solid', 'pointy', 'straight', 'none', 'gold', 'sassy'),
  d('shihtzu', '西施', 'round', 'mist', 'solid', 'longdrop', 'curl', 'flower', 'gold', 'sweet'),
  d('saint', '圣伯纳', 'sturdy', 'malt', 'patch', 'floppy', 'straight', 'scarf', 'indigo', 'calm'),
  d('huskybrown', '棕哈', 'slim', 'cocoa', 'mask', 'pointy', 'fluffy', 'bell', 'brick', 'sassy'),
  d('mutt', '小土狗', 'long', 'malt', 'patch', 'pointy', 'straight', 'none', 'olive', 'goofy'),
  d('greyhound', '灵缇', 'long', 'mist', 'solid', 'fold', 'stub', 'none', 'plum', 'calm'),
  d('sheltie', '喜乐蒂', 'long', 'cream', 'mask', 'longdrop', 'fluffy', 'none', 'teal', 'sweet'),
];

function h(
  id: string,
  name: string,
  skin: HumanConfig['skin'],
  hair: HumanConfig['hair'],
  hairColor: HumanConfig['hairColor'],
  outfit: HumanConfig['outfit'],
): HumanPreset {
  return { id, name, human: { skin, hair, hairColor, outfit } };
}

export const HUMAN_PRESETS: HumanPreset[] = [
  h('h1', '清爽短发', 'fair', 'short', 'ink', 'indigo'),
  h('h2', '齐耳波波', 'fair', 'bob', 'brown', 'brick'),
  h('h3', '丸子头', 'fair', 'buns', 'ink', 'plum'),
  h('h4', '小刺头', 'fair', 'spiky', 'brown', 'teal'),
  h('h5', '阳光短发', 'tan', 'short', 'brown', 'olive'),
  h('h6', '暖棕波波', 'tan', 'bob', 'ink', 'gold'),
  h('h7', '双丸子', 'tan', 'buns', 'brown', 'brick'),
  h('h8', '炸毛少年', 'tan', 'spiky', 'ink', 'indigo'),
  h('h9', '利落短发', 'deep', 'short', 'ink', 'teal'),
  h('h10', '深色波波', 'deep', 'bob', 'ink', 'olive'),
  h('h11', '银发丸子', 'deep', 'buns', 'grey', 'gold'),
  h('h12', '夜色刺头', 'deep', 'spiky', 'ink', 'plum'),
];

/** 没配置过狗的用户按 seed 稳定落到一只预设(群聊/舞台不出现空形象) */
export function presetDogForSeed(seed: string): DogPreset {
  let acc = 5381;
  for (let i = 0; i < seed.length; i++) acc = ((acc << 5) + acc + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(acc) % DOG_PRESETS.length;
  return DOG_PRESETS[idx];
}

/** 同上,人的兜底形象 */
export function presetHumanForSeed(seed: string): HumanPreset {
  let acc = 52711;
  for (let i = 0; i < seed.length; i++) acc = ((acc << 5) + acc + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(acc) % HUMAN_PRESETS.length;
  return HUMAN_PRESETS[idx];
}

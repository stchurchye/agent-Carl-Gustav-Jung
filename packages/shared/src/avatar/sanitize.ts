import {
  ACCENT_COLORS,
  DEFAULT_DOG,
  DEFAULT_HUMAN,
  DOG_ACCESSORIES,
  DOG_BODIES,
  DOG_COATS,
  DOG_EARS,
  DOG_PATTERNS,
  DOG_PERSONALITIES,
  DOG_TAILS,
  HUMAN_HAIR_COLORS,
  HUMAN_HAIRS,
  HUMAN_SKINS,
  type DogConfig,
  type HumanConfig,
  type PixelAvatarSettings,
} from './types.js';

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 枚举白名单清洗:非法值逐字段回退默认、未知键剥掉。
 * 输入不是对象时返回 null(语义:未配置)。
 */
export function sanitizePixelAvatarSettings(input: unknown): PixelAvatarSettings | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const root = asRecord(input);
  const dogIn = asRecord(root.dog);
  const humanIn = asRecord(root.human);

  const dog: DogConfig = {
    body: pick(DOG_BODIES, dogIn.body, DEFAULT_DOG.body),
    coat: pick(DOG_COATS, dogIn.coat, DEFAULT_DOG.coat),
    pattern: pick(DOG_PATTERNS, dogIn.pattern, DEFAULT_DOG.pattern),
    ears: pick(DOG_EARS, dogIn.ears, DEFAULT_DOG.ears),
    tail: pick(DOG_TAILS, dogIn.tail, DEFAULT_DOG.tail),
    accessory: pick(DOG_ACCESSORIES, dogIn.accessory, DEFAULT_DOG.accessory),
    accessoryColor: pick(ACCENT_COLORS, dogIn.accessoryColor, DEFAULT_DOG.accessoryColor),
    personality: pick(DOG_PERSONALITIES, dogIn.personality, DEFAULT_DOG.personality),
  };

  const human: HumanConfig = {
    skin: pick(HUMAN_SKINS, humanIn.skin, DEFAULT_HUMAN.skin),
    hair: pick(HUMAN_HAIRS, humanIn.hair, DEFAULT_HUMAN.hair),
    hairColor: pick(HUMAN_HAIR_COLORS, humanIn.hairColor, DEFAULT_HUMAN.hairColor),
    outfit: pick(ACCENT_COLORS, humanIn.outfit, DEFAULT_HUMAN.outfit),
  };

  return { v: 1, dog, human };
}

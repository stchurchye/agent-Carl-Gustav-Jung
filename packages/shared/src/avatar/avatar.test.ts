import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAT,
  DEFAULT_DOG,
  DEFAULT_HUMAN,
  DOG_BODIES,
  DOG_COATS,
  DOG_PERSONALITIES,
  type DogConfig,
} from './types.js';
import { sanitizePixelAvatarSettings } from './sanitize.js';
import { DOG_PRESETS, HUMAN_PRESETS, presetDogForSeed } from './presets.js';

describe('sanitizePixelAvatarSettings', () => {
  it('空值/非对象 → null', () => {
    expect(sanitizePixelAvatarSettings(null)).toBeNull();
    expect(sanitizePixelAvatarSettings(undefined)).toBeNull();
    expect(sanitizePixelAvatarSettings('狗')).toBeNull();
    expect(sanitizePixelAvatarSettings(42)).toBeNull();
  });

  it('非法枚举值逐字段回退默认,未知键剥掉', () => {
    const out = sanitizePixelAvatarSettings({
      v: 99,
      dog: { body: 'huge', coat: 'rainbow', ears: 'pointy', evil: 'x' },
      human: { skin: 'green', hair: 'bob' },
      extra: { a: 1 },
    });
    expect(out).not.toBeNull();
    expect(out!.v).toBe(1);
    expect(out!.dog.body).toBe(DEFAULT_DOG.body);
    expect(out!.dog.coat).toBe(DEFAULT_DOG.coat);
    expect(out!.dog.ears).toBe('pointy');
    expect((out!.dog as Record<string, unknown>).evil).toBeUndefined();
    expect(out!.human.skin).toBe(DEFAULT_HUMAN.skin);
    expect(out!.human.hair).toBe('bob');
    expect((out! as Record<string, unknown>).extra).toBeUndefined();
  });

  it('合法配置原样保留', () => {
    const dog: DogConfig = {
      body: 'long',
      coat: 'malt',
      pattern: 'socks',
      ears: 'pointy',
      tail: 'stub',
      accessory: 'bandana',
      accessoryColor: 'brick',
      personality: 'sweet',
    };
    const out = sanitizePixelAvatarSettings({ v: 1, dog, human: DEFAULT_HUMAN });
    expect(out!.dog).toEqual(dog);
  });

  it('序列化后 < 1KB', () => {
    const out = sanitizePixelAvatarSettings({ v: 1 });
    expect(JSON.stringify(out).length).toBeLessThan(1024);
  });
});

describe('DOG_PRESETS 策展', () => {
  it('36 只,id 唯一,有中文名', () => {
    expect(DOG_PRESETS.length).toBe(36);
    expect(new Set(DOG_PRESETS.map((p) => p.id)).size).toBe(36);
    for (const p of DOG_PRESETS) expect(p.name.length).toBeGreaterThan(0);
  });

  it('两两差异 ≥2 个维度(观感差异保证)', () => {
    const DIMS = ['body', 'coat', 'pattern', 'ears', 'tail', 'accessory', 'personality'] as const;
    const offenders: string[] = [];
    for (let i = 0; i < DOG_PRESETS.length; i++) {
      for (let j = i + 1; j < DOG_PRESETS.length; j++) {
        const a = DOG_PRESETS[i].dog;
        const b = DOG_PRESETS[j].dog;
        const diff = DIMS.filter((d) => a[d] !== b[d]).length;
        if (diff < 2) offenders.push(`${DOG_PRESETS[i].id}~${DOG_PRESETS[j].id}(diff=${diff})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('预设字段全部合法(过 sanitize 不变)', () => {
    for (const p of DOG_PRESETS) {
      const out = sanitizePixelAvatarSettings({ v: 1, dog: p.dog, human: DEFAULT_HUMAN });
      expect(out!.dog).toEqual(p.dog);
    }
  });

  it('体型/毛色/性格都有覆盖(美术多样性)', () => {
    expect(new Set(DOG_PRESETS.map((p) => p.dog.body)).size).toBe(DOG_BODIES.length);
    expect(new Set(DOG_PRESETS.map((p) => p.dog.coat)).size).toBe(DOG_COATS.length);
    expect(new Set(DOG_PRESETS.map((p) => p.dog.personality)).size).toBe(DOG_PERSONALITIES.length);
  });
});

describe('HUMAN_PRESETS', () => {
  it('12 个,id 唯一,字段合法', () => {
    expect(HUMAN_PRESETS.length).toBe(12);
    expect(new Set(HUMAN_PRESETS.map((p) => p.id)).size).toBe(12);
    for (const p of HUMAN_PRESETS) {
      const out = sanitizePixelAvatarSettings({ v: 1, dog: DEFAULT_DOG, human: p.human });
      expect(out!.human).toEqual(p.human);
    }
  });
});

describe('presetDogForSeed 无配置兜底', () => {
  it('同 seed 稳定,不同 seed 能落到不同预设', () => {
    const a1 = presetDogForSeed('user-a');
    const a2 = presetDogForSeed('user-a');
    expect(a1).toEqual(a2);
    const picks = new Set(
      ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map((s) => presetDogForSeed(s).id),
    );
    expect(picks.size).toBeGreaterThan(2);
  });
});

describe('德文卷毛猫(species=cat)', () => {
  it('species 缺省为 dog,cat 字段缺省不补', () => {
    const out = sanitizePixelAvatarSettings({ v: 1 });
    expect(out!.species).toBe('dog');
    expect(out!.cat ?? null).toBeNull();
  });

  it('species=cat 时必有 cat 配置(缺省补 DEFAULT_CAT)', () => {
    const out = sanitizePixelAvatarSettings({ v: 1, species: 'cat' });
    expect(out!.species).toBe('cat');
    expect(out!.cat).toEqual(DEFAULT_CAT);
  });

  it('cat 字段过白名单:非法毛色/品种回退,未知键剥掉', () => {
    const out = sanitizePixelAvatarSettings({
      v: 1,
      species: 'cat',
      cat: { breed: 'persian', coat: 'rainbow', accessory: 'scarf', personality: 'sassy', evil: 1 },
    });
    expect(out!.cat!.breed).toBe('devonrex'); // 仅支持德文卷毛猫
    expect(out!.cat!.coat).toBe(DEFAULT_CAT.coat);
    expect(out!.cat!.accessory).toBe('scarf');
    expect(out!.cat!.personality).toBe('sassy');
    expect((out!.cat as Record<string, unknown>).evil).toBeUndefined();
  });

  it('合法猫配置原样保留;非法 species 回退 dog', () => {
    const cat = {
      breed: 'devonrex',
      coat: 'snow',
      accessory: 'bell',
      accessoryColor: 'teal',
      personality: 'playful',
    } as const;
    const out = sanitizePixelAvatarSettings({ v: 1, species: 'cat', cat });
    expect(out!.cat).toEqual(cat);
    expect(sanitizePixelAvatarSettings({ v: 1, species: 'fish' })!.species).toBe('dog');
  });
});

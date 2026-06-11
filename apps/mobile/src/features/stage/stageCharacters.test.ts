import type { PixelAvatarSettings } from '@xzz/shared';
import { resolveStageCharacter } from './stageCharacters';
import type { StageActor } from './stageTypes';

const dogActor: StageActor = { id: 'dog:self', kind: 'dog', name: '旺财', seed: 'assistant' };
const humanActor: StageActor = { id: 'user:u1', kind: 'human', name: '老王', seed: 'u1' };

const catSettings: PixelAvatarSettings = {
  v: 1,
  species: 'cat',
  dog: {
    body: 'sturdy', coat: 'malt', pattern: 'mask', ears: 'pointy', tail: 'curl',
    accessory: 'none', accessoryColor: 'brick', personality: 'playful',
  },
  human: { skin: 'fair', hair: 'short', hairColor: 'ink', outfit: 'indigo' },
  cat: { breed: 'devonrex', coat: 'mist', accessory: 'bell', accessoryColor: 'teal', personality: 'sassy' },
};

describe('resolveStageCharacter 物种与彩蛋分级', () => {
  it('species=cat → 渲染猫,反应是猫叫且按性格(sassy)', () => {
    const r = resolveStageCharacter(dogActor, new Map([['self', catSettings]]));
    expect(r.character.size).toBe(24);
    expect(r.reactions[0]).toContain('喵');
    expect(r.reactions.length).toBeGreaterThanOrEqual(3);
  });

  it('无配置兜底狗 → 反应含汪;不同性格反应不同', () => {
    const r = resolveStageCharacter(dogActor, new Map());
    expect(r.reactions.join('')).toContain('汪');
  });

  it('人 → 简单感叹', () => {
    const r = resolveStageCharacter(humanActor, new Map());
    expect(r.reactions).toEqual(['!']);
  });
});

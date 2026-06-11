import { DOG_PRESETS, HUMAN_PRESETS, DOG_PERSONALITIES } from '@xzz/shared';
import { buildDogCharacter } from './buildDog';
import { buildHumanCharacter } from './buildHuman';
import {
  DOG_BODY_GRIDS,
  DOG_EAR_GRIDS,
  DOG_EXPRESSION_GRIDS,
  DOG_PATTERN_GRIDS,
  DOG_TAIL_GRIDS,
  DOG_ACCESSORY_GRIDS,
} from './grids/dogParts';
import { HUMAN_BODY_GRID, HUMAN_HAIR_GRIDS } from './grids/humanParts';

function assertGrid(grid: string[], size: number, label: string) {
  expect({ label, rows: grid.length }).toEqual({ label, rows: size });
  for (const row of grid) {
    expect({ label, w: row.length }).toEqual({ label, w: size });
  }
}

describe('部件库画布尺寸', () => {
  it('狗部件全部 24×24', () => {
    for (const [k, g] of Object.entries(DOG_BODY_GRIDS)) assertGrid(g, 24, `body:${k}`);
    for (const [k, g] of Object.entries(DOG_EAR_GRIDS)) assertGrid(g, 24, `ears:${k}`);
    for (const [k, g] of Object.entries(DOG_PATTERN_GRIDS)) assertGrid(g, 24, `pattern:${k}`);
    for (const [k, g] of Object.entries(DOG_ACCESSORY_GRIDS)) assertGrid(g, 24, `accessory:${k}`);
    for (const [k, pair] of Object.entries(DOG_TAIL_GRIDS)) {
      assertGrid(pair.idle, 24, `tail-idle:${k}`);
      assertGrid(pair.wag, 24, `tail-wag:${k}`);
    }
    for (const [k, e] of Object.entries(DOG_EXPRESSION_GRIDS)) {
      assertGrid(e.eyesOpen, 24, `eyesOpen:${k}`);
      assertGrid(e.eyesClosed, 24, `eyesClosed:${k}`);
      assertGrid(e.mouthIdle, 24, `mouthIdle:${k}`);
      assertGrid(e.mouthTalk, 24, `mouthTalk:${k}`);
    }
  });

  it('人部件全部 16×16', () => {
    assertGrid(HUMAN_BODY_GRID, 16, 'human-body');
    for (const [k, g] of Object.entries(HUMAN_HAIR_GRIDS)) assertGrid(g, 16, `hair:${k}`);
  });
});

describe('buildDogCharacter', () => {
  it('36 预设全部可编译,still 产物两两不同(配置差异确实带来观感差异)', () => {
    const seen = new Map<string, string>();
    for (const p of DOG_PRESETS) {
      const c = buildDogCharacter(p.dog);
      expect(c.size).toBe(24);
      expect(c.still.layers.length).toBeGreaterThanOrEqual(4);
      const hash = JSON.stringify(c.still);
      const clash = seen.get(hash);
      expect(clash ?? null).toBeNull();
      seen.set(hash, p.id);
    }
  });

  it('五种性格的表情部件两两不同(眼+嘴)', () => {
    const faces = DOG_PERSONALITIES.map((p) => {
      const e = DOG_EXPRESSION_GRIDS[p];
      return e.eyesOpen.join('') + e.mouthIdle.join('');
    });
    expect(new Set(faces).size).toBe(DOG_PERSONALITIES.length);
  });

  it('帧对各自不同:睁眼≠闭眼、静嘴≠张嘴、尾静≠尾摇', () => {
    const c = buildDogCharacter(DOG_PRESETS[0].dog);
    expect(JSON.stringify(c.eyesOpen)).not.toBe(JSON.stringify(c.eyesClosed));
    expect(JSON.stringify(c.mouthIdle)).not.toBe(JSON.stringify(c.mouthTalk));
    expect(JSON.stringify(c.tailIdle)).not.toBe(JSON.stringify(c.tailWag));
  });

  it('同配置命中缓存(同引用)', () => {
    const a = buildDogCharacter(DOG_PRESETS[1].dog);
    const b = buildDogCharacter({ ...DOG_PRESETS[1].dog });
    expect(a).toBe(b);
  });
});

describe('buildHumanCharacter', () => {
  it('12 预设全部可编译且 still 两两不同', () => {
    const hashes = HUMAN_PRESETS.map((p) => JSON.stringify(buildHumanCharacter(p.human).still));
    expect(new Set(hashes).size).toBe(HUMAN_PRESETS.length);
    for (const p of HUMAN_PRESETS) {
      expect(buildHumanCharacter(p.human).size).toBe(16);
    }
  });

  it('眨眼帧不同', () => {
    const c = buildHumanCharacter(HUMAN_PRESETS[0].human);
    expect(JSON.stringify(c.eyesOpen)).not.toBe(JSON.stringify(c.eyesClosed));
  });
});

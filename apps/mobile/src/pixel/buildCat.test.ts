import { DOG_COATS, DOG_PERSONALITIES, DEFAULT_CAT, type CatConfig } from '@xzz/shared';
import { buildCatCharacter } from './buildCat';
import { CAT_ACCESSORY_GRIDS, CAT_BODY_GRID, CAT_EAR_GRID, CAT_TAIL_GRIDS } from './grids/catParts';

function assertGrid(grid: string[], size: number, label: string) {
  expect({ label, rows: grid.length }).toEqual({ label, rows: size });
  for (const row of grid) expect({ label, w: row.length }).toEqual({ label, w: size });
}

describe('德文卷毛猫部件画布', () => {
  it('全部 24×24(与狗同规范)', () => {
    assertGrid(CAT_BODY_GRID, 24, 'cat-body');
    assertGrid(CAT_EAR_GRID, 24, 'cat-ears');
    assertGrid(CAT_TAIL_GRIDS.idle, 24, 'cat-tail-idle');
    assertGrid(CAT_TAIL_GRIDS.wag, 24, 'cat-tail-wag');
    for (const [k, g] of Object.entries(CAT_ACCESSORY_GRIDS)) assertGrid(g, 24, `cat-acc:${k}`);
  });
});

describe('buildCatCharacter', () => {
  const cat = (over: Partial<CatConfig>): CatConfig => ({ ...DEFAULT_CAT, ...over });

  it('八种毛色 still 两两不同', () => {
    const hashes = DOG_COATS.map((coat) => JSON.stringify(buildCatCharacter(cat({ coat })).still));
    expect(new Set(hashes).size).toBe(DOG_COATS.length);
  });

  it('五种性格都可编译且表情互异(复用狗的表情锚点)', () => {
    const faces = DOG_PERSONALITIES.map((personality) =>
      JSON.stringify(buildCatCharacter(cat({ personality })).eyesOpen),
    );
    expect(new Set(faces).size).toBeGreaterThanOrEqual(3); // sweet/calm 等部分共用闭眼帧,睁眼至少 3 类
    for (const personality of DOG_PERSONALITIES) {
      expect(buildCatCharacter(cat({ personality })).still.layers.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('帧对互异:睁眼≠闭眼、静嘴≠张嘴、尾静≠尾摇', () => {
    const c = buildCatCharacter(DEFAULT_CAT);
    expect(JSON.stringify(c.eyesOpen)).not.toBe(JSON.stringify(c.eyesClosed));
    expect(JSON.stringify(c.mouthIdle)).not.toBe(JSON.stringify(c.mouthTalk));
    expect(JSON.stringify(c.tailIdle)).not.toBe(JSON.stringify(c.tailWag));
  });

  it('配饰可叠加;同配置命中缓存', () => {
    const withScarf = buildCatCharacter(cat({ accessory: 'scarf' }));
    expect(JSON.stringify(withScarf.still)).not.toBe(
      JSON.stringify(buildCatCharacter(DEFAULT_CAT).still),
    );
    expect(buildCatCharacter(DEFAULT_CAT)).toBe(buildCatCharacter({ ...DEFAULT_CAT }));
  });
});

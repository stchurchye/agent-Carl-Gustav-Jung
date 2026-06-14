import { compileSprite } from '../compile';
import { SCENE_COLORS, SCENE_GRIDS, SCENE_H, SCENE_W } from './dramaScenes';

describe('dramaScenes 场景网格', () => {
  it('每张场景:行高=H、行宽=W、可编译(无未知角色字符)', () => {
    const names = Object.keys(SCENE_GRIDS);
    expect(names).toEqual(expect.arrayContaining(['hall', 'gate', 'garden']));
    for (const grid of Object.values(SCENE_GRIDS)) {
      expect(grid).toHaveLength(SCENE_H);
      for (const row of grid) expect(row.length).toBe(SCENE_W);
      expect(() => compileSprite(grid, SCENE_COLORS)).not.toThrow();
    }
  });
});

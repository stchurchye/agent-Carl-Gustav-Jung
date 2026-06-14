import { buildHeaddress, HEADDRESS_GRIDS, HEADDRESS_KEYS } from './palaceParts';

describe('palaceParts 宫廷头饰', () => {
  it('每个头饰:24×24、可编译、buildHeaddress 返回精灵;未知 key → null', () => {
    expect(HEADDRESS_KEYS).toEqual(expect.arrayContaining(['phoenix', 'buyao', 'court']));
    for (const key of HEADDRESS_KEYS) {
      const grid = HEADDRESS_GRIDS[key];
      expect(grid).toHaveLength(24);
      for (const row of grid) expect(row.length).toBe(24);
      expect(buildHeaddress(key)).toBeTruthy();
    }
    expect(buildHeaddress('nope')).toBeNull();
  });
});

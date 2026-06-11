import { composeGrids } from './compose';
import { compileSprite, pathForRuns } from './compile';

describe('composeGrids 画布叠加', () => {
  it('overlay 非透明格替换底图,透明格保留', () => {
    const base = ['BB', 'BB'];
    const overlay = ['.S', '..'];
    expect(composeGrids(base, overlay)).toEqual(['BS', 'BB']);
  });

  it('多层 overlay 后画覆盖前画', () => {
    const base = ['BB', 'BB'];
    const o1 = ['S.', '..'];
    const o2 = ['L.', '.L'];
    expect(composeGrids(base, o1, o2)).toEqual(['LB', 'BL']);
  });

  it('尺寸不一致直接抛错(部件库笔误要炸在测试里)', () => {
    expect(() => composeGrids(['BB', 'BB'], ['B'])).toThrow();
    expect(() => composeGrids(['BB', 'B'], ['..', '..'])).toThrow();
  });
});

describe('compileSprite 同色行程合并', () => {
  const colors = { B: '#111111', S: '#222222' };

  it('每行同色相邻格合并为一个 run,按颜色分层', () => {
    const grid = ['BBS.', 'SSBB'];
    const out = compileSprite(grid, colors);
    expect(out.size).toBe(4);
    const layerB = out.layers.find((l) => l.color === '#111111')!;
    const layerS = out.layers.find((l) => l.color === '#222222')!;
    expect(layerB.runs).toEqual([
      { x: 0, y: 0, w: 2 },
      { x: 2, y: 1, w: 2 },
    ]);
    expect(layerS.runs).toEqual([
      { x: 2, y: 0, w: 1 },
      { x: 0, y: 1, w: 2 },
    ]);
  });

  it('全透明格不产生层', () => {
    expect(compileSprite(['..', '..'], colors).layers).toEqual([]);
  });

  it('未知角色字符抛错(防部件库写错字母静默丢像素)', () => {
    expect(() => compileSprite(['BX'], colors)).toThrow(/X/);
  });
});

describe('pathForRuns', () => {
  it('单 run 生成微膨胀矩形 path(防抗锯齿发丝缝)', () => {
    const d = pathForRuns([{ x: 1, y: 2, w: 3 }]);
    expect(d).toBe('M0.98 1.98h3.04v1.04h-3.04Z');
  });

  it('多 run 拼接', () => {
    const d = pathForRuns([
      { x: 0, y: 0, w: 1 },
      { x: 2, y: 0, w: 2 },
    ]);
    expect(d.split('M').filter(Boolean).length).toBe(2);
  });
});

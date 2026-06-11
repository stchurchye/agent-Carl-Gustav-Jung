import React from 'react';
import { render } from '@testing-library/react-native';
import type { CompiledCharacter, CompiledSprite } from '../../pixel/types';
import { PixelCharacter } from './PixelCharacter';

const sp = (color: string): CompiledSprite => ({
  size: 4,
  layers: [{ color, runs: [{ x: 0, y: 0, w: 1 }] }],
});

const character: CompiledCharacter = {
  size: 4,
  still: sp('#0000ff'),
  base: sp('#111111'),
  eyesOpen: sp('#222222'),
  eyesClosed: sp('#333333'),
  mouthIdle: sp('#444444'),
  mouthTalk: sp('#555555'),
  tailIdle: sp('#666666'),
  tailWag: sp('#777777'),
};

const MOTION = { blinkMinMs: 3000, blinkMaxMs: 5000, wagMs: 400, bounceRatio: 0.05 };

function countByType(json: unknown, name: string): number {
  if (!json || typeof json !== 'object') return 0;
  const node = json as { type?: string; children?: unknown[] };
  // RNSVGSvgView 后缀精确匹配(includes('svg') 会把 RNSVGPath 也算进去)
  const self = typeof node.type === 'string' && node.type.toLowerCase().endsWith(name) ? 1 : 0;
  return self + (node.children ?? []).reduce<number>((acc, c) => acc + countByType(c, name), 0);
}

describe('PixelCharacter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('animated=false:只渲染 still 单个 Svg,不挂任何定时器', () => {
    const r = render(<PixelCharacter character={character} size={48} motion={MOTION} />);
    expect(countByType(r.toJSON(), "svgview")).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('animated:渲染 base+帧叠层(7 个 Svg),并挂上眨眼/摇尾定时器', () => {
    const r = render(
      <PixelCharacter character={character} size={48} motion={MOTION} animated />,
    );
    // base + eyesOpen + eyesClosed + mouthIdle + mouthTalk + tailIdle + tailWag
    expect(countByType(r.toJSON(), "svgview")).toBe(7);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    // 卸载时我们自己的眨眼(setTimeout)与摇尾(setInterval)必须清掉
    // (jest.getTimerCount 含 RN Animated 内部计时器,不可靠,改 spy 清理调用)
    const clearTo = jest.spyOn(global, 'clearTimeout');
    const clearIv = jest.spyOn(global, 'clearInterval');
    r.unmount();
    expect(clearTo).toHaveBeenCalled();
    expect(clearIv).toHaveBeenCalled();
    clearTo.mockRestore();
    clearIv.mockRestore();
  });

  it('无尾角色(人)动画态渲染 5 个 Svg', () => {
    const human: CompiledCharacter = { ...character, tailIdle: undefined, tailWag: undefined };
    const r = render(<PixelCharacter character={human} size={32} motion={MOTION} animated />);
    expect(countByType(r.toJSON(), "svgview")).toBe(5);
  });
});

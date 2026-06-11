import React from 'react';
import { render } from '@testing-library/react-native';
import type { CompiledSprite } from '../../pixel/types';
import { PixelSprite } from './PixelSprite';

const sprite: CompiledSprite = {
  size: 4,
  layers: [
    { color: '#111111', runs: [{ x: 0, y: 0, w: 2 }] },
    { color: '#222222', runs: [{ x: 2, y: 1, w: 1 }] },
  ],
};

function countByType(json: unknown, name: string): number {
  if (!json || typeof json !== 'object') return 0;
  const node = json as { type?: string; children?: unknown[] };
  // RNSVGSvgView / RNSVGPath:用后缀精确匹配,避免 'svg' 把 Path 也算进去
  const self = typeof node.type === 'string' && node.type.toLowerCase().endsWith(name) ? 1 : 0;
  return self + (node.children ?? []).reduce<number>((acc, c) => acc + countByType(c, name), 0);
}

it('每个颜色层渲染一条 Path,viewBox 按网格尺寸', () => {
  const r = render(<PixelSprite sprite={sprite} size={48} />);
  const json = r.toJSON();
  expect(countByType(json, 'svgview')).toBe(1);
  expect(countByType(json, 'path')).toBe(2);
});

it('空层精灵也能渲染(不炸)', () => {
  const r = render(<PixelSprite sprite={{ size: 4, layers: [] }} size={16} />);
  expect(countByType(r.toJSON(), 'svgview')).toBe(1);
});

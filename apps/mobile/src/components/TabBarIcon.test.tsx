import React from 'react';
import { render } from '@testing-library/react-native';
import { StudioTabIcon, BrainTabIcon } from './TabBarIcon';

// U8:tab 图标真实渲染(此前无 tabBarIcon → ▼ 占位符)。

function hasSvgNode(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  const node = json as { type?: string; children?: unknown[] };
  if (typeof node.type === 'string' && node.type.toLowerCase().includes('svg')) return true;
  return (node.children ?? []).some(hasSvgNode);
}

it('renders studio and brain icons as real SVG', () => {
  const studio = render(<StudioTabIcon color="#C15F3C" focused />);
  const brain = render(<BrainTabIcon color="#6E6B64" />);
  expect(hasSvgNode(studio.toJSON())).toBe(true);
  expect(hasSvgNode(brain.toJSON())).toBe(true);
});

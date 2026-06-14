import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { DeducePanel } from './DeducePanel';
import { mulberry32 } from '../shared/rng';
import { generateCase } from '../sleuth/engine';
import { attrLabel, valueLabel } from '../sleuth/labels';
import { zh } from '../../../locales/zh-CN';
import type { Deduce } from './story';

const STEP: Deduce = { kind: 'deduce', count: 6, budget: 2, seed: 7 };
const CASE = generateCase(mulberry32(7), { count: 6, budget: 2 });

function mount(onResolved: jest.Mock = jest.fn()) {
  const r = render(<DeducePanel step={STEP} onResolved={onResolved} />);
  return { ...r, onResolved };
}

describe('DeducePanel 剧情查案', () => {
  it('渲染 6 只嫌疑 + 嗅探特征 + 剩余次数', () => {
    const { getAllByTestId, getByTestId, getByText } = mount();
    expect(getAllByTestId(/^suspect-/)).toHaveLength(6);
    expect(getByTestId('sniff-ears')).toBeTruthy();
    expect(getByText(zh.games.drama.deduceStatus(2))).toBeTruthy();
  });

  it('嗅一个特征 → 出真凶在该维度取值的线索', () => {
    const culprit = CASE.suspects[CASE.culpritIndex];
    const { getByTestId, getByText } = mount();
    fireEvent.press(getByTestId('sniff-ears'));
    expect(getByText(`${attrLabel('ears')} = ${valueLabel('ears', culprit.ears)}`)).toBeTruthy();
  });

  it('指对真凶 → onResolved(true)', () => {
    const { getByTestId, onResolved } = mount();
    fireEvent.press(getByTestId(`suspect-${CASE.culpritIndex}`));
    expect(onResolved).toHaveBeenCalledWith(true);
  });

  it('指错 → onResolved(false)', () => {
    const wrong = (CASE.culpritIndex + 1) % CASE.suspects.length;
    const { getByTestId, onResolved } = mount();
    fireEvent.press(getByTestId(`suspect-${wrong}`));
    expect(onResolved).toHaveBeenCalledWith(false);
  });
});

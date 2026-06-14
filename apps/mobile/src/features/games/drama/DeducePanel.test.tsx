import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { DeducePanel } from './DeducePanel';
import { mulberry32 } from '../shared/rng';
import { generateCase, SNIFFABLE_ATTRS } from '../sleuth/engine';
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

  it('嗅完线索后,不匹配的嫌疑狗依旧可点——不替玩家缩范围', () => {
    // 找一个维度,真凶与某只嫌疑取值不同;嗅这个维度后那只本会被旧 UI 灰掉
    const culprit = CASE.suspects[CASE.culpritIndex];
    let attr = '';
    let mismatch = -1;
    for (const a of SNIFFABLE_ATTRS) {
      const idx = CASE.suspects.findIndex((d, i) => i !== CASE.culpritIndex && d[a] !== culprit[a]);
      if (idx >= 0) {
        attr = a;
        mismatch = idx;
        break;
      }
    }
    expect(mismatch).toBeGreaterThanOrEqual(0);
    const { getByTestId, onResolved } = mount();
    fireEvent.press(getByTestId(`sniff-${attr}`)); // 嗅一条线索
    fireEvent.press(getByTestId(`suspect-${mismatch}`)); // 不匹配,但仍可点
    expect(onResolved).toHaveBeenCalledWith(false); // 真被点到了(没被禁用)
  });
});

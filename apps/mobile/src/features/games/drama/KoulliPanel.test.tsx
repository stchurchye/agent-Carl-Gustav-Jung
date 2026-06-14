import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { KoulliPanel } from './KoulliPanel';
import { makeKoulli } from './koulli';
import { zh } from '../../../locales/zh-CN';
import type { Koulli } from './story';

const G = zh.games.drama;
const STEP: Koulli = { kind: 'koulli', length: 4, seed: 7, onSolve: 'x', onFail: 'y' };
const CASE = makeKoulli({ length: 4, seed: 7 });
const expFor = (r: number) => CASE.sequence.slice(0, r).filter((g) => g !== CASE.forbidden);

describe('KoulliPanel 默宫仪', () => {
  it('看礼 → 逐轮按序复现(跳过禁手)→ 通仪 onResolved(true)', () => {
    const onResolved = jest.fn();
    const { getByTestId } = render(<KoulliPanel step={STEP} onResolved={onResolved} />);
    for (let r = 1; r <= CASE.sequence.length; r++) {
      fireEvent.press(getByTestId('koulli-start')); // 看完礼,开始复现
      for (const g of expFor(r)) fireEvent.press(getByTestId(`koulli-g-${g}`));
    }
    expect(onResolved).toHaveBeenCalledWith(true);
  });

  it('反射性点了禁手 → 失仪,可告退 → onResolved(false)', () => {
    const onResolved = jest.fn();
    const { getByText, getByTestId } = render(<KoulliPanel step={STEP} onResolved={onResolved} />);
    fireEvent.press(getByTestId('koulli-start'));
    fireEvent.press(getByTestId(`koulli-g-${CASE.forbidden}`)); // 跟着叩首 → 僭越失仪
    expect(getByText(G.koulliFail)).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('koulli-giveup'));
    expect(onResolved).toHaveBeenCalledWith(false);
  });

  it('失仪后重头来过 → 回到看礼、可再战', () => {
    const onResolved = jest.fn();
    const { getByText, getByTestId, queryByText } = render(<KoulliPanel step={STEP} onResolved={onResolved} />);
    fireEvent.press(getByTestId('koulli-start'));
    fireEvent.press(getByTestId(`koulli-g-${CASE.forbidden}`));
    fireEvent.press(getByTestId('koulli-reset'));
    expect(queryByText(G.koulliFail)).toBeNull();
    expect(getByTestId('koulli-start')).toBeTruthy(); // 又回到看礼
  });
});

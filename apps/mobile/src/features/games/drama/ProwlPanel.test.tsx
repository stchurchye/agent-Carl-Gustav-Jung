import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { ProwlPanel } from './ProwlPanel';
import { zh } from '../../../locales/zh-CN';
import type { Prowl } from './story';

const G = zh.games.drama;
const STEP: Prowl = { kind: 'prowl', onSolve: 'x', onFail: 'y' };
const ID: Record<string, string> = {
  '.': 'prowl-wait',
  U: 'prowl-up',
  D: 'prowl-down',
  L: 'prowl-left',
  R: 'prowl-right',
};

describe('ProwlPanel 月下夜探', () => {
  it('按 BFS 解法卡时机 → 摸到金门 → onResolved(true)', () => {
    const onResolved = jest.fn();
    const { getByTestId } = render(<ProwlPanel step={STEP} onResolved={onResolved} />);
    for (const ch of '.D..DDDDRRRR') fireEvent.press(getByTestId(ID[ch]));
    expect(onResolved).toHaveBeenCalledWith(true);
  });

  it('鲁莽右行撞视锥 → 被发现,可「随机应变」→ onResolved(false)', () => {
    const onResolved = jest.fn();
    const { getByText, getByTestId } = render(<ProwlPanel step={STEP} onResolved={onResolved} />);
    fireEvent.press(getByTestId('prowl-right')); // 撞巡夜犬视锥
    expect(getByText(G.prowlCaught)).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled(); // 被发现不直接判负,给选择
    fireEvent.press(getByTestId('prowl-improvise'));
    expect(onResolved).toHaveBeenCalledWith(false);
  });

  it('收手 → onResolved(false)', () => {
    const onResolved = jest.fn();
    const { getByText } = render(<ProwlPanel step={STEP} onResolved={onResolved} />);
    fireEvent.press(getByText(G.prowlGiveUp));
    expect(onResolved).toHaveBeenCalledWith(false);
  });
});

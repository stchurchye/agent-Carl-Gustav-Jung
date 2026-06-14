import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { ZitherPanel } from './ZitherPanel';
import { WATCH_CHART } from './zither';
import { zh } from '../../../locales/zh-CN';
import type { Zither } from './story';

const G = zh.games.drama;
const STEP: Zither = { kind: 'zither', onSolve: 'x', onFail: 'y' };
const BEAT = 720;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

describe('ZitherPanel 听更夜奏', () => {
  it('起奏前不计分;起奏后出「拨弦」', () => {
    const onResolved = jest.fn();
    const { getByText, getByTestId } = render(<ZitherPanel step={STEP} onResolved={onResolved} />);
    expect(getByText(G.zitherStart)).toBeTruthy();
    fireEvent.press(getByTestId('zither-start'));
    expect(getByTestId('zither-pluck')).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('跟更鼓:亮拍拨弦、留白屏息,奏完全谱 → 通仪 onResolved(true)', () => {
    const onResolved = jest.fn();
    const { getByTestId } = render(<ZitherPanel step={STEP} onResolved={onResolved} />);
    fireEvent.press(getByTestId('zither-start'));
    for (const b of WATCH_CHART) {
      if (b === 'note') fireEvent.press(getByTestId('zither-pluck')); // 留白拍不弹
      act(() => jest.advanceTimersByTime(BEAT)); // 一拍结算
    }
    expect(onResolved).toHaveBeenCalledWith(true);
  });

  it('搁琴 → onResolved(false)', () => {
    const onResolved = jest.fn();
    const { getByText, getByTestId } = render(<ZitherPanel step={STEP} onResolved={onResolved} />);
    fireEvent.press(getByTestId('zither-start'));
    fireEvent.press(getByText(G.zitherGiveUp));
    expect(onResolved).toHaveBeenCalledWith(false);
  });
});

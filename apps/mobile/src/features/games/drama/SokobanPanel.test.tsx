import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SokobanPanel } from './SokobanPanel';
import { zh } from '../../../locales/zh-CN';
import type { Sokoban } from './story';

const G = zh.games.drama;
// 极简关卡:玩家一推就把箱压上机关
const TINY: Sokoban = { kind: 'sokoban', level: ['#####', '#@$.#', '#####'], onSolve: 'x', onFail: 'y' };

describe('SokobanPanel 推箱子脱困', () => {
  it('把箱推上机关 → onResolved(true)', () => {
    const onResolved = jest.fn();
    const { getByTestId } = render(<SokobanPanel step={TINY} onResolved={onResolved} />);
    fireEvent.press(getByTestId('dpad-right')); // 箱被推上右侧机关
    expect(onResolved).toHaveBeenCalledWith(true);
  });

  it('还没解开时不会误判通关', () => {
    const onResolved = jest.fn();
    const { getByTestId } = render(<SokobanPanel step={TINY} onResolved={onResolved} />);
    fireEvent.press(getByTestId('dpad-up')); // 撞墙,无效
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('放弃突围 → onResolved(false)', () => {
    const onResolved = jest.fn();
    const { getByText } = render(<SokobanPanel step={TINY} onResolved={onResolved} />);
    fireEvent.press(getByText(G.sokoGiveUp));
    expect(onResolved).toHaveBeenCalledWith(false);
  });

  it('缺省用库房关卡,渲染方向键与放弃按钮', () => {
    const onResolved = jest.fn();
    const { getByTestId, getByText } = render(
      <SokobanPanel step={{ kind: 'sokoban', onSolve: 'x', onFail: 'y' }} onResolved={onResolved} />,
    );
    expect(getByTestId('dpad-up')).toBeTruthy();
    expect(getByText(G.sokoReset)).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled(); // 一上来不会误触发
  });
});

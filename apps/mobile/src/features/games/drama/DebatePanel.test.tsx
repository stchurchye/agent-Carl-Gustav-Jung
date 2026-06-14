import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { DebatePanel } from './DebatePanel';
import { zh } from '../../../locales/zh-CN';
import type { Debate } from './story';

const G = zh.games.drama;
const WIN: Debate = {
  kind: 'debate',
  rounds: [
    { argument: '一难', who: 'jinyu', rebuttals: [{ label: '犀利驳', delta: 20 }, { label: '软弱驳', delta: -15 }] },
    { argument: '二难', who: 'jinyu', rebuttals: [{ label: '犀利驳', delta: 20 }, { label: '软弱驳', delta: -15 }] },
  ],
  onWin: 'x',
  onLose: 'y',
};
const HARSH: Debate = {
  kind: 'debate',
  rounds: [
    { argument: '诛心一问', who: 'jinyu', rebuttals: [{ label: '落了圈套', delta: -60 }] },
    { argument: '余威', who: 'jinyu', rebuttals: [{ label: '强驳', delta: 30 }] },
  ],
  onWin: 'x',
  onLose: 'y',
};

describe('DebatePanel 公堂辩论', () => {
  it('连出犀利驳词、气势够高 → 压服 onResolved(true)', () => {
    const onResolved = jest.fn();
    const { getByTestId } = render(<DebatePanel step={WIN} onResolved={onResolved} />);
    fireEvent.press(getByTestId('debate-rebut-0')); // 50→70
    fireEvent.press(getByTestId('debate-rebut-0')); // 70→90 → won
    expect(onResolved).toHaveBeenCalledWith(true);
  });

  it('一手丢光气势 → 被驳哑;重整旗鼓回到对垒', () => {
    const onResolved = jest.fn();
    const { getByText, getByTestId } = render(<DebatePanel step={HARSH} onResolved={onResolved} />);
    fireEvent.press(getByTestId('debate-rebut-0')); // 50→0 → 被驳哑
    expect(getByText(G.debateLost)).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('debate-reset'));
    expect(getByTestId('debate-rebut-0')).toBeTruthy(); // 又能对垒
  });

  it('认输 → onResolved(false)', () => {
    const onResolved = jest.fn();
    const { getByText, getByTestId } = render(<DebatePanel step={HARSH} onResolved={onResolved} />);
    fireEvent.press(getByTestId('debate-rebut-0')); // → 被驳哑
    fireEvent.press(getByText(G.debateGiveUp));
    expect(onResolved).toHaveBeenCalledWith(false);
  });
});

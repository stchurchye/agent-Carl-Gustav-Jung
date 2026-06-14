import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { PairingPanel } from './PairingPanel';
import { makePairing } from './pairing';
import { zh } from '../../../locales/zh-CN';
import type { Pairing } from './story';

const G = zh.games.drama;
const STEP: Pairing = { kind: 'pairing', n: 5, seed: 7, onSolve: 'x', onFail: 'y' };
const CASE = makePairing({ n: 5, seed: 7 });

/** 按真相把每对标对(烈=1 击、安=2 击;从 unknown 起) */
function markCorrect(getByTestId: (id: string) => unknown) {
  for (let i = 0; i < CASE.n; i++)
    for (let j = i + 1; j < CASE.n; j++) {
      const taps = CASE.truth[i][j] ? 1 : 2;
      for (let t = 0; t < taps; t++) fireEvent.press(getByTestId(`cell-${i}-${j}`) as never);
    }
}

describe('PairingPanel 验毒配伍', () => {
  it('全标对 → 呈药 → onResolved(true)', () => {
    const onResolved = jest.fn();
    const { getByTestId } = render(<PairingPanel step={STEP} onResolved={onResolved} />);
    markCorrect(getByTestId);
    fireEvent.press(getByTestId('pairing-submit'));
    expect(onResolved).toHaveBeenCalledWith(true);
  });

  it('标错一格 → 呈药 → onResolved(false)', () => {
    const onResolved = jest.fn();
    const { getByTestId } = render(<PairingPanel step={STEP} onResolved={onResolved} />);
    markCorrect(getByTestId);
    fireEvent.press(getByTestId('cell-0-1')); // 多点一下 → 这对标错
    fireEvent.press(getByTestId('pairing-submit'));
    expect(onResolved).toHaveBeenCalledWith(false);
  });

  it('还有未判时,呈药按钮禁用(不会误判)', () => {
    const onResolved = jest.fn();
    const { getByTestId } = render(<PairingPanel step={STEP} onResolved={onResolved} />);
    fireEvent.press(getByTestId('pairing-submit')); // 全未判 → disabled
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('弃局 → onResolved(false)', () => {
    const onResolved = jest.fn();
    const { getByText } = render(<PairingPanel step={STEP} onResolved={onResolved} />);
    fireEvent.press(getByText(G.pairingGiveUp));
    expect(onResolved).toHaveBeenCalledWith(false);
  });
});

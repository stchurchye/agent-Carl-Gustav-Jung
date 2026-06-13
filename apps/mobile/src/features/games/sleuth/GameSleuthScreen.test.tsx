import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
}));

import { GameSleuthScreen } from './GameSleuthScreen';
import { startRun } from './run';
import { attrLabel, valueLabel } from './labels';
import { zh } from '../../../locales/zh-CN';

const SEED = 42;

function mount(seed = SEED) {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'GameSleuth', params: { seed } } as never;
  return render(<GameSleuthScreen navigation={navigation} route={route} />);
}

describe('GameSleuthScreen 群嗅探案', () => {
  it('开局:渲染整排嫌疑狗 + 8 个嗅探特征 + 满额状态', () => {
    const r0 = startRun(SEED);
    const { getAllByTestId, getByTestId, getByText } = mount();
    expect(getAllByTestId(/^suspect-/)).toHaveLength(r0.case.suspects.length);
    expect(getByTestId('sniff-ears')).toBeTruthy();
    expect(getByTestId('sniff-personality')).toBeTruthy();
    expect(getByText(zh.games.sleuth.status(1, 0, r0.sniffsLeft))).toBeTruthy();
  });

  it('嗅一个特征:出现线索、剩余 -1、该特征按钮消失', () => {
    const r0 = startRun(SEED);
    const culprit = r0.case.suspects[r0.case.culpritIndex];
    const { getByTestId, queryByTestId, getByText } = mount();
    fireEvent.press(getByTestId('sniff-ears'));
    expect(getByText(zh.games.sleuth.clue(attrLabel('ears'), valueLabel('ears', culprit.ears)))).toBeTruthy();
    expect(getByText(zh.games.sleuth.status(1, 0, r0.sniffsLeft - 1))).toBeTruthy();
    expect(queryByTestId('sniff-ears')).toBeNull();
  });

  it('指对真凶:已破 +1、进入第 2 案', () => {
    const r0 = startRun(SEED);
    const { getByTestId, getByText } = mount();
    fireEvent.press(getByTestId(`suspect-${r0.case.culpritIndex}`));
    expect(getByText(zh.games.sleuth.status(2, 1, 3))).toBeTruthy();
  });

  it('指错:出现游戏结束界面;再来一局回到开局', () => {
    const r0 = startRun(SEED);
    const wrong = (r0.case.culpritIndex + 1) % r0.case.suspects.length;
    const { getByTestId, getByText, queryByText } = mount();
    fireEvent.press(getByTestId(`suspect-${wrong}`));
    expect(getByText(zh.games.sleuth.gameOver)).toBeTruthy();
    expect(getByText(zh.games.sleuth.finalScore(0))).toBeTruthy();
    fireEvent.press(getByText(zh.games.sleuth.restart));
    expect(queryByText(zh.games.sleuth.gameOver)).toBeNull();
    expect(getByText(zh.games.sleuth.status(1, 0, 3))).toBeTruthy();
  });
});

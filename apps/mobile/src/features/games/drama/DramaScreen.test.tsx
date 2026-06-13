import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
}));

import { DramaScreen } from './DramaScreen';
import { zh } from '../../../locales/zh-CN';

const G = zh.games.drama;

function mount() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'GameDrama', params: undefined } as never;
  return render(<DramaScreen navigation={navigation} route={route} />);
}

describe('DramaScreen 犬朝后宫(第一幕骨架)', () => {
  it('对白 → 选择 → 分支 → 结局 整条跑通', () => {
    const { getByText, queryByText } = mount();

    // 第一句:老福嬷嬷
    expect(getByText(/规矩还没学全/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));

    // 第二句:雪团
    expect(getByText(/雪团初入宫闱/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));

    // 选择题
    expect(getByText(/该如何应对/)).toBeTruthy();
    expect(getByText(/屈膝行礼/)).toBeTruthy();
    fireEvent.press(getByText(/屈膝行礼/));

    // 进入前殿
    expect(getByText(/前殿在望/)).toBeTruthy();
    expect(queryByText(/该如何应对/)).toBeNull();
    fireEvent.press(getByText(G.cont));

    // 结局
    expect(getByText(/踏入了犬朝后宫/)).toBeTruthy();
    expect(getByText(G.restart)).toBeTruthy();
  });
});

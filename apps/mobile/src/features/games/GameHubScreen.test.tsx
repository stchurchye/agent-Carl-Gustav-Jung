import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual('react');
  void ReactActual;
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
  };
});

import { GameHubScreen } from './GameHubScreen';
import { zh } from '../../locales/zh-CN';

function mount() {
  const navigate = jest.fn();
  const navigation = { navigate, goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'GameHub', params: undefined } as never;
  const r = render(<GameHubScreen navigation={navigation} route={route} />);
  return { ...r, navigate };
}

describe('GameHubScreen 小游戏合集', () => {
  it('列出三个小游戏(犬朝后宫/嗅探案/犟嘴狗)', () => {
    const { getByText, queryByText } = mount();
    expect(getByText(zh.games.drama.name)).toBeTruthy();
    expect(getByText(zh.games.sleuth.name)).toBeTruthy();
    expect(getByText(zh.games.persuade.name)).toBeTruthy();
    // 狗狗越狱已移除
    expect(queryByText('狗狗越狱')).toBeNull();
  });

  it('点某个游戏跳到对应路由', () => {
    const { getByText, navigate } = mount();
    fireEvent.press(getByText(zh.games.sleuth.name));
    expect(navigate).toHaveBeenCalledWith('GameSleuth');
    fireEvent.press(getByText(zh.games.persuade.name));
    expect(navigate).toHaveBeenCalledWith('GamePersuade');
  });
});

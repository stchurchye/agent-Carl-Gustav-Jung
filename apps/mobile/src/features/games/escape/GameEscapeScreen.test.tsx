import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
}));
// 模拟器路径:跳过真麦克风,只走「按住喊」
jest.mock('../../../lib/speech/localRecognition', () => ({
  isIosSimulator: () => true,
  ensureSpeechPermissions: jest.fn().mockResolvedValue(false),
}));
jest.mock('expo-speech-recognition', () => ({
  useSpeechRecognitionEvent: () => {},
  ExpoSpeechRecognitionModule: { start: jest.fn(), stop: jest.fn() },
}));

import { GameEscapeScreen } from './GameEscapeScreen';
import { zh } from '../../../locales/zh-CN';

const G = zh.games.escape;

function mount() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'GameEscape', params: undefined } as never;
  return render(<GameEscapeScreen navigation={navigation} route={route} />);
}

describe('GameEscapeScreen 狗狗越狱', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('开局显示校准提示 + 按住按钮', () => {
    const { getByText, getByTestId } = mount();
    expect(getByText(G.calibrateTitle)).toBeTruthy();
    expect(getByTestId('hold-grip')).toBeTruthy();
  });

  it('校准 2 秒后进入游戏(出现抓力条、校准提示消失)', () => {
    const { getByText, queryByText } = mount();
    act(() => {
      jest.advanceTimersByTime(2200);
    });
    expect(queryByText(G.calibrateTitle)).toBeNull();
    expect(getByText(G.gripLabel)).toBeTruthy();
  });

  it('松手不喊 → 狗冲出门 → 游戏结束;再来一局回到校准', () => {
    const { getByText, queryByText } = mount();
    act(() => {
      jest.advanceTimersByTime(2200); // 过校准
    });
    act(() => {
      jest.advanceTimersByTime(20000); // 一直不喊,狗一路冲到门口
    });
    expect(getByText(G.escaped)).toBeTruthy();
    fireEvent.press(getByText(G.restart));
    expect(getByText(G.calibrateTitle)).toBeTruthy();
    expect(queryByText(G.escaped)).toBeNull();
  });
});

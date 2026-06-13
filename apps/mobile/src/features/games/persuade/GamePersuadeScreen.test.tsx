import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
}));
jest.mock('../../../lib/api', () => ({ api: { persuade: jest.fn() } }));

import { api } from '../../../lib/api';
import { GamePersuadeScreen } from './GamePersuadeScreen';
import { startDuel } from './duel';
import { zh } from '../../../locales/zh-CN';

const G = zh.games.persuade;
const persuadeMock = api.persuade as jest.Mock;

const SEED = 42;

function mount() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'GamePersuade', params: { seed: SEED } } as never;
  return render(<GamePersuadeScreen navigation={navigation} route={route} />);
}

beforeEach(() => persuadeMock.mockReset());

describe('GamePersuadeScreen 犟嘴狗', () => {
  it('开局显示任务要求 + 输入框', () => {
    const demand = startDuel(SEED, 'x').demand;
    const { getByText, getByTestId } = mount();
    expect(getByText(G.demandTitle(demand))).toBeTruthy();
    expect(getByTestId('persuade-input')).toBeTruthy();
  });

  it('提交一句 → 调 api.persuade、显示狗的回复', async () => {
    persuadeMock.mockResolvedValue({ ok: true, data: { reply: '真的有零食?', scoreDelta: 2, mood: 'wavering' }, requestId: 'r' });
    const { getByTestId, getByText, findByText } = mount();
    fireEvent.changeText(getByTestId('persuade-input'), '给你买好吃的');
    fireEvent.press(getByText(G.send));
    expect(await findByText('真的有零食?')).toBeTruthy();
    expect(persuadeMock).toHaveBeenCalledTimes(1);
  });

  it('两回合说动 → 胜利界面', async () => {
    persuadeMock.mockResolvedValue({ ok: true, data: { reply: '好…好吧', scoreDelta: 3, mood: 'won_over' }, requestId: 'r' });
    const { getByTestId, getByText, findByText } = mount();
    fireEvent.changeText(getByTestId('persuade-input'), '一句');
    fireEvent.press(getByText(G.send));
    await findByText('好…好吧');
    fireEvent.changeText(getByTestId('persuade-input'), '二句');
    fireEvent.press(getByText(G.send));
    await waitFor(() => expect(getByText(G.won)).toBeTruthy());
  });
});

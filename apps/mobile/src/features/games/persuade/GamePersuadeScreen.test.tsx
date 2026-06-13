import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
}));
jest.mock('../../../lib/api', () => ({ api: { persuade: jest.fn() } }));
// soundCues 顶层 require 多个 .wav,jest 不处理音频;mock 掉
jest.mock('../../../lib/soundCues', () => ({ playReplyBark: jest.fn() }));
jest.mock('../../../components/AuthGate', () => ({ useAuth: () => ({ user: { pixelAvatar: null } }) }));

import { api } from '../../../lib/api';
import { GamePersuadeScreen } from './GamePersuadeScreen';
import { reactionFor, startDuel } from './duel';
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

  it('提交一句 → 调 api.persuade、气泡显示一来一回 + 多汁反馈', async () => {
    persuadeMock.mockResolvedValue({ ok: true, data: { reply: '真的有零食?', scoreDelta: 2, mood: 'wavering' }, requestId: 'r' });
    const { getByTestId, getByText, findByText } = mount();
    fireEvent.changeText(getByTestId('persuade-input'), '给你买好吃的');
    fireEvent.press(getByText(G.send));
    expect(await findByText('真的有零食?')).toBeTruthy(); // 狗气泡
    expect(getByText('给你买好吃的')).toBeTruthy(); // 玩家气泡
    expect(getByText(reactionFor(2).label)).toBeTruthy(); // scoreDelta=2 的反馈
    expect(persuadeMock).toHaveBeenCalledTimes(1);
  });

  it('调 api.persuade 时带上隐藏性情(软肋/雷区)', async () => {
    persuadeMock.mockResolvedValue({ ok: true, data: { reply: 'x', scoreDelta: 0, mood: 'stubborn' }, requestId: 'r' });
    const { getByTestId, getByText } = mount();
    fireEvent.changeText(getByTestId('persuade-input'), '试试');
    fireEvent.press(getByText(G.send));
    await new Promise((r) => setTimeout(r, 0));
    const arg = persuadeMock.mock.calls[0][0];
    expect(typeof arg.softSpot).toBe('string');
    expect(arg.softSpot.length).toBeGreaterThan(0);
    expect(typeof arg.landmine).toBe('string');
  });

  it('两回合说动 → 胜利 + 战绩 +1 + 进下一件回到争论', async () => {
    persuadeMock.mockResolvedValue({ ok: true, data: { reply: '好…好吧', scoreDelta: 3, mood: 'won_over' }, requestId: 'r' });
    const { getByTestId, getByText, findByText, queryByText } = mount();
    fireEvent.changeText(getByTestId('persuade-input'), '一句');
    fireEvent.press(getByText(G.send));
    await findByText('好…好吧');
    fireEvent.changeText(getByTestId('persuade-input'), '二句');
    fireEvent.press(getByText(G.send));
    await waitFor(() => expect(getByText(G.won)).toBeTruthy());
    expect(getByText(G.streak(1))).toBeTruthy();
    fireEvent.press(getByText(G.nextRound));
    expect(queryByText(G.won)).toBeNull();
    expect(getByTestId('persuade-input')).toBeTruthy();
  });

  it('5 回合没说动 → 战绩界面(说服 0 件)', async () => {
    persuadeMock.mockResolvedValue({ ok: true, data: { reply: '不去', scoreDelta: 0, mood: 'annoyed' }, requestId: 'r' });
    const { getByTestId, getByText } = mount();
    for (let i = 0; i < 5; i++) {
      fireEvent.changeText(getByTestId('persuade-input'), `第${i}句`);
      fireEvent.press(getByText(G.send));
      await waitFor(() => expect(getByText(G.turnsLeft(4 - i))).toBeTruthy());
    }
    expect(getByText(G.lost)).toBeTruthy();
    expect(getByText(G.streakScore(0))).toBeTruthy();
  });
});

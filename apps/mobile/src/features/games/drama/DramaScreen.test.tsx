import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
}));
jest.mock('../../../lib/api', () => ({ api: { dramaSay: jest.fn() } }));
jest.mock('../../../hooks/useHoldToSpeak', () => ({
  useHoldToSpeak: () => ({ holding: false, transcribing: false, onPressIn: jest.fn(), onPressOut: jest.fn() }),
}));

import { api } from '../../../lib/api';
import { DramaScreen } from './DramaScreen';
import { mulberry32 } from '../shared/rng';
import { generateCase } from '../sleuth/engine';
import { zh } from '../../../locales/zh-CN';

const G = zh.games.drama;
const sayMock = api.dramaSay as jest.Mock;

function mount() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'GameDrama', params: undefined } as never;
  return render(<DramaScreen navigation={navigation} route={route} />);
}

beforeEach(() => sayMock.mockReset());

describe('DramaScreen 犬朝后宫 · 第一幕(D5:扩写整幕)', () => {
  it('结盟 + 说对 + 查对 → 盟友好结局', async () => {
    sayMock.mockResolvedValue({ ok: true, data: { pass: true, reply: '答应倒有几分胆色。', score: 8 }, requestId: 'r' });
    const { getByText, getByTestId, findByText } = mount();

    // 宫门
    expect(getByText(/规矩还没学全/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));
    expect(getByText(/雪团初入宫闱/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));
    fireEvent.press(getByText(/屈膝行礼/));

    // 御花园遇墨兰 → 结盟
    expect(getByText(/最容不得新人/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));
    fireEvent.press(getByText(G.cont));
    fireEvent.press(getByText(/共进退/));

    // 金銮殿:贵妃刁难 → 说对台词
    expect(getByText(/也敢来争宠/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));
    fireEvent.changeText(getByTestId('sayline-input'), '贵妃言重了,雪团初来,只求安分守己。');
    fireEvent.press(getByText(G.sayBtn));
    expect(await findByText('答应倒有几分胆色。')).toBeTruthy();
    fireEvent.press(getByText(G.cont)); // → favor

    // 暂稳 → 案起
    fireEvent.press(getByText(G.cont)); // favor 1
    fireEvent.press(getByText(G.cont)); // favor 2 → incident
    expect(getByText(/下了泻药/)).toBeTruthy();
    fireEvent.press(getByText(G.cont)); // incident 1
    fireEvent.press(getByText(G.cont)); // incident 2 → probe
    fireEvent.press(getByText(G.cont)); // probe 引子 → 查案

    // 查对真凶(seed=7)
    const culprit = generateCase(mulberry32(7), { count: 6, budget: 2 }).culpritIndex;
    fireEvent.press(getByTestId(`suspect-${culprit}`));

    // 洗冤 → 旗标分支(结盟)→ 盟友结局
    expect(getByText(/落了空/)).toBeTruthy();
    fireEvent.press(getByText(G.cont)); // vindicate line → branch 自动 → winAlly
    expect(getByText(/互为奥援/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));
    expect(getByText(/盟友/)).toBeTruthy();
  });

  it('说不到位 → 失颜面坏结局', async () => {
    sayMock.mockResolvedValue({ ok: true, data: { pass: false, reply: '就这点本事?', score: 3 }, requestId: 'r' });
    const { getByText, getByTestId, findByText } = mount();
    fireEvent.press(getByText(G.cont)); // gate 1
    fireEvent.press(getByText(G.cont)); // gate 2
    fireEvent.press(getByText(/抬头直言/));
    fireEvent.press(getByText(G.cont)); // courtyard 1
    fireEvent.press(getByText(G.cont)); // courtyard 2
    fireEvent.press(getByText(/自有分寸/));
    fireEvent.press(getByText(G.cont)); // meet line
    fireEvent.changeText(getByTestId('sayline-input'), '你算老几');
    fireEvent.press(getByText(G.sayBtn));
    expect(await findByText('就这点本事?')).toBeTruthy();
    fireEvent.press(getByText(G.cont)); // → snub
    expect(getByText(/送答应回去/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));
    expect(getByText(/失了颜面/)).toBeTruthy();
  });
});

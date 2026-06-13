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
import { zh } from '../../../locales/zh-CN';

const G = zh.games.drama;
const sayMock = api.dramaSay as jest.Mock;

function mount() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'GameDrama', params: undefined } as never;
  return render(<DramaScreen navigation={navigation} route={route} />);
}

beforeEach(() => sayMock.mockReset());

describe('DramaScreen 犬朝后宫(D2:对白→选择→说台词→分支→结局)', () => {
  it('说对台词 → 走好结局', async () => {
    sayMock.mockResolvedValue({
      ok: true,
      data: { pass: true, reply: '答应倒有几分胆色。', score: 8 },
      requestId: 'r',
    });
    const { getByText, getByTestId, findByText } = mount();

    // 宫门对白
    expect(getByText(/规矩还没学全/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));
    expect(getByText(/雪团初入宫闱/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));

    // 选择
    fireEvent.press(getByText(/屈膝行礼/));

    // 贵妃刁难 → 说台词
    expect(getByText(/也敢来争宠/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));
    fireEvent.changeText(getByTestId('sayline-input'), '贵妃言重了,雪团初来,只求安分守己。');
    fireEvent.press(getByText(G.sayBtn));

    // 判定通过 → 回应 + 继续
    expect(await findByText('答应倒有几分胆色。')).toBeTruthy();
    expect(getByText(G.sayPass)).toBeTruthy();
    expect(sayMock).toHaveBeenCalledTimes(1);
    fireEvent.press(getByText(G.cont));

    // 好结局
    expect(getByText(/稳住了贵妃/)).toBeTruthy();
    fireEvent.press(getByText(G.cont));
    expect(getByText(/初露锋芒/)).toBeTruthy();
  });

  it('说不到位 → 走坏结局', async () => {
    sayMock.mockResolvedValue({
      ok: true,
      data: { pass: false, reply: '就这点本事?', score: 3, hint: '再稳一点' },
      requestId: 'r',
    });
    const { getByText, getByTestId, findByText } = mount();
    fireEvent.press(getByText(G.cont));
    fireEvent.press(getByText(G.cont));
    fireEvent.press(getByText(/抬头直言/));
    fireEvent.press(getByText(G.cont)); // 过贵妃刁难那句
    fireEvent.changeText(getByTestId('sayline-input'), '你算老几');
    fireEvent.press(getByText(G.sayBtn));
    expect(await findByText('就这点本事?')).toBeTruthy();
    expect(getByText(G.sayFail)).toBeTruthy();
    fireEvent.press(getByText(G.cont)); // 结算 → snub 场景的台词
    expect(getByText(/也配进这后宫/)).toBeTruthy();
    fireEvent.press(getByText(G.cont)); // → 坏结局
    expect(getByText(/失了颜面/)).toBeTruthy();
  });
});

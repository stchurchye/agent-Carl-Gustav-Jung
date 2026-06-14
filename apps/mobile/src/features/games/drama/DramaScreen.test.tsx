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
const cont = (getByText: (m: RegExp | string) => unknown) => fireEvent.press(getByText(G.cont) as never);

function mount() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'GameDrama', params: undefined } as never;
  return render(<DramaScreen navigation={navigation} route={route} />);
}

function say(getByText: any, getByTestId: any, findByText: any, line: string, reply: string) {
  fireEvent.changeText(getByTestId('sayline-input'), line);
  fireEvent.press(getByText(G.sayBtn));
  return findByText(reply);
}

beforeEach(() => sayMock.mockReset());

describe('DramaScreen 犬朝后宫(机制全开 + 选择有回响,驱动真实屏)', () => {
  it('行礼+结盟 → 说对 → 查对 → 点破(说台词)反将 → 进第二幕', async () => {
    sayMock.mockResolvedValue({ ok: true, data: { pass: true, reply: 'REPLY_OK', score: 8 }, requestId: 'r' });
    const { getByText, getByTestId, findByText } = mount();

    cont(getByText); // gate 1
    cont(getByText); // gate 2
    fireEvent.press(getByText(/屈膝行礼/)); // polite
    expect(getByText(/倒是个懂规矩的/)).toBeTruthy();
    cont(getByText); // → courtyard
    cont(getByText); // courtyard 1
    cont(getByText); // courtyard 2
    fireEvent.press(getByText(/共进退/)); // trust_molan
    expect(getByText(/关键时是把刀/)).toBeTruthy();
    cont(getByText); // → meet
    cont(getByText); // meet line
    await say(getByText, getByTestId, findByText, '贵妃言重了,雪团初来只求安分。', 'REPLY_OK');
    cont(getByText); // 说对 → favor
    cont(getByText); // favor 1
    cont(getByText); // favor 2 → incident
    cont(getByText); // incident 1
    cont(getByText); // incident 2
    cont(getByText); // incident 3 → probe
    cont(getByText); // probe 引子 → 查案
    const culprit = generateCase(mulberry32(7), { count: 6, budget: 2 }).culpritIndex;
    fireEvent.press(getByTestId(`suspect-${culprit}`)); // 查对 → vindicate
    cont(getByText); // vindicate → retaliate
    cont(getByText); // retaliate → branch(结盟)→ gambit
    expect(getByText(/亮这张牌/)).toBeTruthy();
    cont(getByText); // gambit line → 选择
    fireEvent.press(getByText(/点破她出身/)); // 狠路 → gambitSay
    await say(getByText, getByTestId, findByText, '贵妃总说出身,怎么自己的出身,倒最经不得人提?', 'REPLY_OK');
    cont(getByText); // 说对 → triumph
    cont(getByText); // triumph 1
    cont(getByText); // triumph 2 → act2
    expect(getByText(/晋了嫔位/)).toBeTruthy(); // 进第二幕
  });

  it('直言 + 谨慎 + 说砸 → 失颜面坏结局(有画面)', async () => {
    sayMock.mockResolvedValue({ ok: true, data: { pass: false, reply: 'REPLY_BAD', score: 3 }, requestId: 'r' });
    const { getByText, getByTestId, findByText } = mount();
    cont(getByText);
    cont(getByText);
    fireEvent.press(getByText(/抬头直言/));
    expect(getByText(/出得去的少/)).toBeTruthy(); // 老福:阅人无数的看门人
    cont(getByText);
    cont(getByText);
    cont(getByText);
    fireEvent.press(getByText(/自有分寸/));
    expect(getByText(/全看你自己的眼力/)).toBeTruthy(); // cyWary 埋下查案伏笔
    cont(getByText);
    cont(getByText); // meet line
    await say(getByText, getByTestId, findByText, '你算老几', 'REPLY_BAD');
    cont(getByText); // → snub
    expect(getByText(/送答应回去/)).toBeTruthy();
    cont(getByText);
    expect(getByText(/断成两截/)).toBeTruthy(); // 坏结局有画面(步摇断作两截)
  });
});

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

beforeEach(() => sayMock.mockReset());

describe('DramaScreen 犬朝后宫(扩写:选择一路回响 + 高潮反扑 + 第二幕序)', () => {
  it('行礼 + 结盟 + 说对 + 查对 + 用情报点破 → 第二幕序好结局', async () => {
    sayMock.mockResolvedValue({ ok: true, data: { pass: true, reply: '答应倒有几分胆色。', score: 8 }, requestId: 'r' });
    const { getByText, getByTestId, findByText } = mount();

    cont(getByText); // gate 1
    cont(getByText); // gate 2
    fireEvent.press(getByText(/屈膝行礼/));
    expect(getByText(/倒是个懂规矩的/)).toBeTruthy(); // 行礼 → 老福缓和
    cont(getByText); // → courtyard

    expect(getByText(/最容不得新人/)).toBeTruthy();
    cont(getByText);
    cont(getByText);
    fireEvent.press(getByText(/共进退/));
    expect(getByText(/关键时是把刀/)).toBeTruthy(); // 结盟 → 墨兰给情报
    cont(getByText); // → meet

    expect(getByText(/也敢来争宠/)).toBeTruthy();
    cont(getByText);
    fireEvent.changeText(getByTestId('sayline-input'), '贵妃言重了,雪团初来只求安分。');
    fireEvent.press(getByText(G.sayBtn));
    expect(await findByText('答应倒有几分胆色。')).toBeTruthy();
    cont(getByText); // → favor
    cont(getByText); // favor 1
    cont(getByText); // favor 2 → incident
    expect(getByText(/下了泻药/)).toBeTruthy();
    cont(getByText); // incident 1
    cont(getByText); // incident 2 → probe
    cont(getByText); // probe 引子 → 查案

    const culprit = generateCase(mulberry32(7), { count: 6, budget: 2 }).culpritIndex;
    fireEvent.press(getByTestId(`suspect-${culprit}`)); // → vindicate

    expect(getByText(/没半分败相/)).toBeTruthy();
    cont(getByText); // vindicate → retaliate
    expect(getByText(/失仪之罪/)).toBeTruthy();
    cont(getByText); // retaliate → branch(结盟)自动 → gambit
    expect(getByText(/正是用它的时候/)).toBeTruthy(); // 情报派上用场
    cont(getByText); // gambit line → 选择
    fireEvent.press(getByText(/点破她出身/)); // 以攻代守 → triumph

    expect(getByText(/算你伶俐/)).toBeTruthy();
    cont(getByText); // triumph 1
    cont(getByText); // triumph 2 → act2
    expect(getByText(/晋了常在/)).toBeTruthy(); // 第二幕序
    cont(getByText);
    cont(getByText);
    fireEvent.press(getByText(/稳扎稳打/)); // 第二幕选择 → act2end
    expect(getByText(/第二幕·序/)).toBeTruthy(); // 好结局(含第二幕钩子)
  });

  it('直言 + 谨慎 + 说砸 → 失颜面坏结局', async () => {
    sayMock.mockResolvedValue({ ok: true, data: { pass: false, reply: '就这点本事?', score: 3 }, requestId: 'r' });
    const { getByText, getByTestId, findByText } = mount();
    cont(getByText);
    cont(getByText);
    fireEvent.press(getByText(/抬头直言/));
    expect(getByText(/能横到几时/)).toBeTruthy();
    cont(getByText);
    cont(getByText);
    cont(getByText);
    fireEvent.press(getByText(/自有分寸/));
    expect(getByText(/各凭本事/)).toBeTruthy();
    cont(getByText);
    cont(getByText); // meet line
    fireEvent.changeText(getByTestId('sayline-input'), '你算老几');
    fireEvent.press(getByText(G.sayBtn));
    expect(await findByText('就这点本事?')).toBeTruthy();
    cont(getByText); // → snub
    expect(getByText(/送答应回去/)).toBeTruthy();
    cont(getByText);
    expect(getByText(/失了颜面/)).toBeTruthy();
  });
});

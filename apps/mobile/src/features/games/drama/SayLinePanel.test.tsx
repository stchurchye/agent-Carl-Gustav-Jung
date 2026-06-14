import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../../lib/api', () => ({ api: { dramaSay: jest.fn() } }));
jest.mock('../../../hooks/useHoldToSpeak', () => ({
  useHoldToSpeak: () => ({ holding: false, transcribing: false, onPressIn: jest.fn(), onPressOut: jest.fn() }),
}));

import { api } from '../../../lib/api';
import { SayLinePanel } from './SayLinePanel';
import { zh } from '../../../locales/zh-CN';
import type { SayLine } from './story';

const G = zh.games.drama;
const sayMock = api.dramaSay as jest.Mock;
const STEP: SayLine = { kind: 'sayline', who: 'jinyu', intent: '化解刁难', context: '前殿' };

beforeEach(() => sayMock.mockReset());

describe('SayLinePanel 出错给反馈(不静默)', () => {
  it('请求失败 → 显示错误提示、不推进', async () => {
    sayMock.mockRejectedValue(new Error('API_KEY_MISSING'));
    const onResolved = jest.fn();
    const { getByText, getByTestId, findByText } = render(
      <SayLinePanel step={STEP} npcName="金羽贵妃" onResolved={onResolved} />,
    );
    fireEvent.changeText(getByTestId('sayline-input'), '随便说一句');
    fireEvent.press(getByText(G.sayBtn));
    expect(await findByText(G.sayError)).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
  });
});

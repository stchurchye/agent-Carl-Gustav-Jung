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

describe('SayLinePanel 说错可重试(不直接失败)', () => {
  const sayOnce = async (u: ReturnType<typeof render>, text: string) => {
    fireEvent.changeText(u.getByTestId('sayline-input'), text);
    fireEvent.press(u.getByText(G.sayBtn));
    await u.findByText('NO');
  };

  it('说对 → onResolved(true)', async () => {
    sayMock.mockResolvedValue({ ok: true, data: { pass: true, reply: 'YES', score: 9 }, requestId: 'r' });
    const onResolved = jest.fn();
    const u = render(<SayLinePanel step={STEP} npcName="金羽贵妃" onResolved={onResolved} />);
    fireEvent.changeText(u.getByTestId('sayline-input'), '得体一句');
    fireEvent.press(u.getByText(G.sayBtn));
    await u.findByText('YES');
    fireEvent.press(u.getByText(G.cont));
    expect(onResolved).toHaveBeenCalledWith(true);
  });

  it('说错一次 → 给「再说一次」,不调用 onResolved', async () => {
    sayMock.mockResolvedValue({ ok: true, data: { pass: false, reply: 'NO', score: 2 }, requestId: 'r' });
    const onResolved = jest.fn();
    const u = render(<SayLinePanel step={STEP} npcName="金羽贵妃" onResolved={onResolved} />);
    await sayOnce(u, '随便说');
    expect(onResolved).not.toHaveBeenCalled();
    expect(u.getByText(/再说一次/)).toBeTruthy();
  });

  it('连错 6 次(1+5 重试)用完 → 才真走失败 onResolved(false)', async () => {
    sayMock.mockResolvedValue({ ok: true, data: { pass: false, reply: 'NO', score: 2 }, requestId: 'r' });
    const onResolved = jest.fn();
    const u = render(<SayLinePanel step={STEP} npcName="金羽贵妃" onResolved={onResolved} />);
    for (let i = 1; i <= 6; i++) {
      await sayOnce(u, `错${i}`);
      if (i < 6) fireEvent.press(u.getByText(/再说一次/)); // 退回重试,不判失败
    }
    expect(onResolved).not.toHaveBeenCalled(); // 6 次后不再自动失败,等玩家点继续
    fireEvent.press(u.getByText(G.cont));
    expect(onResolved).toHaveBeenCalledWith(false);
  });
});

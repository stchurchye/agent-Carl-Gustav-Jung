import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => false }),
  };
});

const mockUser = {
  id: 'u1',
  username: 'wang',
  displayName: '老王',
  createdAt: 'x',
  avatarDisplayUrl: null,
  pixelAvatar: null as null | { v: 1 },
};
jest.mock('../components/AuthGate', () => ({
  useAuth: () => ({ user: mockUser, logout: jest.fn() }),
}));
jest.mock('../lib/api', () => ({
  api: {
    listDocuments: jest.fn().mockResolvedValue({ data: [] }),
    getPersona: jest
      .fn()
      .mockResolvedValue({ data: { identity: { assistantName: '旺财' }, user: { preferredName: '老王头' } } }),
  },
}));
jest.mock('../lib/tts', () => ({
  getStoredVoiceId: jest.fn().mockResolvedValue(null),
  listVoicesForDialect: jest.fn().mockResolvedValue([]),
  ttsVoiceOptionId: jest.fn(),
  ttsVoiceOptionLabel: jest.fn(),
}));

import { MeScreen } from './MeScreen';
import { zh } from '../locales/zh-CN';

function mount() {
  const navigate = jest.fn();
  const navigation = { navigate, goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'Settings', params: undefined } as never;
  const r = render(<MeScreen navigation={navigation} route={route} />);
  return { ...r, navigate };
}

describe('MeScreen 一行一个像素行', () => {
  it('行齐全:头像/我的名字/我的狗/狗的声音/导出/客户端日志/退出(狗名与称呼已移到狗狗性格)', async () => {
    const { getByText, queryByText } = mount();
    await waitFor(() => expect(getByText(zh.me.myDog)).toBeTruthy());
    expect(getByText(zh.me.myAvatar)).toBeTruthy();
    expect(getByText(zh.me.myName)).toBeTruthy();
    expect(getByText(zh.me.myDogNotAdopted)).toBeTruthy();
    // 狗狗的名字 / 它怎么称呼你 已收归「狗狗性格」,设置页不再重复
    expect(queryByText(zh.me.personalityAssistantName)).toBeNull();
    expect(queryByText(zh.me.callMe)).toBeNull();
    // 朗读声音 → 收敛为「狗的声音」一行(SettingsDogSound)
    expect(getByText(zh.me.dogSoundTitle)).toBeTruthy();
    expect(getByText(zh.me.exportTitle)).toBeTruthy();
    // 「全部文稿」入口已在改版中从设置页移除,不再断言
    expect(getByText(zh.me.clientLogTitle)).toBeTruthy();
    expect(getByText(/退出登录/)).toBeTruthy();
  });

  it('我的狗 → SettingsMyDog', async () => {
    const { getByText, navigate } = mount();
    await waitFor(() => expect(getByText(zh.me.myDog)).toBeTruthy());
    fireEvent.press(getByText(zh.me.myDog));
    expect(navigate).toHaveBeenCalledWith('SettingsMyDog');
  });

  it('玩一玩 → GameHub', async () => {
    const { getByText, navigate } = mount();
    await waitFor(() => expect(getByText(zh.me.playGames)).toBeTruthy());
    fireEvent.press(getByText(zh.me.playGames));
    expect(navigate).toHaveBeenCalledWith('GameHub');
  });
});

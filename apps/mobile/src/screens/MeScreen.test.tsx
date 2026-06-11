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
  it('行齐全:我的名字/我的狗/狗狗的名字/它怎么称呼你/朗读声音/导出/全部文稿/客户端日志/退出', async () => {
    const { getByText } = mount();
    await waitFor(() => expect(getByText('旺财')).toBeTruthy());
    expect(getByText(zh.me.myName)).toBeTruthy();
    expect(getByText(zh.me.myDog)).toBeTruthy();
    expect(getByText(zh.me.myDogNotAdopted)).toBeTruthy();
    expect(getByText(zh.me.personalityAssistantName)).toBeTruthy();
    expect(getByText(zh.me.callMe)).toBeTruthy();
    expect(getByText('老王头')).toBeTruthy();
    expect(getByText(zh.me.voiceTitle)).toBeTruthy();
    expect(getByText(zh.me.exportTitle)).toBeTruthy();
    expect(getByText(zh.me.allDocs)).toBeTruthy();
    expect(getByText(zh.me.clientLogTitle)).toBeTruthy();
    expect(getByText(/退出登录/)).toBeTruthy();
  });

  it('我的狗 → SettingsMyDog;狗狗的名字 → SettingsPersonalityIdentity', async () => {
    const { getByText, navigate } = mount();
    await waitFor(() => expect(getByText(zh.me.myDog)).toBeTruthy());
    fireEvent.press(getByText(zh.me.myDog));
    expect(navigate).toHaveBeenCalledWith('SettingsMyDog');
    fireEvent.press(getByText(zh.me.personalityAssistantName));
    expect(navigate).toHaveBeenCalledWith('SettingsPersonalityIdentity');
  });
});

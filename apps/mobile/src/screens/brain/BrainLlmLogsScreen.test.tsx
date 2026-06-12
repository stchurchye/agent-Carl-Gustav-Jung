import { fireEvent, render, waitFor } from '@testing-library/react-native';

// useFocusEffect 需 NavigationContainer → 降级成 useEffect。
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  return { useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]) };
});

jest.mock('../../lib/api', () => ({
  api: { listLlmLogs: jest.fn().mockResolvedValue({ data: [] }) },
}));

jest.mock('../../lib/apiKeyKind', () => ({
  API_KEY_KINDS: ['deepseek', 'zenmux', 'dashscope'],
  loadApiKeyStatus: jest.fn().mockResolvedValue({ configured: true }),
}));

import { BrainLlmLogsScreen } from './BrainLlmLogsScreen';

function mount() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'BrainLlmLogs', params: undefined } as never;
  const utils = render(<BrainLlmLogsScreen navigation={navigation} route={route} />);
  return { ...utils, navigation: navigation as unknown as { navigate: jest.Mock } };
}

describe('BrainLlmLogsScreen 二级入口', () => {
  it('展示「汪星联络方式」「跑腿用的默认模型」两个二级入口', async () => {
    const { findByText } = mount();
    expect(await findByText('汪星联络方式')).toBeTruthy();
    expect(await findByText('跑腿用的默认模型')).toBeTruthy();
    // 三把密钥全配好 → 3/3 已配置
    expect(await findByText('3/3 已配置')).toBeTruthy();
  });

  it('点入口跳到对应二级页', async () => {
    const { findByText, navigation } = mount();
    fireEvent.press(await findByText('汪星联络方式'));
    fireEvent.press(await findByText('跑腿用的默认模型'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('BrainHomeKeys');
      expect(navigation.navigate).toHaveBeenCalledWith('BrainAgentDefaultModel');
    });
  });
});

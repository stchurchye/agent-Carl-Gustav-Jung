import { render, waitFor } from '@testing-library/react-native';

const mockFlags = { WRITING_ENABLED: true };
jest.mock('../lib/featureFlags', () => ({
  get WRITING_ENABLED() {
    return mockFlags.WRITING_ENABLED;
  },
}));

// useFocusEffect 需 NavigationContainer → 降级成 useEffect。
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => false }),
  };
});

// useBottomTabBarHeight 需 Bottom Tab Navigator 上下文,测试里裸渲染屏幕 → 桩成固定高度。
jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 0,
}));

jest.mock('../lib/api', () => ({
  api: { listGroups: jest.fn().mockResolvedValue({ data: [] }) },
}));
jest.mock('../lib/privateChatPreview', () => ({
  loadWorkbenchSessionRows: jest.fn().mockResolvedValue([]),
}));
jest.mock('../lib/studioTopicPreview', () => ({
  loadGroupTopicPreviews: jest.fn().mockResolvedValue([]),
}));
jest.mock('../lib/writingCache', () => ({ getCachedTabs: () => [] }));
jest.mock('../lib/openWriting', () => ({ openWriting: jest.fn() }));

import { GroupListScreen } from './GroupListScreen';
import { zh } from '../locales/zh-CN';

function mount() {
  const navigation = { navigate: jest.fn(), push: jest.fn(), setOptions: jest.fn() } as never;
  const route = { key: 'k', name: 'GroupList', params: undefined } as never;
  return render(<GroupListScreen navigation={navigation} route={route} />);
}

describe('GroupListScreen 写作模式开关', () => {
  it('WRITING_ENABLED=false 时不渲染「文档」入口行', async () => {
    mockFlags.WRITING_ENABLED = false;
    const { queryByText, getByText } = mount();
    await waitFor(() => expect(getByText(zh.studio.emptyList)).toBeTruthy());
    expect(queryByText(zh.studio.writeText)).toBeNull();
  });

  it('WRITING_ENABLED=true 时「文档」入口行可见', async () => {
    mockFlags.WRITING_ENABLED = true;
    const { getByText } = mount();
    await waitFor(() => expect(getByText(zh.studio.writeText)).toBeTruthy());
  });
});

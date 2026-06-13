import { render } from '@testing-library/react-native';
import type { BrainSnapshot } from '../../brain/useBrainSnapshot';

// useFocusEffect 需 NavigationContainer → 降级成 useEffect。
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  return { useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]) };
});

// useBottomTabBarHeight 需 Bottom Tab Navigator 上下文,测试里裸渲染屏幕 → 桩成固定高度。
jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 0,
}));

const mockUseBrainSnapshot = jest.fn();
jest.mock('../../brain/useBrainSnapshot', () => ({
  useBrainSnapshot: () => mockUseBrainSnapshot(),
}));

jest.mock('../../lib/apiKeyKind', () => ({
  API_KEY_KINDS: ['deepseek', 'zenmux', 'dashscope'],
  loadApiKeyStatus: jest.fn().mockResolvedValue({ configured: false }),
}));

import { BrainHubScreen } from './BrainHubScreen';

function snap(): BrainSnapshot {
  return {
    personaCustomized: false,
    longMemoryCount: 0,
    shortMemoryCount: 0,
    reviewCount: 0,
    pendingSkillCount: 0,
    pendingEpisodicCount: 0,
    llmLogCount: 0,
    autoExtractEnabled: false,
    profileChars: 0,
    projectChars: 0,
    shortChars: 0,
    totalUserChars: 0,
  };
}

function mount() {
  mockUseBrainSnapshot.mockReturnValue({
    snapshot: snap(),
    loading: false,
    error: null,
    refresh: jest.fn(),
  });
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'BrainHub', params: undefined } as never;
  return render(<BrainHubScreen navigation={navigation} route={route} />);
}

describe('BrainHubScreen My Bow Wow 改版', () => {
  beforeEach(() => mockUseBrainSnapshot.mockReset());

  it('标题与卡片用狗狗文案,旧品牌词消失', () => {
    const { getAllByText, getByText, queryByText } = mount();
    expect(getAllByText('My Bow Wow').length).toBeGreaterThan(0);
    expect(getByText('狗狗性格')).toBeTruthy();
    expect(getByText('狗狗记得的事')).toBeTruthy();
    expect(getByText('汪星通讯记录')).toBeTruthy();
    // 设置入口从主页移到 my bow wow
    expect(getByText('管理 Bow Wow')).toBeTruthy();
    expect(queryByText('流浪猫大脑')).toBeNull();
  });

  it('联络方式与跑腿默认模型已收进「汪星通讯记录」,不再在 Hub 平铺', () => {
    const { queryByText } = mount();
    expect(queryByText('汪星联络方式')).toBeNull();
    expect(queryByText('跑腿用的默认模型')).toBeNull();
  });

  it('Agent 卡片硬编码文案迁入 locale(跑腿任务)', () => {
    const { getByText, queryByText } = mount();
    expect(getByText('跑腿任务')).toBeTruthy();
    expect(queryByText('Agent 任务')).toBeNull();
  });
});

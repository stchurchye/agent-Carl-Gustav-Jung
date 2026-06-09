import { render } from '@testing-library/react-native';
import type { BrainSnapshot } from '../../brain/useBrainSnapshot';

// useFocusEffect 需 NavigationContainer → 降级成 useEffect。
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  return { useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]) };
});

const mockUseBrainSnapshot = jest.fn();
jest.mock('../../brain/useBrainSnapshot', () => ({
  useBrainSnapshot: () => mockUseBrainSnapshot(),
}));

import { BrainMemoryHubScreen } from './BrainMemoryHubScreen';

const LIMITS = { profile: 100, project: 100, short: 100, total: 100 };

function snap(overrides: Partial<BrainSnapshot>): BrainSnapshot {
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
    ...overrides,
  };
}

function mountWith(snapshot: BrainSnapshot) {
  mockUseBrainSnapshot.mockReturnValue({
    snapshot,
    loading: false,
    error: null,
    refresh: jest.fn(),
    limits: LIMITS,
  });
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
  const route = { key: 'k', name: 'BrainMemoryHub', params: undefined } as never;
  return render(<BrainMemoryHubScreen navigation={navigation} route={route} />);
}

describe('BrainMemoryHubScreen 待审 badge(M5 polish)', () => {
  beforeEach(() => mockUseBrainSnapshot.mockReset());

  it('有待审 → 技能/情景记忆卡显示「N 条待审」', () => {
    const { getByText } = mountWith(snap({ pendingSkillCount: 2, pendingEpisodicCount: 3 }));
    expect(getByText('2 条待审')).toBeTruthy(); // skillReview badge
    expect(getByText('3 条待审')).toBeTruthy(); // memoryEpisodic badge
  });

  it('0 待审 → 技能卡退回提示文案、情景卡不显示 badge', () => {
    const { getByText, queryByText } = mountWith(snap({ pendingSkillCount: 0, pendingEpisodicCount: 0 }));
    expect(getByText('自蒸馏建议技能')).toBeTruthy(); // skillReviewHint
    expect(queryByText('0 条待审')).toBeNull(); // 不应渲染 0 待审
  });
});

import { StyleSheet } from 'react-native';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

const mockListSkills = jest.fn();
const mockPatchSkill = jest.fn();
const mockDeleteSkill = jest.fn();
jest.mock('../../lib/api', () => ({
  api: {
    listSkills: () => mockListSkills(),
    patchSkill: (...a: unknown[]) => mockPatchSkill(...a),
    deleteSkill: (...a: unknown[]) => mockDeleteSkill(...a),
  },
}));
// useFocusEffect 需 NavigationContainer;WeChatChatHeader 用 useNavigation —— 都降级 mock。
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn(), navigate: jest.fn() }),
  };
});

import { BrainSkillReviewScreen } from './BrainSkillReviewScreen';
import type { TopicSkill } from '../../lib/api';
import { colors } from '../../theme/colors';

const distilled: TopicSkill = {
  id: 's1',
  scope: 'user',
  title: '怎么做多步研究',
  content: '先 web_search 再 deep_research,最后汇总。',
  enabled: false,
  source: 'auto_distilled',
  sourceRunId: 'r1',
};

beforeEach(() => {
  mockListSkills.mockReset();
  mockPatchSkill.mockReset().mockResolvedValue({ data: { skill: { ...distilled, enabled: true } } });
  mockDeleteSkill.mockReset();
});

function bgColors(tree: { props?: { style?: unknown }; children?: unknown } | null): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n === 'string') return;
    const node = n as { props?: { style?: unknown }; children?: unknown[] };
    const s = StyleSheet.flatten(node.props?.style) as { backgroundColor?: unknown } | undefined;
    if (s && typeof s.backgroundColor === 'string') out.push(s.backgroundColor);
    (node.children ?? []).forEach(walk);
  };
  walk(tree);
  return out;
}

// 行为:建议技能评审屏渲染待评审(auto_distilled, enabled=false)技能,提供启用/忽略;
// 忽略按钮用品牌 danger 令牌(非散写的 #d9534f),启用调 patchSkill(id,{enabled:true})。
it('lists a pending distilled skill with enable/dismiss actions', async () => {
  mockListSkills.mockResolvedValue({ data: { skills: [distilled] } });
  const r = render(<BrainSkillReviewScreen navigation={{} as never} route={{} as never} />);

  await waitFor(() => r.getByText('怎么做多步研究'));
  expect(r.getByText('启用')).toBeTruthy();
  expect(r.getByText('忽略')).toBeTruthy();

  const bgs = bgColors(r.toJSON() as never);
  expect(bgs).toContain(colors.danger); // 忽略 = 品牌 danger
  expect(bgs.some((c) => c.toLowerCase() === '#d9534f')).toBe(false); // 散色绝迹
});

it('enabling a pending skill calls patchSkill(id, {enabled:true})', async () => {
  mockListSkills.mockResolvedValue({ data: { skills: [distilled] } });
  const r = render(<BrainSkillReviewScreen navigation={{} as never} route={{} as never} />);
  await waitFor(() => r.getByText('启用'));

  await act(async () => {
    fireEvent.press(r.getByText('启用'));
  });

  expect(mockPatchSkill).toHaveBeenCalledWith('s1', { enabled: true });
});

it('filters out hand-written skills (source=null)', async () => {
  mockListSkills.mockResolvedValue({
    data: { skills: [{ ...distilled, id: 's2', source: null, title: '手写技能' }] },
  });
  const r = render(<BrainSkillReviewScreen navigation={{} as never} route={{} as never} />);

  await waitFor(() => r.getByText(/暂无建议技能/));
  expect(r.queryByText('手写技能')).toBeNull();
});

import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('./hooks/useAgentRunPoll', () => ({ useAgentRunPoll: () => ({ run: null }) }));
jest.mock('../../components/AuthGate', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('./agentApi', () => ({ resumeAgentRun: jest.fn() }));
jest.mock('../../lib/appAlert', () => ({ appAlert: jest.fn() }));

import { AskUserPromptCard } from './AskUserPromptCard';
import { colors } from '../../theme/colors';

type JsonNode = { type?: string; props?: Record<string, unknown>; children?: Array<JsonNode | string> | null } | null;

function findByType(node: JsonNode, type: string): JsonNode[] {
  const out: JsonNode[] = [];
  const walk = (n: JsonNode | string) => {
    if (!n || typeof n === 'string') return;
    if (n.type === type) out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(node);
  return out;
}

// 行为:ask_user 提交按钮用品牌动作色(colors.link),而非散写的 LinkedIn 蓝 #0a66c2。
it('renders the submit button with the brand action color (not a stray blue)', () => {
  const tree = render(
    <AskUserPromptCard
      runId="r1"
      initial={{ question: '继续吗?', target: 'u1', openedForAll: true }}
    />,
  ).toJSON() as JsonNode;

  const styles = findByType(tree, 'View')
    .map((n) => StyleSheet.flatten(n?.props?.style as never) as Record<string, unknown> | undefined)
    .filter(Boolean) as Array<Record<string, unknown>>;
  const bgs = styles.map((s) => s.backgroundColor);

  expect(bgs).toContain(colors.link); // 提交按钮底=品牌绿
  expect(bgs.some((c) => c === '#0a66c2')).toBe(false); // 蓝色绝迹
});

// Review 2026-06-11 [P1][mobile-agent] AskUserPromptCard.tsx:65
// setSubmitting(true) 异步刷新,同帧双击时第二击闭包里 submitting 仍是 false
// → resumeAgentRun 重复发两次。修后:ref 同步守卫。
it('rapid double-press only fires resumeAgentRun once', async () => {
  const { resumeAgentRun } = jest.requireMock('./agentApi') as {
    resumeAgentRun: jest.Mock;
  };
  resumeAgentRun.mockReset();
  let resolveResume: () => void = () => {};
  resumeAgentRun.mockImplementation(() => new Promise<void>((r) => (resolveResume = r)));

  const { getByText, getByPlaceholderText } = render(
    <AskUserPromptCard
      runId="r1"
      initial={{ question: '继续吗?', target: 'u1', openedForAll: true }}
    />,
  );
  fireEvent.changeText(getByPlaceholderText('输入你的回答…'), '继续');
  const btn = getByText('提交');
  await act(async () => {
    fireEvent.press(btn);
    fireEvent.press(btn); // 重渲染前的第二击
  });
  expect(resumeAgentRun).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveResume();
  });
});

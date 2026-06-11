import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { AgentRun, AgentStep } from './types';

// W1c:聊天卡的步骤列表去嵌套滚动 ——
//   运行中:只渲染最近 3 步 + 「查看全部」深链(详情屏);
//   终态:不再逐行铺步骤,渲染「共 N 步」摘要链;
//   expanded(详情屏):全量平铺,无截断、无内嵌 ScrollView;
//   ask_user 兜底:等待输入时,即使 ask 步不在最近 3 步窗口内也要渲染提问。

const mockNavigateBrainTab = jest.fn();
jest.mock('../../lib/navigateBrain', () => ({
  navigateBrainTab: (...a: unknown[]) => mockNavigateBrainTab(...a),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({}),
}));
jest.mock('../../components/AskUserPrompt', () => {
  const { Text: T } = jest.requireActual('react-native');
  return ({ question }: { question: string }) => <T>ASK:{question}</T>;
});

import { AgentStepList } from './AgentStepList';

function makeStep(idx: number, kind: AgentStep['kind'] = 'observe', toolName?: string): AgentStep {
  return { id: `s${idx}`, runId: 'r1', idx, kind, toolName: toolName ?? null } as AgentStep;
}
function makeRun(status: AgentRun['status']): AgentRun {
  return { id: 'r1', status } as AgentRun;
}

const sixSteps = [1, 2, 3, 4, 5, 6].map((i) => makeStep(i));

it('active run shows only the last 3 steps plus a view-all link', () => {
  const { queryByText, getByText } = render(
    <AgentStepList steps={sixSteps} run={makeRun('running')} />,
  );
  expect(getByText(/#6/)).toBeTruthy();
  expect(getByText(/#4/)).toBeTruthy();
  expect(queryByText(/#1/)).toBeNull();
  fireEvent.press(getByText(/查看全部/));
  expect(mockNavigateBrainTab).toHaveBeenCalledWith(expect.anything(), 'BrainAgentTaskDetail', {
    runId: 'r1',
  });
});

it('terminal run collapses plain steps into a summary link', () => {
  const { queryByText, getByText } = render(
    <AgentStepList steps={sixSteps} run={makeRun('completed')} />,
  );
  expect(queryByText(/#6/)).toBeNull();
  expect(getByText(/共 6 步/)).toBeTruthy();
});

it('expanded variant renders every step without a view-all link', () => {
  const { getByText, queryByText } = render(
    <AgentStepList steps={sixSteps} run={makeRun('completed')} expanded />,
  );
  expect(getByText(/#1/)).toBeTruthy();
  expect(getByText(/#6/)).toBeTruthy();
  expect(queryByText(/查看全部/)).toBeNull();
});

it('terminal run still surfaces error steps (failure reason must not be folded away)', () => {
  const steps = [
    makeStep(1),
    { ...makeStep(2, 'tool_call', 'http_fetch'), error: 'fetch 超时' } as AgentStep,
    makeStep(3),
  ];
  const { getByText } = render(<AgentStepList steps={steps} run={makeRun('failed')} />);
  expect(getByText(/fetch 超时/)).toBeTruthy();
  expect(getByText(/#2/)).toBeTruthy(); // 错误步带上下文标签
});

it('renders the ask_user prompt even when the ask step fell outside the visible window', () => {
  const steps = [
    makeStep(1),
    makeStep(2, 'tool_call', 'ask_user'),
    makeStep(3),
    makeStep(4),
    makeStep(5),
    makeStep(6),
  ];
  const run = { ...makeRun('awaiting_user_input'), pendingUserPrompt: '选 A 还是 B?' } as AgentRun;
  const { getByText } = render(
    <AgentStepList steps={steps} run={run} resumeRun={async () => {}} />,
  );
  expect(getByText(/ASK:选 A 还是 B\?/)).toBeTruthy();
});

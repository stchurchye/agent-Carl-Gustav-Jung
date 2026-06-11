import React from 'react';
import { render } from '@testing-library/react-native';
import type { AgentRun, AgentStep } from './types';
import { AgentRunActivityLine } from './AgentRunActivityLine';

// W1d 等待感:运行中渲染「正在做什么 · 已用时」动态行;终态/排队不渲染。

function makeRun(status: AgentRun['status'], createdAgoMs = 65_000): AgentRun {
  return {
    id: 'r1',
    status,
    createdAt: new Date(Date.now() - createdAgoMs).toISOString(),
  } as AgentRun;
}
const toolStep = (toolName: string): AgentStep =>
  ({ id: 's1', runId: 'r1', idx: 1, kind: 'tool_call', toolName } as AgentStep);

it('shows the current tool and elapsed time while running', () => {
  const { getByText } = render(
    <AgentRunActivityLine run={makeRun('running')} steps={[toolStep('search_papers')]} />,
  );
  expect(getByText(/正在调用 search_papers/)).toBeTruthy();
  expect(getByText(/1:0\d/)).toBeTruthy();
});

it('describes waiting states in words', () => {
  const { getByText } = render(
    <AgentRunActivityLine run={makeRun('awaiting_user_input')} steps={[]} />,
  );
  expect(getByText(/等待你的回答/)).toBeTruthy();
});

it('renders nothing for terminal or queued runs', () => {
  const t = render(<AgentRunActivityLine run={makeRun('completed')} steps={[]} />);
  expect(t.toJSON()).toBeNull();
  const q = render(<AgentRunActivityLine run={makeRun('queued')} steps={[]} />);
  expect(q.toJSON()).toBeNull();
});

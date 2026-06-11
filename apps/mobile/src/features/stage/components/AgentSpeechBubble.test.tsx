import React from 'react';
import { render } from '@testing-library/react-native';
import type { AgentRun } from '../../agent/types';

const mockPoll = jest.fn();
jest.mock('../../agent/hooks/useAgentRunPoll', () => ({
  useAgentRunPoll: (runId: string) => mockPoll(runId),
}));

import { AgentSpeechBubble } from './AgentSpeechBubble';

const run = (over: Partial<AgentRun>): AgentRun =>
  ({ id: 'r', status: 'running', createdAt: new Date(Date.now() - 65_000).toISOString(), ...over }) as AgentRun;

describe('AgentSpeechBubble(狗的任务台词,订阅 runStore)', () => {
  beforeEach(() => mockPoll.mockReset());

  it('运行中:显示活动一句话+耗时,带思考点', () => {
    mockPoll.mockReturnValue({ run: run({}), steps: [], notices: [], connected: true });
    const { getByText, getByTestId } = render(
      <AgentSpeechBubble runId="r" speakerName="旺财" maxHeight={300} />,
    );
    expect(getByText(/正在执行 · 1:0\d/)).toBeTruthy();
    expect(getByTestId('bubble-pending')).toBeTruthy();
  });

  it('等待授权:文案带工具名与点头提示', () => {
    mockPoll.mockReturnValue({
      run: run({ status: 'awaiting_approval', pendingApprovalToolName: 'send_email' }),
      steps: [],
      notices: [],
      connected: true,
    });
    const { getByText } = render(<AgentSpeechBubble runId="r" maxHeight={300} />);
    expect(getByText(/send_email/)).toBeTruthy();
  });

  it('missing:任务已不在', () => {
    mockPoll.mockReturnValue({ run: null, steps: [], notices: [], connected: false, missing: true });
    const { getByText } = render(<AgentSpeechBubble runId="r" maxHeight={300} />);
    expect(getByText(/不在了/)).toBeTruthy();
  });
});

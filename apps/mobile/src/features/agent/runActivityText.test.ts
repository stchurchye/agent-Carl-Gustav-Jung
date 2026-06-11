import type { AgentRun, AgentStep } from './types';
import { activityText, formatElapsed } from './runActivityText';

const run = (status: AgentRun['status']): AgentRun => ({ id: 'r', status }) as AgentRun;
const step = (kind: AgentStep['kind'], toolName?: string): AgentStep =>
  ({ id: 's', runId: 'r', idx: 0, kind, toolName: toolName ?? null }) as AgentStep;

describe('activityText(从 AgentRunActivityLine 抽出的纯函数,行为锁定)', () => {
  it('规划/重规划/等待授权/等待回答', () => {
    expect(activityText(run('planning'), [])).toBe('正在规划');
    expect(activityText(run('replanning'), [])).toBe('正在重新规划');
    expect(activityText(run('awaiting_approval'), [])).toBe('等待你授权');
    expect(activityText(run('awaiting_user_input'), [])).toBe('等待你的回答');
  });

  it('running 按最后一步推断', () => {
    expect(activityText(run('running'), [step('tool_call', 'web_search')])).toBe(
      '正在调用 web_search',
    );
    expect(activityText(run('running'), [step('observe')])).toBe('正在整理结果');
    expect(activityText(run('running'), [step('reply')])).toBe('正在撰写回复');
    expect(activityText(run('running'), [])).toBe('正在执行');
  });
});

describe('formatElapsed(注入 now,可测)', () => {
  it('mm:ss 格式', () => {
    const from = new Date(1000_000).toISOString();
    expect(formatElapsed(from, 1000_000 + 65_000)).toBe('1:05');
    expect(formatElapsed(from, 1000_000)).toBe('0:00');
  });
});

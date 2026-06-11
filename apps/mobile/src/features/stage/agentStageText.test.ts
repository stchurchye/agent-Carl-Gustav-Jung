import type { AgentRun, AgentStep } from '../agent/types';
import { runStageText } from './agentStageText';

const NOW = 1_750_000_000_000;
const run = (over: Partial<AgentRun>): AgentRun =>
  ({
    id: 'r',
    status: 'running',
    createdAt: new Date(NOW - 83_000).toISOString(),
    ...over,
  }) as AgentRun;
const steps: AgentStep[] = [];

describe('runStageText:run → 狗的台词', () => {
  it('missing → 任务不存在(muted)', () => {
    const t = runStageText(null, [], { nowMs: NOW, missing: true });
    expect(t.text).toContain('不在了');
    expect(t.tone).toBe('muted');
  });

  it('运行中 → 活动 + 已用时', () => {
    const t = runStageText(
      run({ status: 'running' }),
      [{ id: 's', runId: 'r', idx: 0, kind: 'tool_call', toolName: 'web_search' } as AgentStep],
      { nowMs: NOW },
    );
    expect(t.text).toBe('正在调用 web_search · 1:23');
    expect(t.tone).toBe('normal');
  });

  it('排队 → 位置提示', () => {
    const t = runStageText(run({ status: 'queued', queuePosition: 2 }), steps, { nowMs: NOW });
    expect(t.text).toContain('排队');
    expect(t.text).toContain('2');
  });

  it('等授权 → attention 角标 + 工具名', () => {
    const t = runStageText(
      run({ status: 'awaiting_approval', pendingApprovalToolName: 'send_email' }),
      steps,
      { nowMs: NOW },
    );
    expect(t.text).toContain('send_email');
    expect(t.badge).toBe('attention');
  });

  it('等我回答 → 问题截断 + attention;等别人 → muted 提示', () => {
    const mine = runStageText(
      run({
        status: 'awaiting_user_input',
        pendingUserPrompt: '想'.repeat(100),
        askUserTargetUserId: 'me',
      }),
      steps,
      { nowMs: NOW, selfUserId: 'me' },
    );
    expect(mine.badge).toBe('attention');
    expect(mine.text.length).toBeLessThanOrEqual(70);

    const theirs = runStageText(
      run({ status: 'awaiting_user_input', askUserTargetUserId: 'other' }),
      steps,
      { nowMs: NOW, selfUserId: 'me', targetUserName: '阿明' },
    );
    expect(theirs.text).toContain('阿明');
    expect(theirs.badge).toBeUndefined();
  });

  it('completed → 产物截断 + 点我看全文;无产物给兜底', () => {
    const t = runStageText(
      run({
        status: 'completed',
        artifact: { finalContent: '结'.repeat(200), refs: [], model: { providerId: 'p', modelId: 'm' }, producedAt: 'x' },
      }),
      steps,
      { nowMs: NOW },
    );
    expect(t.text.length).toBeLessThanOrEqual(140);
    expect(t.text).toContain('点我');
    const empty = runStageText(run({ status: 'completed', artifact: null }), steps, { nowMs: NOW });
    expect(empty.text.length).toBeGreaterThan(0);
  });

  it('failed/cancelled/budget_exhausted → error/muted 语气', () => {
    expect(runStageText(run({ status: 'failed' }), steps, { nowMs: NOW }).tone).toBe('error');
    expect(runStageText(run({ status: 'cancelled' }), steps, { nowMs: NOW }).tone).toBe('muted');
    expect(
      runStageText(run({ status: 'budget_exhausted' }), steps, { nowMs: NOW }).text,
    ).toContain('预算');
  });
});

import { describe, expect, it } from 'vitest';
import { runForClient } from '../agent.js';
import type { AgentRun, AgentCheckpoint } from '../../lib/agent/types.js';

/**
 * S2：给客户端的 run 序列化剥掉内部 contextCheckpoint（避免每次轮询下发数 KB
 * 累积状态 / 不泄漏内部 compaction 状态）。
 */
describe('runForClient', () => {
  it('strips contextCheckpoint, keeps everything else', () => {
    const cp: AgentCheckpoint = {
      version: 1,
      goal: 'g',
      intent: 'i',
      completed: [],
      remainingPlan: [],
      openQuestions: [],
      nextStep: '',
      successCount: 0,
      producedAtIdx: 0,
      digestTail: 'x'.repeat(5000),
    };
    const run = { id: 'r', status: 'completed', inputText: 'hi', contextCheckpoint: cp } as unknown as AgentRun;
    const out = runForClient(run);
    expect('contextCheckpoint' in out).toBe(false);
    expect(out.id).toBe('r');
    expect(out.inputText).toBe('hi');
  });
});

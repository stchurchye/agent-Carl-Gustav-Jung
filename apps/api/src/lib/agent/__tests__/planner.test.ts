import { describe, expect, it } from 'vitest';
import { generatePlanForEcho } from '../planner.js';

describe('planner (echo-only, M1a)', () => {
  it('parses "三步 echo" into 3 echo steps', () => {
    const plan = generatePlanForEcho('帮我跑三步 echo');
    expect(plan.steps.length).toBe(3);
    expect(plan.steps.every((s) => s.toolName === 'echo_after_sleep')).toBe(true);
    expect(plan.todos.length).toBe(3);
  });

  it('parses "5 步" into 5 steps', () => {
    const plan = generatePlanForEcho('跑 5 步 echo');
    expect(plan.steps.length).toBe(5);
  });

  it('defaults to 1 step when no number found', () => {
    const plan = generatePlanForEcho('echo 一下');
    expect(plan.steps.length).toBe(1);
  });

  it('produces a final reply hint', () => {
    const plan = generatePlanForEcho('两步 echo');
    expect(plan.finalReplyHint.length).toBeGreaterThan(0);
  });

  it('returns 1 step (not zero) for minimal request', () => {
    const plan = generatePlanForEcho('echo');
    expect(plan.steps.length).toBe(1);
  });

  it('caps steps at 10', () => {
    const plan = generatePlanForEcho('跑 100 步 echo');
    expect(plan.steps.length).toBeLessThanOrEqual(10);
  });
});

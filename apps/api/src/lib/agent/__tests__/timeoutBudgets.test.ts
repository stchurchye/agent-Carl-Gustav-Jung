import { describe, it, expect } from 'vitest';
import {
  TOOL_TIMEOUT_MS,
  HIGH_COST_TOOL_TIMEOUT_MS,
  SUBAGENT_MAX_SECONDS,
} from '../runtimeShared.js';
import { DEFAULT_BUDGET } from '../types.js';

// 超时/预算的嵌套不变量。本次 bug 的根因是父子超时常量「漂移失配」
// (子 run 给 120s,父工具/轮询给 5~6min → 子研究员被过早 budget-exhausted)。
// 锁住嵌套关系,防将来任一常量改动后再次失配。

describe('timeout/budget nesting invariants', () => {
  it('子 run 预算 < high-cost 工具超时(父能等到子跑完)', () => {
    expect(SUBAGENT_MAX_SECONDS * 1000).toBeLessThan(HIGH_COST_TOOL_TIMEOUT_MS);
  });

  it('普通工具超时 <= high-cost 工具超时', () => {
    expect(TOOL_TIMEOUT_MS).toBeLessThanOrEqual(HIGH_COST_TOOL_TIMEOUT_MS);
  });

  it('run 总预算 > 子 run 预算(一个 run 至少能容纳一个子 agent 跑完)', () => {
    expect(DEFAULT_BUDGET.maxSeconds).toBeGreaterThan(SUBAGENT_MAX_SECONDS);
  });

  it('放宽后的具体值(防误回退)', () => {
    expect(TOOL_TIMEOUT_MS).toBe(120_000);
    expect(SUBAGENT_MAX_SECONDS).toBe(300);
    expect(DEFAULT_BUDGET.maxSeconds).toBe(1200);
  });
});

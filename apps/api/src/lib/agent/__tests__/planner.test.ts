import { beforeAll, describe, expect, it } from 'vitest';
import {
  _buildPlannerSystemPromptForTest,
  _buildPlannerUserPromptForTest,
  generatePlanForEcho,
} from '../planner.js';
import { toolRegistry } from '../toolRegistry.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { registerWebSearch } from '../tools/webSearch.js';
import { registerUrlFetch } from '../tools/urlFetch.js';
import { registerDocExportMarkdown } from '../tools/docExportMarkdown.js';
import { registerMagiSystemRead } from '../tools/magiSystemRead.js';
import { registerMagiContentIngest } from '../tools/magiContentIngest.js';

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

describe('M1f planner prompt 升级 (#1)', () => {
  beforeAll(() => {
    registerEchoSleep();
    registerWebSearch();
    registerUrlFetch();
    registerDocExportMarkdown();
    registerMagiSystemRead();
    registerMagiContentIngest();
  });

  it('system prompt 含失败处理约定（ok=false / replan / 跳过工具）', () => {
    const sys = _buildPlannerSystemPromptForTest(toolRegistry.list());
    expect(sys).toMatch(/ok=false/);
    expect(sys).toMatch(/失败处理/);
    expect(sys).toMatch(/换参数重试|备选|跳过/);
  });

  it('system prompt 把每个 tool 的 replyMeta.failureHint 渲染出来', () => {
    const sys = _buildPlannerSystemPromptForTest(toolRegistry.list());
    expect(sys).toMatch(/限流|网络故障/);
  });

  it('user prompt 在传 previousFailure 时包含失败原因 + 重新规划指示', () => {
    const usr = _buildPlannerUserPromptForTest({
      inputText: '继续',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      previousFailure: 'web_search HTTP 429',
    });
    expect(usr).toMatch(/上一步失败原因/);
    expect(usr).toMatch(/web_search HTTP 429/);
    expect(usr).toMatch(/重新规划/);
  });
});

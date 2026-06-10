import { beforeEach, describe, expect, it } from 'vitest';
import { _buildPlannerSystemPromptForTest } from '../planner.js';
import { buildReplyMessages } from '../replyGen.js';
import { toolRegistry } from '../toolRegistry.js';
import { registerWebSearch } from '../tools/webSearch.js';
import type { AgentRun, Plan } from '../types.js';

/**
 * R1(owner 要求,2026-06-10):检索阶段中英双语都搜(外文文献往往更全),
 * 只在最后分析/回复层汉化。
 * - planner system prompt:研究/事实类任务要求同主题出中文+英文两路查询词
 * - reply system prompt:外文来源转述为中文,专有名词/论文标题可留原文
 */

beforeEach(() => {
  registerWebSearch();
});

describe('R1:双语检索指引', () => {
  it('planner system prompt 含「中英双语查询」战法', () => {
    const prompt = _buildPlannerSystemPromptForTest(toolRegistry.list());
    expect(prompt).toContain('英文');
    expect(prompt).toMatch(/中文.*英文|英文.*中文/);
    expect(prompt).toContain('查询');
  });

  it('reply system prompt 含「外文来源汉化转述」指引(终稿仍中文)', () => {
    const run = {
      contextCheckpoint: null,
      todos: [],
      inputText: 'x',
    } as unknown as AgentRun;
    const plan: Plan = {
      intentSummary: 'x',
      steps: [],
      todos: [],
      finalReplyHint: '',
      reasoning: null,
      version: 1,
    };
    const messages = buildReplyMessages({ run, plan, steps: [] });
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    expect(sys).toContain('中文'); // 终稿语言不变
    expect(sys).toMatch(/外文|英文/); // 外文来源的转述指引
    expect(sys).toContain('原文'); // 专有名词/标题可留原文
  });
});

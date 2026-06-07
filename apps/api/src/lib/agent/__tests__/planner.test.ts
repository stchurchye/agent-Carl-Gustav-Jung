import { beforeAll, describe, expect, it } from 'vitest';
import {
  _buildPlannerSystemPromptForTest,
  _buildPlannerUserPromptForTest,
  generatePlanForEcho,
  parsePlannerJson,
} from '../planner.js';
import { toolRegistry } from '../toolRegistry.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { registerWebSearch } from '../tools/webSearch.js';
import { registerFetchUrl } from '../tools/fetchUrl.js';
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
    registerFetchUrl();
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

  it('system prompt 把每个 tool 的 replyMeta.failureHint 都渲染出来', () => {
    const sys = _buildPlannerSystemPromptForTest(toolRegistry.list());
    const toolsWithHint = toolRegistry.list().filter((t) => t.replyMeta?.failureHint);
    expect(toolsWithHint.length).toBeGreaterThanOrEqual(4); // 至少 webSearch/urlFetch/magi*/docExport
    for (const t of toolsWithHint) {
      expect(sys).toContain(t.replyMeta!.failureHint!);
    }
  });

  it('system prompt 不会因为某些 tool 缺 failureHint 而出现 "undefined" 串', () => {
    const sys = _buildPlannerSystemPromptForTest(toolRegistry.list());
    expect(sys).not.toMatch(/失败常见原因：undefined/);
    expect(sys).not.toMatch(/undefined/);
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

  it('user prompt 渲染 checkpoint 的结构化任务状态 + nextStep + 不要问是否继续 (S3 sd0x)', () => {
    const usr = _buildPlannerUserPromptForTest({
      inputText: '研究 Sutton',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      checkpoint: {
        version: 1,
        goal: '研究 Sutton 的贡献',
        intent: '搜索并读权威来源',
        completed: [{ text: 'search_web', finding: '找到 NSF 官方页', refs: [] }],
        remainingPlan: ['读取并汇总'],
        openQuestions: [],
        nextStep: '抓取 NSF 页并汇总三要素',
        successCount: 1,
        producedAtIdx: 2,
        digestTail: '',
      },
    });
    expect(usr).toMatch(/任务状态/);
    expect(usr).toMatch(/找到 NSF 官方页/); // 累积发现
    expect(usr).toMatch(/读取并汇总/); // remainingPlan
    expect(usr).toMatch(/抓取 NSF 页并汇总三要素/); // nextStep
    expect(usr).toMatch(/不要问.*继续|不要问是否继续/); // sd0x：别问"是否继续"
  });

  it('checkpoint 渲染封顶（长 run 不撑爆 planner prompt）', () => {
    const many = Array.from({ length: 35 }, (_, i) => ({
      text: `tool${i}`,
      finding: `finding-${i}`,
      refs: [],
    }));
    const usr = _buildPlannerUserPromptForTest({
      inputText: 'x',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      checkpoint: {
        version: 1, goal: 'g', intent: 'i', completed: many,
        remainingPlan: [], openQuestions: [], nextStep: '', successCount: 35, producedAtIdx: 40, digestTail: '',
      },
    });
    expect(usr).toMatch(/更早 \d+ 条已略/); // 有 overflow 提示
    expect(usr).not.toContain('finding-0'); // 最早的被略掉
    expect(usr).toContain('finding-34'); // 最近的保留
  });

  it('checkpoint 渲染受字节预算约束（富 finding 长 run 不撑爆 planner prompt）', () => {
    // 20 条 × 每条 2000 字 = ~40K 字；即便条数 ≤20，也必须按字节收口
    const many = Array.from({ length: 20 }, (_, i) => ({
      text: `tool${i}`,
      finding: `MARK${i}-` + 'y'.repeat(2000),
      refs: [],
    }));
    const usr = _buildPlannerUserPromptForTest({
      inputText: 'x',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      checkpoint: {
        version: 1, goal: 'g', intent: 'i', completed: many,
        remainingPlan: [], openQuestions: [], nextStep: '', successCount: 20, producedAtIdx: 25, digestTail: '',
      },
    });
    expect(usr.length).toBeLessThan(14000); // 受字节预算约束，不是 40K
    expect(usr).toContain('MARK19-'); // 最近的保留（planner 偏好近期）
    expect(usr).toMatch(/更早 \d+ 条已略/); // 早期被略
  });

  it('planner prompt 含 digestTail 近窗逐字（修 digestTail→planner 断链）', () => {
    const usr = _buildPlannerUserPromptForTest({
      inputText: 'x',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      checkpoint: {
        version: 1, goal: 'g', intent: 'i',
        completed: [{ text: 'fetch_url', finding: '只是摘要版', refs: [] }],
        remainingPlan: [], openQuestions: [], nextStep: '',
        successCount: 1, producedAtIdx: 5,
        digestTail: '- [步骤 5] fetch_url: {"result":{"ok":true,"NEARWINDOW_MARKER":"逐字原文细节"}}',
      },
    });
    expect(usr).toContain('NEARWINDOW_MARKER'); // 近窗逐字真进了 planner（之前只进 reply）
    expect(usr).toContain('[步骤 5]'); // idx 标注可见 → 模型可据此 recall_step
  });

  it('planner 渲染 digestTail 限字节（巨型近窗不撑爆 planner prompt）', () => {
    const huge = '- [步骤 1] fetch_url: ' + 'Z'.repeat(40000);
    const usr = _buildPlannerUserPromptForTest({
      inputText: 'x',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      checkpoint: {
        version: 1, goal: 'g', intent: 'i',
        completed: [{ text: 't', finding: 'f', refs: [] }],
        remainingPlan: [], openQuestions: [], nextStep: '',
        successCount: 1, producedAtIdx: 1, digestTail: huge,
      },
    });
    expect(usr.length).toBeLessThan(20000); // digestTail 段被收口，不是 40K
  });

  it('checkpoint 渲染为空时退回 progress 兜底（review #5）', () => {
    const usr = _buildPlannerUserPromptForTest({
      inputText: 'x',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      // 全空 checkpoint（渲染成 ''）但有 progress 兜底字符串
      checkpoint: {
        version: 1, goal: 'g', intent: 'i', completed: [],
        remainingPlan: [], openQuestions: [], nextStep: '', successCount: 0, producedAtIdx: 0, digestTail: '',
      },
      progress: 'PROGRESS-FALLBACK-MARKER',
    });
    expect(usr).toContain('PROGRESS-FALLBACK-MARKER'); // 不再被 checkpoint 空串短路掉
  });

  it('全空 checkpoint（无发现无待办）不渲染"自动续跑中"框架', () => {
    const usr = _buildPlannerUserPromptForTest({
      inputText: 'x',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      checkpoint: {
        version: 1, goal: 'g', intent: 'i', completed: [],
        remainingPlan: [], openQuestions: [], nextStep: '', successCount: 0, producedAtIdx: 0, digestTail: '',
      },
    });
    expect(usr).not.toMatch(/任务状态|不要问/);
  });
});

describe('M1f parsePlannerJson 宽容化 (#4)', () => {
  beforeAll(() => {
    registerEchoSleep();
    registerWebSearch();
    registerFetchUrl();
    registerDocExportMarkdown();
    registerMagiSystemRead();
    registerMagiContentIngest();
  });

  const validBody = `{
  "intentSummary": "test",
  "steps": [{"toolName":"echo_after_sleep","input":{"text":"hi"},"reason":"x","todoId":"t1"}],
  "todos": [{"id":"t1","text":"t","status":"pending","stepRefs":[]}],
  "finalReplyHint": "done"
}`;

  const trailingCommaBody = `{
  "intentSummary": "test",
  "steps": [{"toolName":"echo_after_sleep","input":{"text":"hi"},"reason":"x","todoId":"t1"},],
  "todos": [{"id":"t1","text":"t","status":"pending","stepRefs":[]},],
  "finalReplyHint": "done",
}`;

  const braceInStringBody = `{
  "intentSummary": "what about } in strings?",
  "steps": [{"toolName":"echo_after_sleep","input":{"text":"hi"},"reason":"x","todoId":"t1"}],
  "todos": [{"id":"t1","text":"t","status":"pending","stepRefs":[]}],
  "finalReplyHint": "done"
}`;

  const cases: Array<{ name: string; raw: string; expectedIntent?: string }> = [
    { name: 'fenced ```json block', raw: '```json\n' + validBody + '\n```' },
    { name: 'fenced ``` block (no language)', raw: '```\n' + validBody + '\n```' },
    { name: 'leading prose then JSON', raw: "Here's the plan:\n" + validBody },
    { name: 'trailing prose after JSON', raw: validBody + '\n\nLet me know if you need more.' },
    { name: 'trailing comma in steps[] / todos[] / object', raw: trailingCommaBody },
    { name: 'CRLF line endings', raw: validBody.replace(/\n/g, '\r\n') },
    {
      name: 'brace `}` inside string literal',
      raw: braceInStringBody,
      expectedIntent: 'what about } in strings?',
    },
  ];

  it.each(cases)('parses dirty input: $name', ({ raw, expectedIntent }) => {
    const tools = toolRegistry.list();
    const plan = parsePlannerJson(raw, tools);
    expect(plan).not.toBeNull();
    expect(plan?.intentSummary).toBe(expectedIntent ?? 'test');
  });

  it('still returns null on pure garbage', () => {
    const tools = toolRegistry.list();
    expect(parsePlannerJson('hello world this is not json', tools)).toBeNull();
  });

  // M1f polish #2：原 regex `,(\s*[}\]])` 不区分字符串字面量，会把 `"foo,]"` 这种
  // 正常 string 误伤。现走字符串状态机，只剪结构性尾逗号。
  it('M1f polish #2: does not strip commas inside string literals', () => {
    const tools = toolRegistry.list();
    const raw = `{
  "intentSummary": "find foo,] inside a string",
  "steps": [{"toolName":"echo_after_sleep","input":{"text":"a,] b,} c"},"reason":"r","todoId":"t1"}],
  "todos": [{"id":"t1","text":"hint contains ,} too","status":"pending","stepRefs":[]}],
  "finalReplyHint": "done"
}`;
    const plan = parsePlannerJson(raw, tools);
    expect(plan).not.toBeNull();
    expect(plan?.intentSummary).toBe('find foo,] inside a string');
    expect((plan?.steps[0].input as { text?: string }).text).toBe('a,] b,} c');
    expect(plan?.todos[0].text).toBe('hint contains ,} too');

    // 字符串内有 ",]" 的同时，结构性尾逗号仍要被清掉
    const raw2 = raw.replace(
      '"finalReplyHint": "done"',
      '"finalReplyHint": "done",',
    );
    const plan2 = parsePlannerJson(raw2, tools);
    expect(plan2).not.toBeNull();
    expect(plan2?.intentSummary).toBe('find foo,] inside a string');
    expect(plan2?.finalReplyHint).toBe('done');
  });
});

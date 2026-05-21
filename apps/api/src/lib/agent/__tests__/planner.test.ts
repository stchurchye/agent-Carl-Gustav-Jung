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
});

describe('M1f parsePlannerJson 宽容化 (#4)', () => {
  beforeAll(() => {
    registerEchoSleep();
    registerWebSearch();
    registerUrlFetch();
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

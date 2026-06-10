import { describe, expect, it } from 'vitest';
import { buildCheckpoint } from '../checkpoint.js';
import { buildProgressSummary } from '../runPlanGlue.js';
import { webSearchTool } from '../tools/webSearch.js';
import type { AgentStep, TodoItem } from '../types.js';
import type { ToolDef } from '../toolRegistry.js';

/**
 * R2-1/R2-2(大脑长期视野):搜索步的 checkpoint finding 此前只存 top-5 标题 ——
 * 无 URL(无法回头深读)、无 snippet(重规划时只能看见"搜过什么"看不见"搜到什么")。
 * progress 摘要同病:200 字 JSON 截断,搜索结果碎在中间。
 * 改为结构化:title — url + snippet 摘录。digestTail(近窗)已有全文,不动。
 */

const HITS = [
  { title: 'A 文', url: 'https://a.example/1', snippet: '阴影是被压抑的自我面向,整合需要……', score: 0.9 },
  { title: 'B 文', url: 'https://b.example/2', snippet: '荣格认为共时性是非因果的有意义巧合', score: 0.8 },
];

function searchStep(idx: number): AgentStep {
  return {
    id: `s${idx}`, runId: 'r', idx, kind: 'tool_call', toolName: 'search_web',
    toolCallKey: null, input: { query: 'q' },
    output: { result: { ok: true, quality: 'ok', results: HITS } },
    tokens: 0, durationMs: 0, error: null, byUserId: null, createdAt: new Date(),
  };
}

const toolMap = new Map<string, ToolDef>([['search_web', webSearchTool as ToolDef]]);
const todos: TodoItem[] = [];

describe('R2-1:搜索步 finding 结构化(title+url+snippet)', () => {
  it('finding 含每条结果的 title、url 与 snippet 摘录,不再只有标题', () => {
    const cp = buildCheckpoint(null, [searchStep(1)], todos, {
      goal: 'g', intent: 'i', successCount: 1, toolMap,
    });
    const f = cp.completed[0].finding;
    expect(f).toContain('A 文');
    expect(f).toContain('https://a.example/1'); // url:重规划时可直接安排 fetch_url 深读
    expect(f).toContain('阴影是被压抑的自我面向'); // snippet:看得见"搜到什么"
    expect(f).toContain('https://b.example/2');
  });

  it('quality 警示(low_relevance 的 note)进 finding,重规划不会误信垃圾结果', () => {
    const step = searchStep(1);
    (step.output as { result: Record<string, unknown> }).result = {
      ok: true, quality: 'low_relevance',
      note: '结果相关度极低,不要采信',
      results: HITS,
    };
    const cp = buildCheckpoint(null, [step], todos, {
      goal: 'g', intent: 'i', successCount: 1, toolMap,
    });
    expect(cp.completed[0].finding).toContain('不要采信');
  });
});

describe('R2-2:progress 摘要的搜索步行结构化', () => {
  it('搜索步进展行含 title+url,而非 200 字 JSON 截断', () => {
    const summary = buildProgressSummary([searchStep(1)], [
      { id: 't1', text: '搜资料', status: 'completed', stepRefs: [] },
    ]) ?? '';
    expect(summary).toContain('A 文');
    expect(summary).toContain('https://a.example/1');
    expect(summary).not.toMatch(/\{"ok":true,"quality.{0,180}$/m); // 不再是截断的原始 JSON
  });
});

describe('R-review:buildListFinding 边界', () => {
  it('title 与摘录都缺的条目不占槽位', async () => {
    const { buildListFinding } = await import('../checkpoint.js');
    const out = buildListFinding({
      ok: true,
      results: [
        { url: 'https://bare.example', year: 2020 }, // 无 title 无 snippet → 滤
        { title: '有内容', url: 'https://x.example', snippet: 's' },
      ],
    });
    expect(out).not.toContain('[无标题]');
    expect(out).toContain('有内容');
  });

  it('结果超 5 条 → 标注「共 N 条,以下前 5」防大脑误以为只有 5 条', async () => {
    const { buildListFinding } = await import('../checkpoint.js');
    const results = Array.from({ length: 8 }, (_, i) => ({
      title: `T${i}`, url: `https://e/${i}`, snippet: 's',
    }));
    const out = buildListFinding({ ok: true, results })!;
    expect(out).toMatch(/共 8 条/);
  });
});

import { describe, expect, it } from 'vitest';
import { webSearchTool } from '../tools/webSearch.js';
import { searchPapersTool, getPaperCitationsTool } from '../tools/searchPapers.js';
import { wikipediaTool } from '../tools/wikipedia.js';
import { collectReplyRefs } from '../replyGen.js';
import { buildCheckpoint } from '../checkpoint.js';
import { buildRunSummary } from '../runSummary.js';
import type { AgentStep, TodoItem } from '../types.js';
import type { ToolDef } from '../toolRegistry.js';

/**
 * P0-S7:引用链打通。search 类工具此前无 extractRef → 搜索 URL 完全进不了
 * 终稿 ref 清单(replyGen.ts collectReplyRefs 对无 extractRef 工具硬跳过)。
 * 本切片:ToolReplyMeta 增 extractRefs(复数)+ 四个搜索工具实现 + checkpoint
 * 去重修正(防搜索 ref 吞掉同 URL 深读 finding)+ runSummary refCount 并集。
 */

function step(
  idx: number,
  toolName: string,
  output: unknown,
  kind: AgentStep['kind'] = 'tool_call',
): AgentStep {
  return {
    id: `s${idx}`,
    runId: 'r',
    idx,
    kind,
    toolName,
    toolCallKey: null,
    input: null,
    output: { result: output },
    tokens: 0,
    durationMs: 0,
    error: null,
    byUserId: null,
    createdAt: new Date(),
  };
}

const HITS = [
  { title: 'A 文', url: 'https://a.example/1', snippet: 's1' },
  { title: 'B 文', url: 'https://b.example/2', snippet: 's2' },
  { title: 'C 文', url: 'https://c.example/3', snippet: 's3' },
  { title: 'D 文', url: 'https://d.example/4', snippet: 's4' },
  { title: 'E 文', url: 'https://e.example/5', snippet: 's5' },
];

describe('P0-S7:搜索工具 extractRefs', () => {
  it('search_web:5 hits 只产 top-3 url ref(防 ref 洪水),label=title', () => {
    const refs = webSearchTool.replyMeta!.extractRefs!({ ok: true, results: HITS });
    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({ kind: 'url', id: 'https://a.example/1', label: 'A 文' });
  });

  it('search_papers:papers→top-3 url ref;get_paper_citations:citations 同理', () => {
    const papers = [
      { title: 'P1', url: 'https://doi.org/10.1/x', doi: '10.1/x' },
      { title: 'P2', url: 'https://openalex.org/W2' },
    ];
    expect(searchPapersTool.replyMeta!.extractRefs!({ ok: true, papers })).toEqual([
      { kind: 'url', id: 'https://doi.org/10.1/x', label: 'P1' },
      { kind: 'url', id: 'https://openalex.org/W2', label: 'P2' },
    ]);
    expect(
      getPaperCitationsTool.replyMeta!.extractRefs!({ ok: true, citations: papers }),
    ).toHaveLength(2);
  });

  it('wikipedia:沿用既有单数 extractRef(本切片不重复实现)', () => {
    const ref = wikipediaTool.replyMeta!.extractRef!({
      ok: true,
      title: '荣格',
      url: 'https://zh.wikipedia.org/wiki/荣格',
    });
    expect(ref).toEqual({
      kind: 'url',
      id: 'https://zh.wikipedia.org/wiki/荣格',
      label: 'Wikipedia: 荣格',
    });
  });

  it('空 url 的 hit 不产 ref', () => {
    const refs = webSearchTool.replyMeta!.extractRefs!({
      ok: true,
      results: [{ title: 'X', url: '', snippet: '' }],
    });
    expect(refs).toEqual([]);
  });
});

describe('P0-S7:collectReplyRefs 消费 extractRefs(复数)', () => {
  const toolMap = new Map<string, ToolDef>([
    ['search_web', webSearchTool as ToolDef],
    ['wikipedia', wikipediaTool as ToolDef],
  ]);

  it('搜索 step 的 URL 进 ref 清单,且与单数 extractRef 工具共存、按 kind:id 去重', () => {
    const steps = [
      step(1, 'search_web', { ok: true, results: HITS.slice(0, 2) }),
      // 同 URL 再次出现(另一工具) → 去重
      step(2, 'wikipedia', { ok: true, title: 'A 文', url: 'https://a.example/1' }),
    ];
    const refs = collectReplyRefs(steps, toolMap);
    expect(refs.map((r) => r.id)).toEqual(['https://a.example/1', 'https://b.example/2']);
  });

  it('ok:false 的搜索输出不产 ref(失败观察不是资源)', () => {
    const steps = [step(1, 'search_web', { ok: false, results: HITS })];
    expect(collectReplyRefs(steps, toolMap)).toEqual([]);
  });
});

describe('P0-S7:checkpoint 去重修正 —— 搜索 ref 不吞同 URL 深读 finding', () => {
  it('search_web 产 url A,B,C 后,fetch_url 深读 A 的 finding 仍保留', async () => {
    const { fetchUrlTool } = await import('../tools/fetchUrl.js');
    const toolMap = new Map<string, ToolDef>([
      ['search_web', webSearchTool as ToolDef],
      ['fetch_url', fetchUrlTool as ToolDef],
    ]);
    const todos: TodoItem[] = [];
    const searchStep = step(1, 'search_web', { ok: true, results: HITS.slice(0, 3) });
    const fetchStep = step(2, 'fetch_url', {
      ok: true,
      url: 'https://a.example/1',
      title: 'A 文',
      content: '深读正文……',
    });
    const cp = buildCheckpoint(null, [searchStep, fetchStep], todos, {
      goal: 'g',
      intent: 'i',
      successCount: 2,
      toolMap,
    });
    const texts = cp.completed.map((f) => f.text);
    expect(texts).toContain('search_web');
    expect(texts).toContain('fetch_url'); // 修正前:fetch 的 ref(url A)全部已见 → 整条被吞
  });
});

describe('P0-S7:runSummary refCount 含搜索 url ref', () => {
  it('search_web 2 hits + deep_research 1 citation → refCount=3', () => {
    const toolMap = new Map<string, ToolDef>([['search_web', webSearchTool as ToolDef]]);
    const steps = [
      step(1, 'search_web', { ok: true, results: HITS.slice(0, 2) }),
      step(2, 'deep_research', {
        ok: true,
        report: 'r',
        citations: [{ kind: 'url', id: 'https://x.example' }],
      }),
    ];
    const summary = buildRunSummary(steps, toolMap);
    expect(summary.refCount).toBe(3);
  });
});

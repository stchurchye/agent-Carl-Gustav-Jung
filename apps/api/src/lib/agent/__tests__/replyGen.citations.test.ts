import { beforeEach, describe, expect, it } from 'vitest';
import { buildReplyMessages, filterCitedRefs } from '../replyGen.js';
import { registerWebSearch } from '../tools/webSearch.js';
import type { AgentRun, Plan, ReplyRef } from '../types.js';

beforeEach(() => {
  registerWebSearch(); // buildReplyMessages 默认 toolMap 取注册表,extractRefs 需要它
});

/**
 * R4-1/R4-2:终稿 [n] 引用标记。
 * - 终稿 prompt:资源清单带稳定序号 [1][2]…,REPLY_SYSTEM 指示「关键论断后标 [n]」
 * - 收尾过滤:url 类资源只保留正文真引用的;产物类(document/diagram/magi_card)永远保留;
 *   无 [n] 标记或序号越界(对齐失效)→ fail-open 全保留。
 */

const REFS: ReplyRef[] = [
  { kind: 'url', id: 'https://a.example', label: 'A 文' },
  { kind: 'url', id: 'https://b.example', label: 'B 文' },
  { kind: 'document', id: 'doc-1', label: '导出的报告' },
  { kind: 'url', id: 'https://c.example', label: 'C 文' },
];

describe('R4-1:终稿 prompt 序号化引用', () => {
  it('REPLY_SYSTEM 含 [n] 引用指示;资源清单带 [1][2] 序号', () => {
    const run = { contextCheckpoint: null, todos: [], inputText: 'x', mergedInputs: [] } as unknown as AgentRun;
    const plan: Plan = { intentSummary: 'x', steps: [], todos: [], finalReplyHint: '', reasoning: null, version: 1 };
    const steps = [
      {
        id: 's1', runId: 'r', idx: 1, kind: 'tool_call', toolName: 'search_web',
        toolCallKey: null, input: null,
        output: { result: { ok: true, results: [{ title: 'A 文', url: 'https://a.example', snippet: 's' }] } },
        tokens: 0, durationMs: 0, error: null, byUserId: null, createdAt: new Date(),
      } as never,
    ];
    const messages = buildReplyMessages({ run, plan, steps });
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(sys).toMatch(/\[n\]|\[1\]/); // 引用指示
    expect(user).toContain('[1]'); // 清单序号
    expect(user).toContain('https://a.example');
  });
});

describe('R4-2:filterCitedRefs', () => {
  it('正文引用 [1][3] → url 类只留 1、4 号中被引的;document 永远保留', () => {
    const content = '荣格认为……[1] 但当代研究有不同看法[4]。';
    const out = filterCitedRefs(content, REFS);
    expect(out.map((r) => r.id)).toEqual([
      'https://a.example', // [1] 被引
      'doc-1', // 产物类:无条件保留
      'https://c.example', // [4] 被引
    ]);
  });

  it('正文无 [n] 标记 → fail-open 全保留', () => {
    expect(filterCitedRefs('没有任何引用标记的回复。', REFS)).toHaveLength(4);
  });

  it('序号越界(对齐失效)→ fail-open 全保留', () => {
    expect(filterCitedRefs('引用 [9] 超出清单。', REFS)).toHaveLength(4);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../topicSkills.js', () => ({
  upsertSkill: vi.fn(),
  hasDistilledSkillForRun: vi.fn(),
}));

import { upsertSkill, hasDistilledSkillForRun } from '../topicSkills.js';
import type { LlmChatClient } from '../../llm/types.js';
import type { AgentStep } from '../types.js';
import { distillSkillFromRun } from '../skillDistill.js';

const upsert = vi.mocked(upsertSkill);
const hasDistilled = vi.mocked(hasDistilledSkillForRun);

const chat = vi.fn();
const llm = { providerId: 'deepseek', modelId: 'deepseek-v4-pro', chat } as unknown as LlmChatClient;
const signal = new AbortController().signal;

function step(
  kind: AgentStep['kind'],
  toolName: string | null,
  output: unknown,
  error: string | null = null,
): AgentStep {
  return {
    id: `s-${Math.random()}`,
    runId: 'run-1',
    idx: 0,
    kind,
    toolName,
    toolCallKey: null,
    input: null,
    output,
    tokens: 0,
    durationMs: 0,
    error, // 软失败:runExecute 记 tool_call 时把 softError 落到 step.error
    byUserId: null,
    createdAt: new Date(),
  };
}

/** 两次成功 tool_call —— 满足门控。 */
function multiToolSteps(): AgentStep[] {
  return [
    step('plan', null, { intentSummary: '查资料并整理成报告' }),
    step('tool_call', 'web_search', { ok: true, results: [] }),
    step('tool_call', 'fetch_url', { ok: true, text: '...' }),
  ];
}

function params(overrides?: Partial<Parameters<typeof distillSkillFromRun>[0]>) {
  return {
    ownerId: 'userA',
    runId: 'run-1',
    inputText: '帮我研究 X 并整理成报告',
    finalContent: '已整理完毕：……',
    steps: multiToolSteps(),
    llm,
    signal,
    ...overrides,
  };
}

const SKILL_JSON = JSON.stringify({
  skip: false,
  title: '研究并整理报告',
  content: '## 何时用\n需要调研并产出报告时\n## 步骤\n1. web_search\n2. fetch_url\n3. 汇总',
});

describe('distillSkillFromRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasDistilled.mockResolvedValue(false);
    upsert.mockResolvedValue({} as never);
  });

  it('distills a disabled auto_distilled user-scope skill on a multi-tool run', async () => {
    chat.mockResolvedValue({ content: SKILL_JSON });
    await distillSkillFromRun(params());
    expect(chat).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'user',
        ownerId: 'userA',
        groupId: null,
        topicId: null,
        title: '研究并整理报告',
        enabled: false,
        source: 'auto_distilled',
        sourceRunId: 'run-1',
        updatedByUserId: 'userA',
      }),
    );
  });

  it('writes nothing when the LLM returns {skip:true}', async () => {
    chat.mockResolvedValue({ content: JSON.stringify({ skip: true }) });
    await distillSkillFromRun(params());
    expect(upsert).not.toHaveBeenCalled();
  });

  it('gate: skips (no LLM, no write) when fewer than 2 successful tool_calls', async () => {
    const steps = [
      step('plan', null, { intentSummary: 's' }),
      step('tool_call', 'web_search', { ok: true }),
    ];
    await distillSkillFromRun(params({ steps }));
    expect(chat).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('gate: soft-failed tool_call (step.error 非空) does not count toward the threshold', async () => {
    // production:软失败的 tool_call 把 softError 落到 step.error(tool 的 ok 嵌在 output.result.ok)。
    const steps = [
      step('tool_call', 'web_search', { result: { ok: true } }),
      step('tool_call', 'fetch_url', { result: { ok: false } }, 'soft: 404'),
    ];
    await distillSkillFromRun(params({ steps }));
    expect(chat).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('idempotent: skips when this run already has a distilled skill', async () => {
    hasDistilled.mockResolvedValue(true);
    await distillSkillFromRun(params());
    expect(chat).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fail-open: LLM throws (non-abort) → no throw, no write', async () => {
    chat.mockRejectedValue(new Error('llm 503'));
    await expect(distillSkillFromRun(params())).resolves.toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fail-open: upsert throws (e.g. SkillValidationError) → no throw', async () => {
    chat.mockResolvedValue({ content: SKILL_JSON });
    upsert.mockRejectedValue(new Error('topic skill rejected: content:INJECT_SYSTEM_ROLE'));
    await expect(distillSkillFromRun(params())).resolves.toBeUndefined();
  });

  it('propagates cancellation when the distill LLM re-wraps abort (signal.aborted)', async () => {
    const ac = new AbortController();
    chat.mockImplementation(async () => {
      ac.abort();
      const e = new Error('已取消');
      e.name = 'LlmProviderError'; // provider 重包，非 AbortError
      throw e;
    });
    await expect(distillSkillFromRun(params({ signal: ac.signal }))).rejects.toThrow(/取消/);
  });
});

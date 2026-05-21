import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('../../integrations/magi.js', () => ({
  queryMagiSystem: vi.fn(async () => '本地知识库：暂无家族信托记录'),
  ingestMagiContent: vi.fn(async () => ({
    title: 'mock',
    summary: 'mock',
  })),
  magiSystemEnabled: vi.fn(() => true),
  magiContentEnabled: vi.fn(() => true),
}));

import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession, listDocuments } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { getAgentRun, listSteps, updateAgentRun } from '../store.js';
import { registerAgentTools } from '../registerAgentTools.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import type { Plan } from '../types.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

function researchPlan(): Plan {
  return {
    intentSummary: '研究家族信托并存档',
    steps: [
      {
        toolName: 'search_web',
        input: { query: '家族信托' },
        reason: '先搜公开资料',
        todoId: 't1',
      },
      {
        toolName: 'fetch_url',
        input: { url: 'https://example.com/trust' },
        reason: '深读首条结果',
        todoId: 't2',
      },
      {
        toolName: 'fetch_url',
        input: { url: 'https://example.com/trust' }, // ← 同 URL，应命中幂等
        reason: '重复请求',
        todoId: 't3',
      },
      {
        toolName: 'doc_export_markdown',
        input: { title: '家族信托研究 ' + randomUUID().slice(0, 6), markdown: '# v1' },
        reason: '写入文档',
        todoId: 't4',
      },
    ],
    todos: [
      { id: 't1', text: '搜', status: 'pending', stepRefs: [] },
      { id: 't2', text: '抓', status: 'pending', stepRefs: [] },
      { id: 't3', text: '重抓', status: 'pending', stepRefs: [] },
      { id: 't4', text: '存', status: 'pending', stepRefs: [] },
    ],
    finalReplyHint: '简明总结 + 文档标题',
    reasoning: null,
    version: 1,
  };
}

describe('agent runtime E2E: research + idempotency (M1c, T10)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerAgentTools();
    registerEchoSleep();
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('completes a 4-step research plan; same URL is cached via idempotency gate', async () => {
    const user = await ensureUser('research');
    const session = await createChatSession(user.id, 'research');

    vi.stubEnv('TAVILY_API_KEY', 'tk-test');
    let urlFetchCalls = 0;
    let tavilyCalls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : (input as URL).toString();
        if (url.includes('api.tavily.com')) {
          tavilyCalls += 1;
          return new Response(
            JSON.stringify({
              results: [
                {
                  title: '家族信托入门',
                  url: 'https://example.com/trust',
                  content: '基础概念……',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.includes('r.jina.ai') && url.includes('example.com/trust')) {
          urlFetchCalls += 1;
          return new Response(
            `Title: 家族信托详解\nURL Source: https://example.com/trust\n\n# 家族信托详解\n\n${'内容段。'.repeat(100)}`,
            { status: 200 },
          );
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: '帮我研究家族信托相关资料',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    // 直接覆盖 plan，跳过 planner（VITEST 下 planner 默认走 echo fallback）
    await updateAgentRun(run.id, {
      plan: researchPlan(),
      todos: researchPlan().todos,
      status: 'running',
    });

    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('completed');

    const steps = await listSteps(run.id);
    const toolCalls = steps.filter((s) => s.kind === 'tool_call');
    const observes = steps.filter((s) => s.kind === 'observe');

    // 4 个 plan step → 3 tool_call + 1 observe（第二个 url_fetch 同 URL 命中缓存）
    expect(toolCalls.length).toBe(3);
    expect(observes.length).toBe(1);
    expect(observes[0].toolName).toBe('fetch_url');

    // 真正发到外部的请求次数：tavily 1 次 + example.com 1 次（第二次命中缓存）
    expect(tavilyCalls).toBe(1);
    expect(urlFetchCalls).toBe(1);

    // 文档已落到 documents 表
    const docs = await listDocuments(user.id);
    expect(docs.some((d) => d.title.startsWith('家族信托研究'))).toBe(true);

    // reply 在最后
    expect(steps[steps.length - 1].kind).toBe('reply');
  });
});

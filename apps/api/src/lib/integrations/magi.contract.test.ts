import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * B8 跨 repo 契约测试。magi.ts 的 HTTP 函数在别处全被 mock,其与 MAGI
 * `/api/agent-memory/*` 的 JSON 请求/响应字段(snake_case ↔ camelCase)是手维护、易漂移。
 * 这里 mock global.fetch、喂**精确镜像 MAGI router 实际输出**的响应,校验:
 *   ① 响应解析(snake_case → camelCase 映射)② 请求体字段名(agent 发出的 snake_case)。
 * fixture 对应 MAGI backend/routers/agent_memory.py 的 write/search/list/promote 端点。
 * (端到端真连验证在部署后的 verify 步骤;此处是 commit 级契约钉子。)
 */

const ENV = {
  MAGI_SYSTEM_ENABLED: '1',
  MAGI_SYSTEM_URL: 'http://magi.test',
  MAGI_SYSTEM_TOKEN: 'tok',
};

function mockFetch(jsonBody: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => jsonBody,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function importMagi() {
  vi.resetModules();
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  return import('./magi.js');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('magi agent-memory HTTP contract', () => {
  beforeEach(() => vi.resetAllMocks());

  it('searchAgentMemory: parses MAGI /search hits (snake_case → camelCase)', async () => {
    const { searchAgentMemory } = await importMagi();
    const fetchFn = mockFetch({
      hits: [
        {
          id: 5,
          text: '用户在做编译器项目',
          source_run_id: 'r1',
          source_session_id: 's1',
          topic_id: 't1',
          created_at: '2026-06-07T00:00:00+00:00',
          score: 0.83,
        },
      ],
    });
    const hits = await searchAgentMemory('userA', '项目', 12, undefined, true);
    expect(hits).toEqual([
      {
        id: 5,
        text: '用户在做编译器项目',
        sourceRunId: 'r1',
        sourceSessionId: 's1',
        topicId: 't1',
        createdAt: '2026-06-07T00:00:00+00:00',
        score: 0.83,
      },
    ]);
    // 请求体契约:owner_id/query/top_k/include_pending(snake_case)
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({ owner_id: 'userA', query: '项目', top_k: 12, include_pending: true });
  });

  it('writeAgentMemory: request body carries M4 fields in snake_case', async () => {
    const { writeAgentMemory } = await importMagi();
    const fetchFn = mockFetch({ id: 42 });
    const r = await writeAgentMemory({
      ownerId: 'userA',
      text: '洞见',
      confidence: 0.9,
      status: 'approved',
      kind: 'insight',
      sentiment: 'positive',
      sourceFragmentIds: [1, 2],
    });
    expect(r).toEqual({ id: 42 });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({
      owner_id: 'userA',
      text: '洞见',
      status: 'approved',
      kind: 'insight',
      sentiment: 'positive',
      source_fragment_ids: [1, 2],
    });
  });

  it('listAgentMemory: parses MAGI /list items incl. M4 fields', async () => {
    const { listAgentMemory } = await importMagi();
    mockFetch({
      items: [
        {
          id: 7,
          text: '洞见',
          status: 'approved',
          confidence: 0.9,
          created_at: '2026-06-07T00:00:00+00:00',
          valid_until: null,
          source_run_id: 'r1',
          kind: 'insight',
          sentiment: 'positive',
          source_fragment_ids: [1, 2],
          promoted_at: null,
        },
      ],
    });
    const items = await listAgentMemory('userA', 'approved');
    expect(items[0]).toMatchObject({
      id: 7,
      kind: 'insight',
      sentiment: 'positive',
      sourceFragmentIds: [1, 2],
      promotedAt: null,
    });
  });

  it('promoteAgentMemory: parses MAGI /promote {promoted,text}', async () => {
    const { promoteAgentMemory } = await importMagi();
    const fetchFn = mockFetch({ promoted: true, text: '权威文本' });
    const r = await promoteAgentMemory('userA', 7);
    expect(r).toEqual({ promoted: true, text: '权威文本' });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({ owner_id: 'userA', id: 7 });
  });

  it('promoteAgentMemory: already-promoted → {promoted:false,text:null}', async () => {
    const { promoteAgentMemory } = await importMagi();
    mockFetch({ promoted: false, text: null });
    expect(await promoteAgentMemory('userA', 7)).toEqual({ promoted: false, text: null });
  });
});

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
    // K3 后 hit 有新增缺省字段(kind/sources/truth_*),旧契约改 toMatchObject(增量兼容)
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject(
      {
        id: 5,
        text: '用户在做编译器项目',
        sourceRunId: 'r1',
        sourceSessionId: 's1',
        topicId: 't1',
        createdAt: '2026-06-07T00:00:00+00:00',
        score: 0.83,
      },
    );
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

  it('unpromoteAgentMemory: parses MAGI /unpromote {unpromoted}', async () => {
    const { unpromoteAgentMemory } = await importMagi();
    const fetchFn = mockFetch({ unpromoted: 1 });
    expect(await unpromoteAgentMemory('userA', 7)).toEqual({ unpromoted: 1 });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({ owner_id: 'userA', id: 7 });
  });

  // ───────────── K3:finding/真伪轴/版本链 契约(镜像 MAGI K2 端点) ─────────────

  it('K3 writeAgentMemory: kind=finding + sources 序列化为 snake_case(run_id)', async () => {
    const { writeAgentMemory } = await importMagi();
    const fetchFn = mockFetch({ id: 11, status: 'approved' });
    await writeAgentMemory({
      ownerId: 'userA',
      text: '损失厌恶系数 λ≈2.25',
      confidence: 0.9,
      status: 'approved',
      kind: 'finding',
      sources: [{ url: 'https://doi.org/10.1/tk', title: 'Prospect Theory', year: 1992, runId: 'run-1' }],
    });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.kind).toBe('finding');
    expect(body.sources).toEqual([
      { url: 'https://doi.org/10.1/tk', title: 'Prospect Theory', year: 1992, run_id: 'run-1' },
    ]);
  });

  it('K3 searchAgentMemory: 解析 kind/sources/truth_* + 请求体携带 kinds', async () => {
    const { searchAgentMemory } = await importMagi();
    const fetchFn = mockFetch({
      hits: [
        {
          id: 9,
          text: '学习风格匹配能提升学习效果',
          source_run_id: 'r9',
          source_session_id: null,
          topic_id: null,
          created_at: '2026-06-10T00:00:00+00:00',
          kind: 'finding',
          sources: [{ url: 'https://x.com/p', title: 'P', year: 2008 }],
          truth_status: 'refuted',
          truth_note: '系统综述否定',
          counter_sources: [{ url: 'https://doi.org/10.1/pashler2008' }],
          score: 0.7,
        },
      ],
    });
    const hits = await searchAgentMemory('userA', '学习风格', 5, undefined, false, ['finding']);
    expect(hits[0]).toMatchObject({
      id: 9,
      kind: 'finding',
      sources: [{ url: 'https://x.com/p', title: 'P', year: 2008 }],
      truthStatus: 'refuted',
      truthNote: '系统综述否定',
      counterSources: [{ url: 'https://doi.org/10.1/pashler2008' }],
    });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.kinds).toEqual(['finding']);
  });

  it('K3 searchAgentMemory: 旧 MAGI 响应缺新字段 → 缺省兼容(fact/null/unverified)', async () => {
    const { searchAgentMemory } = await importMagi();
    mockFetch({
      hits: [
        { id: 5, text: '旧 fact', source_run_id: null, source_session_id: null, topic_id: null, created_at: null, score: 0.5 },
      ],
    });
    const hits = await searchAgentMemory('userA', 'x');
    expect(hits[0]).toMatchObject({
      kind: 'fact',
      sources: null,
      truthStatus: 'unverified',
      truthNote: null,
      counterSources: null,
    });
    // 不带 kinds 时请求体不应有 kinds 键(老 MAGI 收到未知键也无妨,但缺省干净)
  });

  it('K3 invalidateAgentMemory: supersededById 序列化 superseded_by_id', async () => {
    const { invalidateAgentMemory } = await importMagi();
    const fetchFn = mockFetch({ invalidated: 1 });
    await invalidateAgentMemory('userA', 3, undefined, 8);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({ owner_id: 'userA', id: 3, superseded_by_id: 8 });
  });

  it('K3 revalidateAgentMemory: 解析 {revalidated, status}', async () => {
    const { revalidateAgentMemory } = await importMagi();
    const fetchFn = mockFetch({ revalidated: 1, status: 'rejected' });
    const r = await revalidateAgentMemory('userA', 3);
    expect(r).toEqual({ revalidated: 1, status: 'rejected' });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({ owner_id: 'userA', id: 3 });
  });

  it('K3 markTruthAgentMemory: 序列化 truth_status/note/counter_sources', async () => {
    const { markTruthAgentMemory } = await importMagi();
    const fetchFn = mockFetch({ updated: 1 });
    await markTruthAgentMemory('userA', 3, 'disputed', {
      truthNote: '有矛盾研究',
      counterSources: [{ url: 'https://x.com/c', title: 'C' }],
    });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({
      owner_id: 'userA',
      id: 3,
      truth_status: 'disputed',
      truth_note: '有矛盾研究',
      counter_sources: [{ url: 'https://x.com/c', title: 'C' }],
    });
  });

  it('K3 listAgentMemory: 透传 sources/superseded_by_id/truth_*', async () => {
    const { listAgentMemory } = await importMagi();
    mockFetch({
      items: [
        {
          id: 7, text: 'f', status: 'approved', confidence: 0.9,
          created_at: null, valid_until: '2026-06-10T01:00:00+00:00', source_run_id: 'r1',
          kind: 'finding', sentiment: null, source_fragment_ids: null, promoted_at: null,
          sources: [{ url: 'https://x.com/a' }],
          superseded_by_id: 12,
          truth_status: 'disputed', truth_note: 'n', counter_sources: null,
        },
      ],
    });
    const items = await listAgentMemory('userA');
    expect(items[0]).toMatchObject({
      kind: 'finding',
      sources: [{ url: 'https://x.com/a' }],
      supersededById: 12,
      truthStatus: 'disputed',
      truthNote: 'n',
      counterSources: null,
    });
  });

});

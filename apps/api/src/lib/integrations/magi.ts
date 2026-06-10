const MAGI_SYSTEM_URL = process.env.MAGI_SYSTEM_URL?.trim();
const MAGI_CONTENT_URL = process.env.MAGI_CONTENT_URL?.trim();

export function magiContentEnabled(): boolean {
  return process.env.MAGI_CONTENT_ENABLED === '1' && Boolean(MAGI_CONTENT_URL);
}

export function magiSystemEnabled(): boolean {
  return process.env.MAGI_SYSTEM_ENABLED === '1' && Boolean(MAGI_SYSTEM_URL);
}

export async function queryMagiSystem(
  question: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!magiSystemEnabled()) {
    return 'MAGI 知识库未启用。请在服务端配置 MAGI_SYSTEM_ENABLED=1 与 MAGI_SYSTEM_URL。';
  }
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`magi-system HTTP ${res.status}`);
  }
  const json = (await res.json()) as { answer?: string; text?: string };
  return json.answer ?? json.text ?? '（无回复）';
}

/** K3:finding 出处条目(客户端 camelCase;wire 为 snake_case run_id)。 */
export type MemorySource = {
  url: string;
  title?: string;
  year?: number;
  kind?: string;
  runId?: string;
};

export type MemoryKind = 'fact' | 'insight' | 'finding';
export type TruthStatus = 'unverified' | 'disputed' | 'refuted';

type WireSource = { url: string; title?: string; year?: number; kind?: string; run_id?: string };

function toWireSource(s: MemorySource): WireSource {
  return {
    url: s.url,
    ...(s.title ? { title: s.title } : {}),
    ...(s.year ? { year: s.year } : {}),
    ...(s.kind ? { kind: s.kind } : {}),
    ...(s.runId ? { run_id: s.runId } : {}),
  };
}

function fromWireSources(raw: unknown): MemorySource[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((s): s is WireSource => !!s && typeof (s as WireSource).url === 'string')
    .map((s) => ({
      url: s.url,
      ...(s.title ? { title: s.title } : {}),
      ...(s.year ? { year: s.year } : {}),
      ...(s.kind ? { kind: s.kind } : {}),
      ...(s.run_id ? { runId: s.run_id } : {}),
    }));
}

export type MemoryHit = {
  id: number;
  text: string;
  sourceRunId: string | null;
  sourceSessionId: string | null;
  topicId: string | null;
  createdAt: string | null;
  score: number;
  /** K3:旧 MAGI 响应缺省 → 'fact'(向后兼容)。 */
  kind: MemoryKind;
  sources: MemorySource[] | null;
  /** K3:真伪轴。旧 MAGI 缺省 → 'unverified'。 */
  truthStatus: TruthStatus;
  truthNote: string | null;
  counterSources: MemorySource[] | null;
};

/**
 * Agent 长期记忆(情景/语义层)检索 —— 打 MAGI /api/agent-memory/search。
 * owner-scoped(ownerId 必传);未启用时返空(fail-open 由调用方/工具兜)。
 */
export async function searchAgentMemory(
  ownerId: string,
  query: string,
  topK = 12,
  signal?: AbortSignal,
  /** 洞D:reconcile 近邻搜置 true 也返回 pending(失效未审旧 fact);recall 默认 false。 */
  includePending = false,
  /** K3:可选 kind 过滤(prior_research 预取只要 finding)。省略 = 全 kind。 */
  kinds?: MemoryKind[],
): Promise<MemoryHit[]> {
  if (!magiSystemEnabled()) return [];
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({
      owner_id: ownerId,
      query,
      top_k: topK,
      include_pending: includePending,
      ...(kinds && kinds.length > 0 ? { kinds } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`agent-memory search HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    hits?: Array<{
      id: number;
      text: string;
      source_run_id?: string | null;
      source_session_id?: string | null;
      topic_id?: string | null;
      created_at?: string | null;
      score?: number;
      kind?: string;
      sources?: unknown;
      truth_status?: string;
      truth_note?: string | null;
      counter_sources?: unknown;
    }>;
  };
  return (json.hits ?? []).map((h) => ({
    id: h.id,
    text: h.text,
    sourceRunId: h.source_run_id ?? null,
    sourceSessionId: h.source_session_id ?? null,
    topicId: h.topic_id ?? null,
    createdAt: h.created_at ?? null,
    score: h.score ?? 0,
    kind: (h.kind ?? 'fact') as MemoryKind,
    sources: fromWireSources(h.sources),
    truthStatus: (h.truth_status ?? 'unverified') as TruthStatus,
    truthNote: h.truth_note ?? null,
    counterSources: fromWireSources(h.counter_sources),
  }));
}

export type WriteAgentMemoryParams = {
  ownerId: string;
  text: string;
  confidence?: number;
  status?: 'pending' | 'approved' | 'rejected';
  sourceRunId?: string | null;
  sourceSessionId?: string | null;
  topicId?: string | null;
  /** M4:fact|insight;K3 扩 finding(带出处的研究结论)。 */
  kind?: MemoryKind;
  /** M4:情感标签(distill 打);省略 → MAGI 存 NULL。 */
  sentiment?: 'positive' | 'negative' | 'neutral' | 'mixed';
  /** M4:insight 的 provenance(由哪些 fragment id 合成)。 */
  sourceFragmentIds?: number[];
  /** K3:finding 出处清单(MAGI 侧仅 kind='finding' 接受,≤20 条)。 */
  sources?: MemorySource[];
};

/**
 * Agent 长期记忆写入 —— 打 MAGI /api/agent-memory/write。owner-scoped。
 * 未启用时抛(由调用方 fail-open 兜)。
 */
export async function writeAgentMemory(
  params: WriteAgentMemoryParams,
  signal?: AbortSignal,
): Promise<{ id: number }> {
  if (!magiSystemEnabled()) {
    throw new Error('magi-system disabled');
  }
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/write`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({
      owner_id: params.ownerId,
      text: params.text,
      confidence: params.confidence,
      status: params.status ?? 'pending',
      source_run_id: params.sourceRunId ?? null,
      source_session_id: params.sourceSessionId ?? null,
      topic_id: params.topicId ?? null,
      kind: params.kind ?? 'fact',
      sentiment: params.sentiment ?? null,
      source_fragment_ids: params.sourceFragmentIds ?? null,
      ...(params.sources && params.sources.length > 0
        ? { sources: params.sources.map(toWireSource) }
        : {}),
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`agent-memory write HTTP ${res.status}`);
  }
  const json = (await res.json()) as { id: number };
  return { id: json.id };
}

/**
 * Agent 记忆时序失效 —— 打 MAGI /api/agent-memory/invalidate(置 valid_until)。
 * owner-scoped。返回受影响行数。未启用时抛(调用方 fail-open 兜)。
 */
export async function invalidateAgentMemory(
  ownerId: string,
  id: number,
  signal?: AbortSignal,
  /** K3:版本链 —— 本条被哪条新记忆取代(MAGI 校验同 owner 存在且非自指,否则 400)。 */
  supersededById?: number,
): Promise<{ invalidated: number }> {
  if (!magiSystemEnabled()) {
    throw new Error('magi-system disabled');
  }
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/invalidate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({
      owner_id: ownerId,
      id,
      ...(supersededById != null ? { superseded_by_id: supersededById } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`agent-memory invalidate HTTP ${res.status}`);
  }
  const json = (await res.json()) as { invalidated: number };
  return { invalidated: json.invalidated };
}

export type MemoryListItem = {
  id: number;
  text: string;
  status: string;
  confidence: number | null;
  createdAt: string | null;
  validUntil: string | null;
  sourceRunId: string | null;
  kind: string;
  sentiment: string | null;
  sourceFragmentIds: number[] | null;
  promotedAt: string | null;
  /** K3:finding 出处/版本链/真伪轴(旧 MAGI 响应缺省兼容)。 */
  sources: MemorySource[] | null;
  supersededById: number | null;
  truthStatus: TruthStatus;
  truthNote: string | null;
  counterSources: MemorySource[] | null;
};

/** P5 面板:列出 owner 的记忆(可选 status 过滤)。owner-scoped + service token。 */
export async function listAgentMemory(
  ownerId: string,
  status?: 'pending' | 'approved' | 'rejected',
  signal?: AbortSignal,
  limit?: number,
): Promise<MemoryListItem[]> {
  if (!magiSystemEnabled()) return [];
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ owner_id: ownerId, status, ...(limit ? { limit } : {}) }),
    signal,
  });
  if (!res.ok) throw new Error(`agent-memory list HTTP ${res.status}`);
  const json = (await res.json()) as {
    items?: Array<{
      id: number;
      text: string;
      status: string;
      confidence?: number | null;
      created_at?: string | null;
      valid_until?: string | null;
      source_run_id?: string | null;
      kind?: string;
      sentiment?: string | null;
      source_fragment_ids?: number[] | null;
      promoted_at?: string | null;
      sources?: unknown;
      superseded_by_id?: number | null;
      truth_status?: string;
      truth_note?: string | null;
      counter_sources?: unknown;
    }>;
  };
  return (json.items ?? []).map((it) => ({
    id: it.id,
    text: it.text,
    status: it.status,
    confidence: it.confidence ?? null,
    createdAt: it.created_at ?? null,
    validUntil: it.valid_until ?? null,
    sourceRunId: it.source_run_id ?? null,
    kind: it.kind ?? 'fact',
    sentiment: it.sentiment ?? null,
    sourceFragmentIds: it.source_fragment_ids ?? null,
    promotedAt: it.promoted_at ?? null,
    sources: fromWireSources(it.sources),
    supersededById: it.superseded_by_id ?? null,
    truthStatus: (it.truth_status ?? 'unverified') as TruthStatus,
    truthNote: it.truth_note ?? null,
    counterSources: fromWireSources(it.counter_sources),
  }));
}

/** P5 面板:审批一条 pending 记忆(approve/reject)。owner-scoped + service token。 */
export async function decideAgentMemory(
  ownerId: string,
  id: number,
  decision: 'approve' | 'reject',
  signal?: AbortSignal,
): Promise<{ updated: number }> {
  if (!magiSystemEnabled()) return { updated: 0 };
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/decide`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ owner_id: ownerId, id, decision }),
    signal,
  });
  if (!res.ok) throw new Error(`agent-memory decide HTTP ${res.status}`);
  const json = (await res.json()) as { updated: number };
  return { updated: json.updated };
}

/**
 * 升格(M4h):MAGI 侧 compare-and-set promoted_at + 返回 text(供 agent 写原生核心)。
 * 幂等:已升格 → {promoted:false}。owner-scoped + service token。未启用 → {promoted:false}。
 */
export async function promoteAgentMemory(
  ownerId: string,
  id: number,
  signal?: AbortSignal,
): Promise<{ promoted: boolean; text: string | null }> {
  if (!magiSystemEnabled()) return { promoted: false, text: null };
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/promote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ owner_id: ownerId, id }),
    signal,
  });
  if (!res.ok) throw new Error(`agent-memory promote HTTP ${res.status}`);
  const json = (await res.json()) as { promoted: boolean; text: string | null };
  return { promoted: json.promoted, text: json.text ?? null };
}

/**
 * 升格补偿(M4h):清 MAGI 侧 promoted_at。供升格时原生写失败回滚,使事实重回 episodic search。
 * owner-scoped + service token。未启用 → no-op。
 */
export async function unpromoteAgentMemory(
  ownerId: string,
  id: number,
  signal?: AbortSignal,
): Promise<{ unpromoted: number }> {
  if (!magiSystemEnabled()) return { unpromoted: 0 };
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/unpromote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ owner_id: ownerId, id }),
    signal,
  });
  if (!res.ok) throw new Error(`agent-memory unpromote HTTP ${res.status}`);
  const json = (await res.json()) as { unpromoted: number };
  return { unpromoted: json.unpromoted };
}

export async function ingestMagiContent(
  url: string,
  signal?: AbortSignal,
): Promise<{
  title: string;
  summary: string;
  videoUrl?: string;
}> {
  if (!magiContentEnabled()) {
    return {
      title: '链接处理未启用',
      summary: `MAGI Content 未开启。链接：${url}`,
    };
  }
  const res = await fetch(`${MAGI_CONTENT_URL}/api/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_CONTENT_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`magi-content HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    title?: string;
    summary?: string;
    videoUrl?: string;
  };
  return {
    title: json.title ?? '链接内容',
    summary: json.summary ?? '',
    videoUrl: json.videoUrl,
  };
}

/**
 * K3:误失效追回 —— MAGI /revalidate(valid_until 置回 NULL、清版本链)。
 * 时效轴与评审轴正交:返回的 status 若为 'rejected',调用方需提示「还需恢复审批」。
 */
export async function revalidateAgentMemory(
  ownerId: string,
  id: number,
  signal?: AbortSignal,
): Promise<{ revalidated: number; status: string | null }> {
  if (!magiSystemEnabled()) return { revalidated: 0, status: null };
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/revalidate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ owner_id: ownerId, id }),
    signal,
  });
  if (!res.ok) throw new Error(`agent-memory revalidate HTTP ${res.status}`);
  const json = (await res.json()) as { revalidated: number; status?: string | null };
  return { revalidated: json.revalidated, status: json.status ?? null };
}

/**
 * K3 真伪轴:标伪/标争议/撤销 —— MAGI /mark-truth。可逆;伪 ≠ 删(search 仍命中,带标渲染)。
 * 部分更新语义:opts 里未提供的 note/反证 MAGI 侧保留;truth_status='unverified' 连带清两者。
 * 注意:promoted 行 MAGI 侧 no-op(updated=0)——活副本在原生层,先 unpromote 再纠。
 */
export async function markTruthAgentMemory(
  ownerId: string,
  id: number,
  truthStatus: TruthStatus,
  opts?: { truthNote?: string; counterSources?: MemorySource[] },
  signal?: AbortSignal,
): Promise<{ updated: number }> {
  if (!magiSystemEnabled()) return { updated: 0 };
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/mark-truth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({
      owner_id: ownerId,
      id,
      truth_status: truthStatus,
      ...(opts?.truthNote !== undefined ? { truth_note: opts.truthNote } : {}),
      ...(opts?.counterSources !== undefined
        ? { counter_sources: opts.counterSources.map(toWireSource) }
        : {}),
    }),
    signal,
  });
  if (!res.ok) throw new Error(`agent-memory mark-truth HTTP ${res.status}`);
  const json = (await res.json()) as { updated: number };
  return { updated: json.updated };
}

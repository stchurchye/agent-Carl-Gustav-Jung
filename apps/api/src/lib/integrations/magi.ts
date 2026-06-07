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

export type MemoryHit = {
  id: number;
  text: string;
  sourceRunId: string | null;
  sourceSessionId: string | null;
  topicId: string | null;
  createdAt: string | null;
  score: number;
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
    body: JSON.stringify({ owner_id: ownerId, id }),
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
};

/** P5 面板:列出 owner 的记忆(可选 status 过滤)。owner-scoped + service token。 */
export async function listAgentMemory(
  ownerId: string,
  status?: 'pending' | 'approved' | 'rejected',
  signal?: AbortSignal,
): Promise<MemoryListItem[]> {
  if (!magiSystemEnabled()) return [];
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ owner_id: ownerId, status }),
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

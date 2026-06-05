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
): Promise<MemoryHit[]> {
  if (!magiSystemEnabled()) return [];
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/agent-memory/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ owner_id: ownerId, query, top_k: topK }),
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

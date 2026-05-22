import { api, authHeaders } from '../../lib/api';
import { API_BASE_URL } from '../../lib/config';
import type { AgentNotice, AgentRun, AgentRunStatus, AgentRunWithSteps, AgentStep } from './types';

function unwrapRun(data: unknown): AgentRunWithSteps {
  // 后端 GET /api/agent/runs/:id 返回 { run, steps, notices? } (M1b-1 起；M1e task 2 加 notices);
  // 容错:旧实现可能直接返回 run 本体。
  if (data && typeof data === 'object' && 'run' in (data as Record<string, unknown>)) {
    const d = data as { run: AgentRun; steps?: AgentStep[]; notices?: AgentNotice[] };
    return { run: d.run, steps: d.steps ?? [], notices: d.notices ?? [] };
  }
  return { run: data as AgentRun, steps: [], notices: [] };
}

export async function fetchAgentRun(id: string): Promise<AgentRunWithSteps> {
  const res = await api.getAgentRun(id);
  return unwrapRun(res.data);
}

export async function cancelAgentRun(id: string): Promise<void> {
  await api.cancelAgentRun(id);
}

export async function approveAgentRun(id: string, reason?: string): Promise<void> {
  await api.approveAgentRun(id, reason);
}

export async function denyAgentRun(id: string, reason?: string): Promise<void> {
  await api.denyAgentRun(id, reason);
}

export async function steerAgentRun(id: string, instruction: string): Promise<void> {
  await api.steerAgentRun(id, instruction);
}

export async function retryAgentRun(id: string): Promise<{ runId: string }> {
  const res = await api.retryAgentRun(id);
  const data = res.data as { runId: string };
  return { runId: data.runId };
}

export async function resumeAgentRun(id: string, userInput: string): Promise<void> {
  await api.resumeAgentRun(id, userInput);
}

export type ListAgentRunsResult = {
  runs: AgentRun[];
  hasMore: boolean;
};

/**
 * M4 Task 7：拉用户可见的 agent run 列表。
 * 后端 GET /api/agent/runs（M1d Task 4）：按 owner_id = me 或 me ∈ group_members 过滤；
 * limit 默认 50，最大 100；响应 { runs, hasMore }。
 */
export async function listAgentRuns(opts?: {
  status?: AgentRunStatus;
  limit?: number;
}): Promise<ListAgentRunsResult> {
  const res = await api.listAgentRuns(opts);
  const data = res.data as { runs: AgentRun[]; hasMore: boolean };
  return { runs: data.runs ?? [], hasMore: data.hasMore ?? false };
}

export type LongPollBatch = {
  type: 'batch' | 'idle';
  run: AgentRun | null;
  steps: AgentStep[];
  notices?: AgentNotice[];
  lastIdx?: number;
  hasMore?: boolean;
};

/**
 * M6 T1b：单次 long-poll 请求 GET /api/agent/runs/:id/long-poll?after=<idx>。
 * 服务器返回 ndjson：0~N 行 heartbeat，最后一行 batch 或 idle。
 * signal 由调用方传入（AbortController），处理 35s client-side timeout。
 */
export async function longPollAgentRun(
  runId: string,
  after: number,
  signal: AbortSignal,
): Promise<LongPollBatch> {
  const headers = await authHeaders();
  const url = `${API_BASE_URL}/api/agent/runs/${runId}/long-poll?after=${after}`;
  const resp = await fetch(url, { headers, signal });
  if (!resp.ok) {
    throw new Error(`long-poll failed: ${resp.status}`);
  }

  function parseLine(line: string): LongPollBatch | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const obj = JSON.parse(trimmed) as { type: string };
      if (obj.type === 'heartbeat') return null;
      if (obj.type === 'batch' || obj.type === 'idle') {
        return obj as unknown as LongPollBatch;
      }
    } catch {
      // skip malformed line
    }
    return null;
  }

  // Fallback for environments where resp.body or stream API is unavailable.
  // React Native stream support varies: body may exist but lack getReader/TextDecoder.
  const canStream =
    resp.body != null &&
    typeof resp.body.getReader === 'function' &&
    typeof TextDecoder !== 'undefined';

  if (!canStream) {
    const text = await resp.text();
    let result: LongPollBatch | null = null;
    for (const line of text.split('\n')) {
      const parsed = parseLine(line);
      if (parsed) result = parsed;
    }
    if (!result) throw new Error('long-poll: stream ended without batch/idle line');
    return result;
  }

  // Streaming path: read ndjson incrementally
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: LongPollBatch | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed) result = parsed;
      }
    }
    // Flush remaining buffer
    if (buffer.trim()) {
      const parsed = parseLine(buffer);
      if (parsed) result = parsed;
    }
  } finally {
    reader.releaseLock();
  }

  if (!result) throw new Error('long-poll: stream ended without batch/idle line');
  return result;
}

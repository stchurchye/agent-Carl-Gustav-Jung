import { api } from '../../lib/api';
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

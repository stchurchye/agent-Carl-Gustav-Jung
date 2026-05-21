import { useEffect, useState } from 'react';
import { fetchAgentRun } from '../agentApi';
import type { AgentNotice, AgentRun, AgentStep } from '../types';

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES: AgentRun['status'][] = [
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
];

/**
 * M1b-3：轮询 GET /api/agent/runs/:id 拿 { run, steps }。
 *
 * M1d 说明：后端 SSE (`/api/agent/runs/:id/stream`) 已支持 `Last-Event-ID`
 * （或 `?after=` query）续传，每条 step 都带 SSE `id` 字段——给 Web /
 * CLI 客户端用 EventSource 用。Mobile 因为 RN 缺 native EventSource，
 * 这里继续走轮询：每轮都是 full state read，天然"断线即续传"，简单且健壮。
 * 切 SSE 的话只需把消费者从这个 hook 切到 useAgentRunSSE，
 * 上层组件用 alias import (`useAgentRunSubscription`) 屏蔽差异。
 */
export function useAgentRunPoll(runId: string | null) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [notices, setNotices] = useState<AgentNotice[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setSteps([]);
      setNotices([]);
      setConnected(false);
      return;
    }
    let stopped = false;

    async function loop() {
      setConnected(true);
      while (!stopped) {
        try {
          const {
            run: nextRun,
            steps: nextSteps,
            notices: nextNotices,
          } = await fetchAgentRun(runId!);
          if (stopped) break;
          setRun(nextRun);
          setSteps(nextSteps);
          setNotices(nextNotices ?? []);
          if (TERMINAL_STATUSES.includes(nextRun.status)) break;
        } catch {
          // 单次失败忽略,下轮重试。
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!stopped) setConnected(false);
    }

    void loop();
    return () => {
      stopped = true;
    };
  }, [runId]);

  return { run, steps, notices, connected };
}

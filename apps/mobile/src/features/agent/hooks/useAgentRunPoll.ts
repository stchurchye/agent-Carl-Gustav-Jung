import { useEffect, useState } from 'react';
import { fetchAgentRun } from '../agentApi';
import type { AgentRun, AgentStep } from '../types';

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
 * M1d 升级到 SSE 时，只需要把消费者从这个 hook 切到 useAgentRunSSE，
 * 上层组件用 alias import (`useAgentRunSubscription`) 屏蔽差异。
 */
export function useAgentRunPoll(runId: string | null) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setSteps([]);
      setConnected(false);
      return;
    }
    let stopped = false;

    async function loop() {
      setConnected(true);
      while (!stopped) {
        try {
          const { run: nextRun, steps: nextSteps } = await fetchAgentRun(runId!);
          if (stopped) break;
          setRun(nextRun);
          setSteps(nextSteps);
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

  return { run, steps, connected };
}

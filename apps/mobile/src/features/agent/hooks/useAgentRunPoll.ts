import { useEffect, useState } from 'react';
import { fetchAgentRun, longPollAgentRun } from '../agentApi';
import type { AgentNotice, AgentRun, AgentStep } from '../types';

const CLIENT_TIMEOUT_MS = 35000;        // server max 30s + 5s 余量
const ERROR_BACKOFF_MS = 1000;
const TERMINAL_STATUSES: AgentRun['status'][] = [
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
];

/**
 * M6 T1b：增量 long-poll 替代 1.5s polling。
 *
 * 行为：
 *   1. mount 时全量 GET /runs/:id 一次拉初始状态（避免错过历史 step）
 *   2. 之后循环：long-poll(after=lastIdx) → 累加 steps → 立刻重连
 *   3. terminal 状态 → break loop
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
    let cancelled = false;
    let activeCtl: AbortController | null = null;
    let knownSteps: AgentStep[] = [];
    let lastIdx = -1;

    function mergeSteps(incoming: AgentStep[]) {
      if (incoming.length === 0) return knownSteps;
      const byId = new Map(knownSteps.map((s) => [s.id, s]));
      for (const s of incoming) byId.set(s.id, s);
      const merged = Array.from(byId.values()).sort((a, b) => a.idx - b.idx);
      knownSteps = merged;
      return merged;
    }

    async function bootstrap() {
      try {
        const { run: r0, steps: s0, notices: n0 } = await fetchAgentRun(runId!);
        if (cancelled) return;
        setRun(r0);
        setNotices(n0 ?? []);
        knownSteps = s0;
        setSteps(s0);
        lastIdx = s0.length > 0 ? Math.max(...s0.map((s) => s.idx)) : -1;
        if (TERMINAL_STATUSES.includes(r0.status)) {
          setConnected(false);
          cancelled = true;
        }
      } catch {
        // 失败由后续 loop 重试
      }
    }

    async function loop() {
      setConnected(true);
      await bootstrap();
      while (!cancelled) {
        const ctl = new AbortController();
        activeCtl = ctl;
        const timeoutId = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);
        try {
          const batch = await longPollAgentRun(runId!, lastIdx, ctl.signal);
          if (cancelled) break;
          if (batch.run) setRun(batch.run);
          if (batch.notices) setNotices(batch.notices);
          if (batch.steps && batch.steps.length > 0) {
            const merged = mergeSteps(batch.steps);
            setSteps(merged);
            lastIdx = Math.max(...batch.steps.map((s) => s.idx));
          }
          if (batch.run && TERMINAL_STATUSES.includes(batch.run.status)) break;
        } catch {
          if (cancelled) break;
          await new Promise((r) => setTimeout(r, ERROR_BACKOFF_MS));
        } finally {
          clearTimeout(timeoutId);
          activeCtl = null;
        }
      }
      if (!cancelled) setConnected(false);
    }

    void loop();
    return () => {
      cancelled = true;
      activeCtl?.abort();
    };
  }, [runId]);

  return { run, steps, notices, connected };
}

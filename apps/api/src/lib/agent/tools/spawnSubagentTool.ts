import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import * as store from '../store.js';
import { runChildSubagent, type SubagentCitation } from '../spawnSubagent.js';
import { SPAWNABLE_SUBAGENT_ROLES } from '../subagentTools.js';
import type { AgentRole } from '../types.js';

type SpawnSubagentInput = {
  task: string;
  role: 'researcher' | 'analyst';
  maxSteps?: number;
};

type SpawnSubagentOutput = {
  ok: boolean;
  role: string;
  report: string;
  citations: SubagentCitation[];
  stepsUsed: number;
  childRunId: string;
  error?: string;
};

/**
 * M3-S1：通用子 agent 派生。deep_research 的泛化形态 —— 可指定 role 决定子 agent 的工具子集：
 *  - researcher：文献/检索(search_papers/wikipedia/fetch_url/document_reader/magi_system_read/…)，纯只读。
 *  - analyst：researcher + run_python(沙箱计算)+ render_diagram(画图)，用于数据/计算/可视化子任务。
 * 子 agent 禁止递归(不能再 spawn_subagent/deep_research)、禁止 ask_user(暂停)。
 */
export const spawnSubagentTool: ToolDef<SpawnSubagentInput, SpawnSubagentOutput> = {
  name: 'spawn_subagent',
  description:
    'Spawn a sub-agent with a specific ROLE to handle a focused sub-task, returning a markdown report + citations. ' +
    'role="researcher": literature/evidence/web/wikipedia/docs (read-only). ' +
    'role="analyst": researcher tools PLUS run_python (sandboxed compute/stats) and render_diagram (charts) — use for data crunching, calculations, or visualizations. ' +
    'Use ONCE per sub-task; do NOT nest (a sub-agent cannot spawn another). For pure literature research you can also use deep_research (= researcher shortcut).',
  inputSchema: {
    type: 'object',
    required: ['task', 'role'],
    properties: {
      task: { type: 'string', minLength: 5 },
      // enum 从 SPAWNABLE_SUBAGENT_ROLES 派生(单一真相;与 handler 的 includes 校验同源,防漂移)。
      role: { type: 'string', enum: [...SPAWNABLE_SUBAGENT_ROLES] },
      maxSteps: { type: 'integer', minimum: 1, maximum: 8 },
    },
  },
  approvalMode: 'auto',
  costHint: 'high',
  hasSideEffects: true,
  idempotent: false,
  replyMeta: {
    summaryKind: 'text',
    failureHint:
      'spawn_subagent 失败：子 agent 超时/工具不可用/子任务范围太大/role 非法。可缩小子任务范围、换 role，或改用串行工具。',
  },
  async handler(input, ctx) {
    const role = input.role as AgentRole;
    if (!SPAWNABLE_SUBAGENT_ROLES.includes(role)) {
      return {
        ok: false,
        role: String(input.role),
        report: '',
        citations: [],
        stepsUsed: 0,
        childRunId: '',
        error: `invalid role "${input.role}" (allowed: ${SPAWNABLE_SUBAGENT_ROLES.join(', ')})`,
      };
    }
    const parentRun = await store.getAgentRun(ctx.runId);
    if (!parentRun) {
      return { ok: false, role, report: '', citations: [], stepsUsed: 0, childRunId: '', error: 'parent run not found' };
    }
    // 防递归：子 agent 不能再 spawn 子 agent。
    if (parentRun.parentRunId) {
      return {
        ok: false,
        role,
        report: '',
        citations: [],
        stepsUsed: 0,
        childRunId: '',
        error: 'spawn_subagent cannot be nested (run is already a sub-agent)',
      };
    }
    const maxSteps = Math.max(1, Math.min(input.maxSteps ?? 5, 8));
    try {
      const res = await runChildSubagent({ parentRun, task: input.task, role, maxSteps, signal: ctx.signal });
      return { ...res, role };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        role,
        report: '',
        citations: [],
        stepsUsed: 0,
        childRunId: '',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerSpawnSubagent(): void {
  if (!toolRegistry.get(spawnSubagentTool.name)) toolRegistry.register(spawnSubagentTool);
}

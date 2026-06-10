import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import * as store from '../store.js';
import { runChildSubagent, type SubagentCitation } from '../spawnSubagent.js';
import { SPAWNABLE_SUBAGENT_ROLES } from '../subagentTools.js';
import type { AgentRole } from '../types.js';

type SpawnSubagentInput = {
  /** 单子任务(与 tasks 二选一,tasks 优先)。 */
  task?: string;
  /** R3-2:并行派多个研究员(2-5),各自独立查,lead 聚合报告 + 引用去重。 */
  tasks?: string[];
  role: 'researcher' | 'analyst';
  maxSteps?: number;
};

type SpawnSubagentOutput = {
  ok: boolean;
  role: string;
  report: string;
  citations: SubagentCitation[];
  stepsUsed: number;
  /** 向后兼容:首个成功子 run 的 id(单 task 旧语义)。 */
  childRunId: string;
  /** R3-2:扇出模式下全部子 run id(含失败的空串已滤)。 */
  childRunIds?: string[];
  error?: string;
};

/** R3-2:单步并行子任务上限(childExecutor 池=3,5 个分两批仍在子预算窗口内)。 */
const FANOUT_MAX_TASKS = 5;

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
    'Do NOT nest (a sub-agent cannot spawn another). For pure literature research you can also use deep_research (= researcher shortcut). ' +
    'TIP: pass `tasks` (2-5) to fan out parallel researchers on independent angles of one topic (e.g. 历史脉络/当代研究/批评观点) in ONE step — reports are merged with per-task sections.',
  inputSchema: {
    type: 'object',
    required: ['role'],
    properties: {
      task: { type: 'string', minLength: 5, description: '单子任务(与 tasks 二选一)' },
      tasks: {
        type: 'array',
        items: { type: 'string', minLength: 5 },
        minItems: 2,
        maxItems: 5,
        description: '并行扇出:2-5 个互相独立的子任务角度,各派一个研究员并行查,报告分节聚合',
      },
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
    const tasks = (input.tasks && input.tasks.length > 0 ? input.tasks : [input.task ?? ''])
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, FANOUT_MAX_TASKS);
    if (tasks.length === 0) {
      return {
        ok: false, role, report: '', citations: [], stepsUsed: 0, childRunId: '',
        error: 'task/tasks 至少要有一个非空子任务',
      };
    }
    const isFanout = tasks.length > 1;

    try {
      // R3-2:handler 内并行扇出(决策①:主循环零侵入)。childExecutor 池(并发 3)天然
      // 承接,5 个 task 分批排队仍在 MAX_WAIT 窗口内。防递归守卫在 runChildSubagent 入口逐个生效。
      const settled = await Promise.all(
        tasks.map(async (task) => {
          try {
            return { task, res: await runChildSubagent({ parentRun, task, role, maxSteps, signal: ctx.signal }) };
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') throw e;
            return {
              task,
              res: {
                ok: false, report: '', citations: [] as SubagentCitation[], stepsUsed: 0,
                childRunId: '', error: e instanceof Error ? e.message : String(e),
              },
            };
          }
        }),
      );

      const succeeded = settled.filter((s) => s.res.ok);
      if (!isFanout) {
        return { ...settled[0].res, role };
      }
      // 聚合:报告按子任务分节(失败的标注原因);引用按 kind:id 去重;steps 求和。
      const report = settled
        .map(({ task, res }) =>
          res.ok
            ? `## 子任务:${task}\n\n${res.report}`
            : `## 子任务:${task}\n\n(该子任务失败:${res.error ?? 'unknown'})`,
        )
        .join('\n\n');
      const seen = new Set<string>();
      const citations: SubagentCitation[] = [];
      for (const { res } of settled) {
        for (const c of res.citations) {
          const key = `${c.kind}:${c.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          citations.push(c);
        }
      }
      return {
        ok: succeeded.length > 0,
        role,
        report,
        citations,
        stepsUsed: settled.reduce((n, s) => n + s.res.stepsUsed, 0),
        childRunId: succeeded[0]?.res.childRunId ?? '',
        childRunIds: settled.map((s) => s.res.childRunId).filter((id) => id !== ''),
        ...(succeeded.length === 0
          ? { error: settled.map((s) => `"${s.task}": ${s.res.error}`).join('; ') }
          : {}),
      };
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

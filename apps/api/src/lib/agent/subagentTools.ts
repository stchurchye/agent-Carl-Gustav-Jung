/**
 * M3 ADR-3 / M3-S1：子 agent 工具子集（按角色）。
 * 子 agent 只读 / 检索类 / 无副作用为主；禁止递归(deep_research/spawn_subagent)和暂停(ask_user)。
 * M3-S1：从「全局单一白名单」泛化为「按 run.role 取工具子集」——planner 裁剪 + runExecute exec-time
 * 守卫都按角色子集，让 spawn_subagent 能派不同能力的子 agent。
 */
import type { AgentRole } from './types.js';

// researcher：只读检索集（M3-S0 原 SUBAGENT_TOOL_WHITELIST 内容 + K6 recall_memory）。
const RESEARCHER_TOOLS = [
  'search_papers',
  'search_web',
  'wikipedia',
  'fetch_url',
  'document_reader',
  'get_paper_citations',
  'datetime_now',
  'magi_system_read',
  'get_economic_series',
  // K6:只读/owner 锁/无副作用 —— 子研究员开局先 recall 已沉淀 findings,
  // 站在已有结论上往外搜(tasks[] 并行研究员各自可查再聚合)。写记忆不在子集
  // (save_memory 留给父 run;子 run 引用经 K1 回流父,父收尾统一蒸馏)。
  'recall_memory',
] as const;

// analyst：researcher + 计算/画图。run_python 在 E2B 沙箱 + 受 budget/幂等护栏；render_diagram 无副作用。
const ANALYST_EXTRA = ['run_python', 'render_diagram'] as const;

/** 每个角色允许的工具子集。仍统一禁止 deep_research/spawn_subagent(递归)/ask_user(暂停)。 */
export const SUBAGENT_ROLE_TOOLS: Record<AgentRole, ReadonlySet<string>> = {
  generalist: new Set<string>(RESEARCHER_TOOLS), // 安全默认 = researcher 只读集
  researcher: new Set<string>(RESEARCHER_TOOLS),
  analyst: new Set<string>([...RESEARCHER_TOOLS, ...ANALYST_EXTRA]),
};

/**
 * 取某角色的子 agent 工具子集；未知/缺失角色回退到 generalist(最安全只读集)——fail-closed。
 * 双 fallback 都必要:`?? 'generalist'` 兜 null/undefined;尾部 `?? generalist` 兜「老 DB 行里
 * 不在枚举内的 role 字符串」(`as AgentRole` 是类型谎言,运行时索引非键返回 undefined)。勿删尾部 guard。
 */
export function subagentToolsForRole(role: AgentRole | string | null | undefined): ReadonlySet<string> {
  return SUBAGENT_ROLE_TOOLS[(role ?? 'generalist') as AgentRole] ?? SUBAGENT_ROLE_TOOLS.generalist;
}

/** spawn_subagent 可指定的角色(generalist 是隐式默认,不在此列给用户/LLM 选)。 */
export const SPAWNABLE_SUBAGENT_ROLES: ReadonlyArray<AgentRole> = ['researcher', 'analyst'];

/**
 * 向后兼容别名：= researcher 只读集（M3-S0 语义不变）。旧引用继续拿到只读集；
 * per-run 的真实限制走 subagentToolsForRole(run.role)。
 */
export const SUBAGENT_TOOL_WHITELIST: ReadonlySet<string> = SUBAGENT_ROLE_TOOLS.researcher;

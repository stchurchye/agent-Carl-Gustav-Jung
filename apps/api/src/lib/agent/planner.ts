import type { Plan, PlanStep, TodoItem } from './types.js';
import { toolRegistry, type ToolDef } from './toolRegistry.js';
import type { LlmChatClient, LlmChatMessage } from '../llm/types.js';
import type { AgentContextSnapshot } from './contextAdapter.js';

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function extractStepCount(text: string): number {
  const arabic = text.match(/(\d+)\s*步/);
  if (arabic) return Math.min(Math.max(parseInt(arabic[1], 10), 1), 10);
  for (const [ch, n] of Object.entries(CN_NUM)) {
    if (new RegExp(`${ch}\\s*步`).test(text)) return Math.min(n, 10);
  }
  return 1;
}

/**
 * M1a echo-only planner. 不调 LLM，纯本地规则。
 * 当 M1c 把 LLM planner 接入后，此函数将保留作为 echo 工具的 fallback。
 */
export function generatePlanForEcho(text: string): Plan {
  const n = extractStepCount(text);
  const todos: TodoItem[] = [];
  const steps: PlanStep[] = [];
  for (let i = 1; i <= n; i++) {
    const todoId = `t${i}`;
    todos.push({
      id: todoId,
      text: `Echo 第 ${i} 次`,
      status: 'pending',
      stepRefs: [],
    });
    steps.push({
      toolName: 'echo_after_sleep',
      input: { text: `第 ${i} 次 echo`, sleepMs: 1500 },
      reason: `测试 runtime 第 ${i} 步`,
      todoId,
    });
  }
  return {
    intentSummary: `测试 agent 跑 ${n} 步 echo`,
    steps,
    todos,
    finalReplyHint: `回复：已完成 ${n} 次 echo，每次间隔 1.5s。`,
    reasoning: null,
    version: 1,
  };
}

/**
 * M1b-2 steer 重规划。M1b 简化版：抽 instruction 里的步数生成新 echo 计划。
 * 接口与 M1c 的 LLM-driven planner 对齐：(prevPlan, instruction, alreadyCompletedSteps) → Plan。
 */
export function generatePlanForSteer(
  prevPlan: Plan,
  instruction: string,
  _alreadyCompletedSteps: number,
): Plan {
  const next = generatePlanForEcho(instruction);
  return {
    ...next,
    intentSummary: `[steer] ${instruction}`,
    version: prevPlan.version + 1,
  };
}

/**
 * M1b-2 deny 重规划。简化为 echo 1 步占位；M1c 接 LLM 时会带 deniedTool + inputText
 * 让 planner 选替代方案。
 */
export function generatePlanForApprovalDeny(
  prevPlan: Plan,
  deniedTool: string,
  inputText: string,
): Plan {
  const next = generatePlanForEcho(inputText || '继续');
  return {
    ...next,
    intentSummary: `[after deny:${deniedTool}] 改用替代方案`,
    version: prevPlan.version + 1,
  };
}

// =====================================================================
// M1c: LLM planner
// =====================================================================

export type LlmPlannerInput = {
  inputText: string;
  snapshot: AgentContextSnapshot;
  /**
   * M1e Task 11d：从 raw `apiKey: string` 升级为 provider-neutral client。
   * Caller 通过 `runLlmClient.resolveLlmClient(run)` 构造，传 null 时不会调到这里
   * （runPlanGlue 负责 short-circuit 到 echo）。
   */
  llm: LlmChatClient;
  /** 必须传，让 cancelRun 能中断 LLM 调用 */
  signal: AbortSignal;
  /** 默认 generalist。M1c 暂不区分 role。 */
  role?: string;
  /**
   * M1f #1：replan 场景下传入。让 LLM 知道上一步失败原因并避免重复同样错误。
   * caller（runPlanGlue / steer / approval_deny replan）按需填。
   */
  previousFailure?: string;
};

/**
 * 让 LLM 根据 input + context + 已注册工具生成 plan。
 *
 * M1e review followup（v0.m1e tag 前）：**不再吞 LLM 异常**。原来的 try/catch
 * 让 `buildInitialPlan` 那一层 emit `PLANNER_LLM_FALLBACK` notice 的代码路径成
 * 了死代码（test 用 `vi.mock` 直接 stub 这个函数，正好把死代码也 mock 住了）。
 *
 * 现在的契约：
 * - llm.chat throw  → 异常直接抛给 caller（`buildInitialPlan`），由它写 notice + system_error
 * - LLM 返回但 JSON 无法 parse → 抛 PlannerJsonParseError（caller 同样路径处理）
 * - 解析成功 → 返回 Plan
 *
 * caller 仍需 fallback 到 echo plan —— 这是 `buildInitialPlan` 的职责。
 */
export class PlannerJsonParseError extends Error {
  constructor(public readonly rawSnippet: string) {
    super(`planner LLM returned unparseable JSON: ${rawSnippet.slice(0, 200)}`);
    this.name = 'PlannerJsonParseError';
  }
}

export async function generatePlanWithLlm(
  input: LlmPlannerInput,
): Promise<Plan> {
  const tools = toolRegistry.list(); // 默认 generalist
  const systemPrompt = buildPlannerSystemPrompt(tools);
  const userPrompt = buildPlannerUserPrompt(input);

  const messages: LlmChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: input.snapshot.systemPrompt
        ? input.snapshot.systemPrompt + '\n\n---\n' + userPrompt
        : userPrompt,
    },
  ];

  const result = await input.llm.chat(messages, {
    temperature: 0.3,
    maxTokens: 1024,
    signal: input.signal,
  });

  const parsed = parsePlannerJson(result.content, tools);
  if (!parsed) throw new PlannerJsonParseError(result.content);
  return parsed;
}

const PLANNER_INSTRUCTION = `你是任务规划器。读取用户的请求，挑选下列工具组成一个最小可行的 plan。
只输出**严格 JSON**，不要任何解释、不要 markdown 围栏、不要多余字段。

JSON 结构必须是：
{
  "intentSummary": "一句话概括用户想要什么",
  "steps": [
    {
      "toolName": "<上面工具列表里的 name>",
      "input": { ...符合该工具 inputSchema 的对象... },
      "reason": "为什么这一步",
      "todoId": "t1"
    }
  ],
  "todos": [
    { "id": "t1", "text": "对用户可读的待办描述", "status": "pending", "stepRefs": [] }
  ],
  "finalReplyHint": "执行完成后给用户的回复风格提示"
}

约束：
- 每个 step.todoId 必须能在 todos 数组里找到对应 id
- 不要发明不存在的 toolName
- steps 数量控制在 1-6 之间
- 若任务完全是闲聊或单步问答，可只放 1 个 step

工具调用约定（必读）：
- 调用前阅读 tool description 的 inputSchema
- 收到 observation 时检查 \`ok\` 字段：ok=false 或 error 字段非空 → 当前 step 失败
- 失败处理：
  a. 可以换参数重试（如不同搜索词 / 备选 url）→ 在新 plan 里补一个相同 tool 的 step
  b. 该工具能力本身不可用（持续 4xx/5xx）→ 跳过该工具，用其他工具达成目标
  c. 整条路径不可行 → 把已查到的部分写成 reply，明确告诉用户「X 不可达」
- 不要忽略 ok=false 直接进下一步
`;

function buildPlannerSystemPrompt(tools: ToolDef[]): string {
  const toolBlock = tools
    .map((t) => {
      const schema = JSON.stringify(t.inputSchema).slice(0, 400);
      const hint = t.replyMeta?.failureHint
        ? `\n  失败常见原因：${t.replyMeta.failureHint}`
        : '';
      return `- ${t.name}: ${t.description}\n  inputSchema: ${schema}${hint}`;
    })
    .join('\n');
  return `${PLANNER_INSTRUCTION}\n\n可用工具：\n${toolBlock}`;
}

function buildPlannerUserPrompt(input: LlmPlannerInput): string {
  const summary = input.snapshot.shortSummary
    ? `\n\n# 当前上下文摘要\n${input.snapshot.shortSummary}`
    : '';
  const failure = input.previousFailure
    ? `\n\n# 上一步失败原因\n${input.previousFailure}\n请基于这个失败重新规划剩余步骤，避免重复同样错误。`
    : '';
  return `# 用户请求\n${input.inputText}${summary}${failure}`;
}

type LooseStep = {
  toolName?: unknown;
  input?: unknown;
  reason?: unknown;
  todoId?: unknown;
};

type LooseTodo = {
  id?: unknown;
  text?: unknown;
  status?: unknown;
  stepRefs?: unknown;
};

type LoosePlan = {
  intentSummary?: unknown;
  steps?: unknown;
  todos?: unknown;
  finalReplyHint?: unknown;
};

function tryParseJson(raw: string): LoosePlan | null {
  // LLM 偶尔会包 ```json ... ```，宽松剥一下
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    const v = JSON.parse(trimmed) as LoosePlan;
    if (!v || typeof v !== 'object') return null;
    return v;
  } catch {
    return null;
  }
}

export function parsePlannerJson(raw: string, tools: ToolDef[]): Plan | null {
  const obj = tryParseJson(raw);
  if (!obj) return null;
  const knownNames = new Set(tools.map((t) => t.name));

  if (typeof obj.intentSummary !== 'string') return null;
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) return null;
  if (!Array.isArray(obj.todos) || obj.todos.length === 0) return null;

  const todos: TodoItem[] = [];
  for (const raw of obj.todos as LooseTodo[]) {
    if (typeof raw.id !== 'string' || typeof raw.text !== 'string') return null;
    todos.push({
      id: raw.id,
      text: raw.text,
      status: 'pending',
      stepRefs: [],
    });
  }
  const todoIds = new Set(todos.map((t) => t.id));

  const steps: PlanStep[] = [];
  for (const raw of obj.steps as LooseStep[]) {
    if (typeof raw.toolName !== 'string' || !knownNames.has(raw.toolName)) {
      return null;
    }
    if (typeof raw.todoId !== 'string' || !todoIds.has(raw.todoId)) return null;
    steps.push({
      toolName: raw.toolName,
      input: (raw.input ?? {}) as Record<string, unknown>,
      reason: typeof raw.reason === 'string' ? raw.reason : '',
      todoId: raw.todoId,
    });
  }

  return {
    intentSummary: obj.intentSummary,
    steps,
    todos,
    finalReplyHint:
      typeof obj.finalReplyHint === 'string' ? obj.finalReplyHint : '',
    reasoning: null,
    version: 1,
  };
}

// =====================================================================
// M1f：仅测试用 export（避免污染主 API surface）
// =====================================================================
export const _buildPlannerSystemPromptForTest = buildPlannerSystemPrompt;
export const _buildPlannerUserPromptForTest = buildPlannerUserPrompt;

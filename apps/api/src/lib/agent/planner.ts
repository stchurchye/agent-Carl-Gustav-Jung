import type { Plan, PlanStep, TodoItem } from './types.js';
import { toolRegistry, type ToolDef } from './toolRegistry.js';
import { chatCompletionRaw, type ChatMessageInput } from '../deepseek.js';
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
  apiKey: string;
  /** 默认 generalist。M1c 暂不区分 role。 */
  role?: string;
};

/**
 * 让 LLM 根据 input + context + 已注册工具生成 plan。
 *
 * 失败/解析异常都会 fallback 到 `generatePlanForEcho`，保证 runtime 不会无 plan。
 * 单测可以 mock `chatCompletionRaw`（同模块内重新 import 即可）。
 */
export async function generatePlanWithLlm(
  input: LlmPlannerInput,
): Promise<Plan> {
  const tools = toolRegistry.list(); // 默认 generalist
  const systemPrompt = buildPlannerSystemPrompt(tools);
  const userPrompt = buildPlannerUserPrompt(input);

  const messages: ChatMessageInput[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: input.snapshot.systemPrompt
        ? input.snapshot.systemPrompt + '\n\n---\n' + userPrompt
        : userPrompt,
    },
  ];

  let raw: string;
  try {
    raw = await chatCompletionRaw(input.apiKey, messages, {
      temperature: 0.3,
      maxTokens: 1024,
    });
  } catch {
    return generatePlanForEcho(input.inputText);
  }

  const parsed = parsePlannerJson(raw, tools);
  if (!parsed) return generatePlanForEcho(input.inputText);
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
`;

function buildPlannerSystemPrompt(tools: ToolDef[]): string {
  const toolBlock = tools
    .map((t) => {
      const schema = JSON.stringify(t.inputSchema).slice(0, 400);
      return `- ${t.name}: ${t.description}\n  inputSchema: ${schema}`;
    })
    .join('\n');
  return `${PLANNER_INSTRUCTION}\n\n可用工具：\n${toolBlock}`;
}

function buildPlannerUserPrompt(input: LlmPlannerInput): string {
  const summary = input.snapshot.shortSummary
    ? `\n\n# 当前上下文摘要\n${input.snapshot.shortSummary}`
    : '';
  return `# 用户请求\n${input.inputText}${summary}`;
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

import type { Plan, PlanStep, TodoItem } from './types.js';

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

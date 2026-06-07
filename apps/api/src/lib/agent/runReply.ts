/**
 * Agent reply 生成 —— fallback 文本 + budget_exhausted 文本 + LLM 终稿入口。
 *
 * M1e task 1：从原 `runtime.ts` 拆出，零行为变更。
 * M1e task 11d 之后 `buildFinalContent` 会改成接收 `LlmChatClient | null`。
 * M1e task 13.4 之后 LLM 失败会 emit `REPLY_LLM_FALLBACK` notice（当前仍是静默 fallback）。
 */
import * as store from './store.js';
import type { AgentRun, Plan } from './types.js';
import { resolveLlmClient } from './runLlmClient.js';
import { runControllers } from './runtimeRegistry.js';

export function pickFallbackFinalContent(run: AgentRun, plan: Plan | null): string {
  if (!plan) return '[任务未完成]';
  const todos = run.todos.length > 0 ? run.todos : plan.todos;
  const completed = todos.filter((t) => t.status === 'completed').length;
  return `已完成 ${completed} 步：${plan.intentSummary}\n${plan.finalReplyHint}`;
}

/**
 * M1d T14：budget_exhausted 软着陆。前端会单独把这段拆开渲染（usage 行），
 * 这里 backend 保留可读的纯文本 fallback：
 * - 第一行：已完成事项 + 用户的原始 intent（沿用 fallback final content）
 * - 二行起：明确说"预算到了"+ 已花费 vs 上限
 */
export function formatBudgetExhaustedReply(
  run: AgentRun,
  detail: string | undefined,
): string {
  const base = pickFallbackFinalContent(run, run.plan);
  const u = run.usage;
  const b = run.budget;
  const dim = detail ?? 'unknown';
  const lines = [
    base,
    '',
    `[预算已用尽：${dim}]`,
    `已花费：步骤 ${u.steps}/${b.maxSteps}、tokens ${u.tokens}/${b.maxTokens}、用时 ${u.elapsedSeconds}s/${b.maxSeconds}s`,
    `如需继续，可在聊天里发"再试一次"或在任务面板点重试。`,
  ];
  return lines.join('\n');
}

/**
 * M1c：completed 状态下用 LLM 生成终稿；非 completed 走原占位文本。
 * 测试环境 / 缺 API key 时直接 fallback。
 */
export async function buildFinalContent(
  run: AgentRun,
  status: 'completed' | 'budget_exhausted' | 'failed' | 'cancelled',
  detail: string | undefined,
): Promise<string> {
  if (status === 'budget_exhausted') {
    return formatBudgetExhaustedReply(run, detail);
  }
  if (status === 'cancelled') return `[任务已取消${detail ? '：' + detail : ''}]`;
  if (status === 'failed') return `[任务失败${detail ? '：' + detail : ''}]`;

  const text = run.inputText ?? '';
  const isTestEnv =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  // issue 0004：与 runPlanGlue.buildInitialPlan 对齐——关键词 echo 短路只在显式
  // dev flag(AGENT_ECHO_KEYWORD=1)下生效,否则生产里含 "echo" 的真实消息会拿到
  // 写死的 echo 回复(跳过 generateFinalReply)。两处必须同步,否则 fix 只关一半。
  const devEchoKeyword = process.env.AGENT_ECHO_KEYWORD === '1';
  const looksLikeEcho = devEchoKeyword && /echo/i.test(text);
  if (isTestEnv || looksLikeEcho || !run.plan) {
    return pickFallbackFinalContent(run, run.plan);
  }
  const llm = await resolveLlmClient(run);
  if (!llm) return pickFallbackFinalContent(run, run.plan);
  const steps = await store.listSteps(run.id);
  const signal =
    runControllers.get(run.id)?.signal ?? new AbortController().signal;
  const { generateFinalReply } = await import('./replyGen.js');
  return generateFinalReply({
    run,
    plan: run.plan,
    steps,
    llm,
    signal,
  });
}

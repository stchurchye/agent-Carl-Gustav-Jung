/**
 * Agent runtime 内部 helpers — 跨 lifecycle / execute / reply / planGlue 共享的小工具。
 *
 * M1e task 1：从原 `runtime.ts`（762 行）拆出，零行为变更。
 * M1e task 11d：原 `resolveEffectiveApiKey`（DeepSeek-only）迁到 `runLlmClient.ts`
 *               的 `resolveEffectiveApiKeyForProvider`（per-provider），并改用
 *               `resolveLlmClient` 返回 `LlmChatClient | null`。
 */

// 普通工具超时:含 fetch_url/search_papers 等网络工具(打第三方 API/抓慢站),
// 60s 易被慢网络/慢 API 掐断 → 放宽到 120s(超时审计建议)。
export const TOOL_TIMEOUT_MS = 120_000;
// M3 hotfix: deep_research 内部轮询子 run；给 costHint='high' 工具更宽松超时(6 分钟),
// 避免父 run 在子 run 完成前误触重试,孤儿化子 run。
export const HIGH_COST_TOOL_TIMEOUT_MS = 6 * 60_000;
/**
 * 子 run(deep_research/spawn_subagent 派生)自身的时间预算上限。
 * 嵌套约束:SUBAGENT_MAX_SECONDS(子预算) < 父轮询窗口 MAX_WAIT_MS < HIGH_COST_TOOL_TIMEOUT_MS。
 * 原值 120s 远小于父给的 5~6min,多轮抓取+合成的子研究员易被 budget-exhausted 截断、报告残缺。
 */
export const SUBAGENT_MAX_SECONDS = 300;

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tool timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

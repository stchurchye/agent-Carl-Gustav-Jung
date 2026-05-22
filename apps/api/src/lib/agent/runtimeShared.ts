/**
 * Agent runtime 内部 helpers — 跨 lifecycle / execute / reply / planGlue 共享的小工具。
 *
 * M1e task 1：从原 `runtime.ts`（762 行）拆出，零行为变更。
 * M1e task 11d：原 `resolveEffectiveApiKey`（DeepSeek-only）迁到 `runLlmClient.ts`
 *               的 `resolveEffectiveApiKeyForProvider`（per-provider），并改用
 *               `resolveLlmClient` 返回 `LlmChatClient | null`。
 */

export const TOOL_TIMEOUT_MS = 60_000;
// M3 hotfix: deep_research 内部轮询子 run 最长 5 分钟；给 costHint='high' 工具
// 一个更宽松的超时（6 分钟），避免父 run 在子 run 完成前误触重试，孤儿化子 run。
export const HIGH_COST_TOOL_TIMEOUT_MS = 6 * 60_000;

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

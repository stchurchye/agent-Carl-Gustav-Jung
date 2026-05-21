/**
 * Agent runtime 内部 helpers — 跨 lifecycle / execute / reply / planGlue 共享的小工具。
 *
 * M1e task 1：从原 `runtime.ts`（762 行）拆出，零行为变更。
 * M1e task 11d：原 `resolveEffectiveApiKey`（DeepSeek-only）迁到 `runLlmClient.ts`
 *               的 `resolveEffectiveApiKeyForProvider`（per-provider），并改用
 *               `resolveLlmClient` 返回 `LlmChatClient | null`。
 */

export const TOOL_TIMEOUT_MS = 60_000;

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

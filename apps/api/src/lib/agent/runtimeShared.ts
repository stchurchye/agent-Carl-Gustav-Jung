/**
 * Agent runtime 内部 helpers — 跨 lifecycle / execute / reply / planGlue 共享的小工具。
 *
 * M1e task 1：从原 `runtime.ts`（762 行）拆出，零行为变更。
 * - TOOL_TIMEOUT_MS / withTimeout：tool handler 超时兜底（task 11b/c 之后底层 fetch 也会接 ctx.signal，
 *   此处仍保留作为最后防线）。
 * - resolveEffectiveApiKey：当前仅解析 DeepSeek key（M1d T6 引入），M1e task 11d 会迁出到
 *   `runLlmClient.ts` 改为 per-provider 解析。在此之前两个调用方（runReply / runPlanGlue）共用。
 */
import * as store from './store.js';
import type { AgentRun } from './types.js';

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

/**
 * M1d Task 6：取出 worker 调 LLM 用的 effective key。
 * 优先级：run.apiKeySource='user' 且 user_api_key_enc 解密成功 → 用户 key；
 * 否则退回 server env DEEPSEEK_API_KEY。
 *
 * @internal M1e task 11d 会取代为 resolveLlmClient(run): Promise<LlmChatClient | null>
 */
export async function resolveEffectiveApiKey(
  run: AgentRun,
): Promise<string | undefined> {
  const serverKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (run.apiKeySource === 'user') {
    try {
      const sealed = await store.getUserApiKeyEnc(run.id);
      if (sealed) {
        const { openUserApiKey } = await import('./secretBox.js');
        const key = openUserApiKey(sealed).trim();
        if (key) return key;
      }
    } catch (e) {
      console.warn('[agent.resolveEffectiveApiKey] failed to open user key', e);
    }
  }
  return serverKey || undefined;
}

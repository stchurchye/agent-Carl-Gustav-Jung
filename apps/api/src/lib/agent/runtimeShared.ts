/**
 * Agent runtime 内部 helpers — 跨 lifecycle / execute / reply / planGlue 共享的小工具。
 *
 * M1e task 1：从原 `runtime.ts`（762 行）拆出，零行为变更。
 * M1e task 3：resolveEffectiveApiKey 加 user-facing notice surface（USER_KEY_MISSING /
 * USER_KEY_DECRYPT_FAILED / KEY_FALLBACK_TO_SERVER / NO_API_KEY），消化 M1d blocker 1+3。
 *
 * 设计说明：
 * - notice 每次 resolve 写一条会刷屏（planner + reply 各调 1 次），所以这里只在
 *   "状态变更"时 emit：第一次发现 user key 不可用 → 写 1 条；后续 resolve 命中同样路径
 *   不再重复。用 process-local Set 去重（runId 维度，进程重启会重新 emit 一次，
 *   可接受）。
 * - M1e task 11d 会把这层迁移到 `runLlmClient.ts` 并改 per-provider；届时一并刷新
 *   notice 去重 keying（按 runId+providerId）。
 */
import * as store from './store.js';
import type { AgentRun } from './types.js';
import { emitNotice } from './notices.js';

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
 * 每个 (runId, code) 在进程生命周期内最多 emit 一次。
 * @internal exported for tests to reset between cases.
 */
const _emittedNoticeKeys = new Set<string>();
export function _resetResolveKeyNoticeDedup(): void {
  _emittedNoticeKeys.clear();
}
async function emitOnce(
  runId: string,
  code: Parameters<typeof emitNotice>[0]['code'],
  payload: Omit<Parameters<typeof emitNotice>[0], 'runId' | 'code'>,
): Promise<void> {
  const key = `${runId}:${code}`;
  if (_emittedNoticeKeys.has(key)) return;
  _emittedNoticeKeys.add(key);
  await emitNotice({ runId, code, ...payload });
}

/**
 * M1d Task 6 + M1e Task 3：取出 worker 调 LLM 用的 effective key。
 *
 * 优先级 / fallback：
 *   1. run.apiKeySource='user' 且 sealed 解密成功 → 用户 key（happy path）
 *   2. run.apiKeySource='user' 但 sealed = null   → emit USER_KEY_MISSING (warn) + 用 server key
 *   3. run.apiKeySource='user' 但解密 throw       → emit USER_KEY_DECRYPT_FAILED (warn) + 用 server key
 *   4. server key 也没有                          → emit NO_API_KEY (error) + return undefined
 *
 * @internal M1e task 11d 会取代为 resolveLlmClient(run): Promise<LlmChatClient | null>
 */
export async function resolveEffectiveApiKey(
  run: AgentRun,
): Promise<string | undefined> {
  const serverKey = process.env.DEEPSEEK_API_KEY?.trim();

  if (run.apiKeySource === 'user') {
    const sealed = await store.getUserApiKeyEnc(run.id);
    if (!sealed) {
      await emitOnce(run.id, 'USER_KEY_MISSING', {
        severity: 'warn',
        message: '你选择了用自己的 DeepSeek key，但服务端未保存（请检查 AGENT_KEY_SECRET 配置或重新填写）。本次跑用服务端 key。',
      });
    } else {
      try {
        const { openUserApiKey } = await import('./secretBox.js');
        const key = openUserApiKey(sealed).trim();
        if (key) return key;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[agent.resolveEffectiveApiKey] failed to open user key', msg);
        await emitOnce(run.id, 'USER_KEY_DECRYPT_FAILED', {
          severity: 'warn',
          message: '你的 DeepSeek key 解密失败（可能因为服务端密钥已轮换），本次跑退回服务端 key。请到设置里重新填写。',
          context: { error: msg },
        });
      }
    }
  }

  if (!serverKey) {
    await emitOnce(run.id, 'NO_API_KEY', {
      severity: 'error',
      message: '没有可用的 DeepSeek key（既无用户配置也无服务端 env）。Agent 将走 fallback 路径。',
    });
    return undefined;
  }
  return serverKey;
}

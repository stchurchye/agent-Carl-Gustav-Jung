/**
 * Agent runtime → LLM 桥接层（M1e Task 11d）。
 *
 * 负责：
 * 1. 按 run.providerId 选 provider，按 run.modelId 选 model
 * 2. per-provider 取 effective key（user sealed → fallback server env）
 * 3. 用户面 notice 化所有 fallback / 失败路径
 * 4. 返回 LlmChatClient | null —— null 时 caller 走 echo / 模板 fallback
 *
 * 取代了原 `runtimeShared.resolveEffectiveApiKey`（DeepSeek-only），但 后者
 * 暂时保留供尚未迁移的调用点 + 让 M1d 老 fixtures 不需要立刻改。
 *
 * Notice 去重策略：(runId, providerId, code) 维度，process-local **bounded LRU**，
 * 进程重启会再 emit 一次，可接受。
 *
 * M1e review followup：原来用裸 `Set<string>`，长跑 worker 里 runId 不断累加 → 内存
 * 无界增长。改成 LRU + cap 防止泄漏（同时保留 dedup 语义）。
 */

import * as store from './store.js';
import type { AgentRun } from './types.js';
import { emitNotice } from './notices.js';
import { buildLlmClient } from '../llm/factory.js';
import type { LlmChatClient, LlmProviderId } from '../llm/types.js';

/**
 * @internal 简单 LRU：Map 保留插入顺序，超过 cap 时淘汰最早的 key。
 * cap=10000 → 即便每 run 触发 4-5 个不同 code 也能容纳 2000 个 run，远大于
 * worker 单 tick 处理量；老的 runId 早就 terminal 了，淘汰它们的 dedup-key
 * 不会重复 emit notice（因为 terminal run 不会再被 resolve）。
 */
const EMIT_CACHE_CAP = 10000;
const _emittedKeys = new Map<string, true>();
export function _resetRunLlmClientNoticeDedup(): void {
  _emittedKeys.clear();
}

async function emitOnce(
  runId: string,
  providerId: LlmProviderId,
  code: Parameters<typeof emitNotice>[0]['code'],
  payload: Omit<Parameters<typeof emitNotice>[0], 'runId' | 'code'>,
): Promise<void> {
  const key = `${runId}:${providerId}:${code}`;
  if (_emittedKeys.has(key)) {
    // bump to most-recently-used
    _emittedKeys.delete(key);
    _emittedKeys.set(key, true);
    return;
  }
  _emittedKeys.set(key, true);
  if (_emittedKeys.size > EMIT_CACHE_CAP) {
    // 删除最早插入的 key（Map iterator 顺序 = 插入顺序）
    const oldest = _emittedKeys.keys().next().value;
    if (oldest !== undefined) _emittedKeys.delete(oldest);
  }
  await emitNotice({ runId, code, ...payload });
}

function serverKeyEnvFor(providerId: LlmProviderId): string | undefined {
  if (providerId === 'deepseek') return process.env.DEEPSEEK_API_KEY?.trim() || undefined;
  if (providerId === 'zenmux') return process.env.ZENMUX_API_KEY?.trim() || undefined;
  return undefined;
}

async function loadSealedFor(
  runId: string,
  providerId: LlmProviderId,
): Promise<string | null> {
  if (providerId === 'deepseek') return store.getUserApiKeyEnc(runId);
  if (providerId === 'zenmux') return store.getUserZenmuxKeyEnc(runId);
  return null;
}

/**
 * 取 effective API key for the given (run, providerId)。
 *
 * 优先级：
 *   1. apiKeySource='user' 且 sealed 解密成功且非空 → user key（happy path）
 *   2. apiKeySource='user' 但 sealed=null            → emit USER_KEY_MISSING + fallback server
 *   3. apiKeySource='user' 但解密 throw 或空         → emit USER_KEY_DECRYPT_FAILED + fallback server
 *   4. server env 也没有                             → return undefined（caller emit NO_API_KEY）
 */
export async function resolveEffectiveApiKeyForProvider(
  run: AgentRun,
  providerId: LlmProviderId,
): Promise<string | undefined> {
  const serverKey = serverKeyEnvFor(providerId);

  if (run.apiKeySource === 'user') {
    const sealed = await loadSealedFor(run.id, providerId);
    if (!sealed) {
      await emitOnce(run.id, providerId, 'USER_KEY_MISSING', {
        severity: 'warn',
        message: `你选了自带 ${providerId} key，但服务端未保存（请检查 AGENT_KEY_SECRET 配置或重新填写）。本次跑用服务端 key。`,
        context: { providerId },
      });
    } else {
      try {
        const { openUserApiKey } = await import('./secretBox.js');
        const key = openUserApiKey(sealed).trim();
        if (key) return key;
        await emitOnce(run.id, providerId, 'USER_KEY_DECRYPT_FAILED', {
          severity: 'warn',
          message: `你的 ${providerId} key 解密成功但内容为空（可能存盘时出过错），本次跑退回服务端 key。`,
          context: { providerId, reason: 'empty_plaintext' },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[runLlmClient.resolveEffectiveApiKeyForProvider]', providerId, msg);
        await emitOnce(run.id, providerId, 'USER_KEY_DECRYPT_FAILED', {
          severity: 'warn',
          message: `你的 ${providerId} key 解密失败（可能因为服务端密钥已轮换），本次跑退回服务端 key。请到设置里重新填写。`,
          context: { providerId, error: msg },
        });
      }
    }
  }

  return serverKey;
}

/**
 * 给定 run，构造 LlmChatClient。Caller 用法：
 *
 *   const llm = await resolveLlmClient(run);
 *   if (!llm) return fallbackEcho(...);
 *   const result = await llm.chat(messages, { signal, log });
 *
 * 失败路径都会 emit notice，不需要 caller 二次 emit。
 */
export async function resolveLlmClient(
  run: AgentRun,
): Promise<LlmChatClient | null> {
  const providerId = run.providerId;
  const modelId = run.modelId;
  const apiKey = await resolveEffectiveApiKeyForProvider(run, providerId);

  if (!apiKey) {
    await emitOnce(run.id, providerId, 'NO_API_KEY', {
      severity: 'error',
      message: `没有可用的 ${providerId} key（既无用户配置也无服务端 env）。Agent 将走 fallback 路径。`,
      context: { providerId, modelId },
    });
    return null;
  }

  try {
    return buildLlmClient({ providerId, modelId, apiKey });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[runLlmClient.resolveLlmClient] buildLlmClient threw', providerId, modelId, msg);
    await emitOnce(run.id, providerId, 'NO_API_KEY', {
      severity: 'error',
      message: `LLM provider ${providerId} 初始化失败：${msg}`,
      context: { providerId, modelId, error: msg },
    });
    return null;
  }
}

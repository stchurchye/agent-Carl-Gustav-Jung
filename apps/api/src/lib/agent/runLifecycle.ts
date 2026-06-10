/**
 * Agent run lifecycle —— create / softComplete / cancel。
 *
 * M1e task 1：从原 `runtime.ts` 拆出，零行为变更。
 * 依赖关系：
 *   runLifecycle → runReply.buildFinalContent（softComplete 终稿）
 *   runLifecycle → runtimeRegistry.runControllers（cancelRun abort）
 *   runLifecycle → messageBridge（私聊 / 群聊占位写入）
 *   runLifecycle → secretBox（createAgentRun 密封 user key）
 */
import { getPool } from '../../db/client.js';
import * as store from './store.js';
import { agentHookBus } from './hooks.js';
import {
  DEFAULT_BUDGET,
  type AgentBudget,
  type AgentChannel,
  type AgentRole,
  type AgentRun,
  type CancelReason,
  type RunArtifact,
} from './types.js';
import {
  writePrivatePlaceholder,
  finalizePrivatePlaceholder,
  writeGroupPlaceholder,
  finalizeGroupPlaceholder,
} from './messageBridge.js';
import { runControllers } from './runtimeRegistry.js';
import { buildFinalContent } from './runReply.js';
import { buildRunSummary } from './runSummary.js';
import { killSandboxForRun } from './sandbox.js';
import { sealUserApiKeys } from './userApiKeys.js';
import { recordStep } from './stepRecorder.js';
import { collectReplyRefs, filterCitedRefs } from './replyGen.js';
import { toolRegistry } from './toolRegistry.js';
import { runEpisodicMemory } from '../memoryEpisodicWire.js';

export type CreateAgentRunInput = {
  ownerId: string;
  channel: AgentChannel;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  intentTurnId?: string;
  inputText: string;
  apiKey: string;
  apiKeySource: 'user' | 'server';
  budget?: AgentBudget;
  /**
   * M1e Task 11d：per-run LLM 选型。不传走 DB DEFAULT 'deepseek' / 'deepseek-v4-pro'。
   * `providerId='zenmux'` 时 `apiKey` 解释为 user ZenMux key（写到 user_zenmux_key_enc）。
   */
  providerId?: 'deepseek' | 'zenmux';
  modelId?: string;
  /** M2 Task 7A: per-service user-supplied API keys (E2B/FRED/Jina). Sealed before write. */
  userApiKeys?: Record<string, string>;
  /** M3 Task 4：子 run 的父 run ID（deep_research / spawn_subagent spawn 时填）。null/undefined 表示顶层 run。 */
  parentRunId?: string | null;
  /** M3-S1：子 agent 角色(决定工具子集)。默认 'generalist'(=researcher 只读集)。 */
  role?: AgentRole;
  /** M7：T3 queue 分支专用，决定 INSERT 的初始 status。默认 'draft'。 */
  initialStatus?: 'draft' | 'queued';
  /** M7：queued 时记录入队 N。 */
  queuePosition?: number;
  /**
   * M7：调用方已经在持锁事务里 INSERT 了 run 行（R13 闭环），
   * 传入时 createAgentRun 跳过 store.insertAgentRun，直接走 placeholder/updateRun 后续。
   */
  existingRun?: AgentRun;
  /**
   * M7 T7：占位写入方式。
   *   - 'default'：现有 writeGroupPlaceholder（human invoker + ai placeholder）
   *   - 'child_card'：deep_research 群聊子 run；走 writeGroupChildPlaceholder（仅 ai）
   * 未指定时默认 'default'。
   */
  surfaceMode?: 'default' | 'child_card';
};

export type CreateAgentRunResult = {
  run: AgentRun;
  userMessageId: string | null;
  placeholderMessageId: string | null;
  llmJobId: string | null;
};

export async function createAgentRun(
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult> {
  // M1d T6 + M1e T11d：把 user 主动提供的 key 加密落到 agent_runs。
  // - providerId='zenmux' → 落到 user_zenmux_key_enc
  // - providerId='deepseek'（或缺省）→ 落到 user_api_key_enc（M1d 老字段沿用）
  // AGENT_KEY_SECRET 没配 → 不存（worker 退回 server key）。
  const providerId = input.providerId; // undefined → DB DEFAULT 'deepseek'
  let userApiKeyEnc: string | null = null;
  let userZenmuxKeyEnc: string | null = null;
  if (input.apiKeySource === 'user' && input.apiKey) {
    try {
      const { isSecretBoxAvailable, sealUserApiKey } = await import('./secretBox.js');
      if (isSecretBoxAvailable()) {
        const sealed = sealUserApiKey(input.apiKey);
        if (providerId === 'zenmux') userZenmuxKeyEnc = sealed;
        else userApiKeyEnc = sealed;
      } else {
        console.warn(
          '[agent.createAgentRun] AGENT_KEY_SECRET not set; user-provided key dropped, worker will fall back to server key.',
        );
      }
    } catch (e) {
      console.warn('[agent.createAgentRun] failed to seal user api key', e);
    }
  }

  const userApiKeysSealedRaw = sealUserApiKeys(input.userApiKeys ?? {});
  const userApiKeysEnc =
    Object.keys(userApiKeysSealedRaw).length > 0
      ? (userApiKeysSealedRaw as Record<string, string>)
      : undefined;

  // M7：existingRun 已由调用方在持锁事务里 INSERT（R13），跳过重复 INSERT。
  const run = input.existingRun ?? await store.insertAgentRun({
    ownerId: input.ownerId,
    channel: input.channel,
    sessionId: input.sessionId ?? null,
    groupId: input.groupId ?? null,
    topicId: input.topicId ?? null,
    intentTurnId: input.intentTurnId ?? null,
    role: input.role ?? 'generalist',
    status: input.initialStatus ?? 'draft',
    inputText: input.inputText,
    budget: input.budget ?? DEFAULT_BUDGET,
    apiKeyOwnerId: input.apiKeySource === 'user' ? input.ownerId : null,
    apiKeySource: input.apiKeySource,
    userApiKeyEnc,
    userZenmuxKeyEnc,
    providerId,
    modelId: input.modelId,
    userApiKeysEnc,
    parentRunId: input.parentRunId ?? null,
    queuePosition: input.queuePosition ?? null,
  });

  let userMessageId: string | null = null;
  let placeholderMessageId: string | null = null;
  let llmJobId: string | null = null;

  if (input.channel === 'private' && input.sessionId) {
    const bridge = await writePrivatePlaceholder({
      userId: input.ownerId,
      sessionId: input.sessionId,
      inputText: input.inputText,
      agentRunId: run.id,
    });
    userMessageId = bridge.userMessageId;
    placeholderMessageId = bridge.placeholderMessageId;
    const updated = await store.updateAgentRun(run.id, {
      resultMessageId: placeholderMessageId,
    });
    return {
      run: updated ?? run,
      userMessageId,
      placeholderMessageId,
      llmJobId,
    };
  }

  if (input.channel === 'group' && input.groupId && input.topicId) {
    // M7 T7：child_card 走无 invoker 的子卡片占位；default 保持原行为。
    const surfaceMode = input.surfaceMode ?? 'default';
    let bridge: {
      invokeMessageId: string;
      placeholderAiMessageId: string;
      llmJobId: string;
    };
    if (surfaceMode === 'child_card') {
      if (!input.parentRunId) {
        throw new Error('surfaceMode=child_card requires parentRunId');
      }
      const { writeGroupChildPlaceholder } = await import('./messageBridge.js');
      bridge = await writeGroupChildPlaceholder({
        parentRunId: input.parentRunId,
        parentOwnerId: input.ownerId,
        childRunId: run.id,
        groupId: input.groupId,
        topicId: input.topicId,
        childInputText: input.inputText,
      });
    } else {
      bridge = await writeGroupPlaceholder({
        userId: input.ownerId,
        groupId: input.groupId,
        topicId: input.topicId,
        inputText: input.inputText,
        agentRunId: run.id,
      });
    }
    userMessageId = bridge.invokeMessageId || null;
    placeholderMessageId = bridge.placeholderAiMessageId;
    llmJobId = bridge.llmJobId;
    const updated = await store.updateAgentRun(run.id, {
      invokeMessageId: bridge.invokeMessageId || null,
      resultMessageId: placeholderMessageId,
    });
    return {
      run: updated ?? run,
      userMessageId,
      placeholderMessageId,
      llmJobId,
    };
  }

  return { run, userMessageId, placeholderMessageId, llmJobId };
}

/**
 * 群聊 finalize 需要 llmJobId。M1b-1 简化做法：从 group_messages.payload 反查
 * （writeGroupPlaceholder 把它写在 payload.agentRun.llmJobId）。
 */
export async function lookupGroupLlmJobId(messageId: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT payload->'agentRun'->>'llmJobId' AS job_id
     FROM group_messages WHERE id = $1`,
    [messageId],
  );
  return (rows[0]?.job_id as string | null) ?? null;
}

export async function softComplete(
  run: AgentRun,
  status: 'completed' | 'budget_exhausted' | 'failed' | 'cancelled',
  detail?: string,
): Promise<void> {
  const finalContent = await buildFinalContent(run, status, detail);

  if (run.resultMessageId) {
    if (run.channel === 'private') {
      await finalizePrivatePlaceholder({
        messageId: run.resultMessageId,
        finalContent,
        status,
      });
    } else if (run.channel === 'group') {
      const llmJobId = await lookupGroupLlmJobId(run.resultMessageId);
      if (llmJobId) {
        await finalizeGroupPlaceholder({
          ownerId: run.ownerId,
          llmJobId,
          placeholderAiMessageId: run.resultMessageId,
          finalContent,
          status,
        });
      }
    }
  } else if (run.parentRunId && status === 'completed') {
    // M3 hotfix: 子 run（no resultMessageId，有 parentRunId）无法写入 chat placeholder，
    // LLM 合成内容会丢失。追加一条 synthesized=true 的 reply step，让 deep_research
    // 轮询结束后能读到完整报告而非简易 fallback digest。
    await recordStep({
      runId: run.id,
      kind: 'reply',
      output: { content: finalContent, synthesized: true },
    });
  }

  // M2 Task 1B: free E2B sandbox on terminal status (no-op if run never called run_python)
  await killSandboxForRun(run.id);

  // M4 Task 4：算 summary 并合并进 status update —— failed / cancelled / budget_exhausted
  // 同样落 summary，让任务面板列表能统一显示"做了什么"。
  const stepsForSummary = await store.listSteps(run.id);
  // P0-S7:toolMap 建一次给 buildRunSummary 与 collectReplyRefs 共用(免默认参数重建)。
  const toolMap = new Map(toolRegistry.list().map((t) => [t.name, t]));
  const summary = buildRunSummary(stepsForSummary, toolMap);

  // M5A Task 1: Build artifact for all terminal states.
  // Uses same toolRegistry as generateFinalReply for consistent ref extraction.
  // R4-2:url 资源只保留终稿真引用([n])的;无标记/越界 fail-open 全保留;产物类恒保留。
  const refs = filterCitedRefs(finalContent, collectReplyRefs(stepsForSummary, toolMap));
  const artifact: RunArtifact = {
    finalContent,
    refs,
    model: {
      providerId: run.providerId ?? 'deepseek',
      modelId: run.modelId ?? 'deepseek-v4-pro',
    },
    producedAt: new Date().toISOString(),
  };

  await store.updateAgentRun(run.id, {
    status,
    endedAt: new Date(),
    summary,
    artifact,
  });

  // Emit terminal hook event with the latest run snapshot (including endedAt).
  const latest = (await store.getAgentRun(run.id)) ?? run;
  if (status === 'completed') {
    agentHookBus.emitEvent({ type: 'run.completed', run: latest });
  } else if (status === 'failed') {
    agentHookBus.emitEvent({
      type: 'run.failed',
      run: latest,
      error: detail ?? finalContent,
    });
  } else if (status === 'cancelled') {
    agentHookBus.emitEvent({
      type: 'run.cancelled',
      run: latest,
      byUserId: latest.cancelledByUserId,
    });
  } else if (status === 'budget_exhausted') {
    agentHookBus.emitEvent({
      type: 'run.budget_exhausted',
      run: latest,
      resource: detail ?? 'unknown',
    });
  }

  // 情景记忆(plan §M2b/M3):completed run 收尾蒸馏事实 → 写新/取代旧/跳过重复。
  // 全程 fail-open(runEpisodicMemory 内部已兜 + 这里再兜),绝不影响 run finalize。
  // owner 锁 run-owner(群聊不跨成员 §5.2);reply 已在前面 finalize,不阻塞用户感知延迟。
  if (status === 'completed') {
    try {
      const { resolveLlmClient } = await import('./runLlmClient.js');
      const llm = await resolveLlmClient(run);
      if (llm) {
        const signal = runControllers.get(run.id)?.signal ?? new AbortController().signal;
        const log = {
          userId: run.ownerId,
          channel: 'memory_extract' as const,
          sessionId: run.sessionId ?? undefined,
        };
        await runEpisodicMemory({
          ownerId: run.ownerId,
          runId: run.id,
          sessionId: run.sessionId,
          topicId: run.topicId,
          transcript: `用户:${run.inputText}\n助手:${finalContent}`,
          llm,
          signal,
          log,
          // K5:研究蒸馏材料 —— 仅父 run(子 run 的引用经 S1 回流父 run,父收尾统一蒸,
          // 防父子双蒸同源);refs 用上方已算好的 artifact.refs(终稿真引用)。
          ...(run.parentRunId
            ? {}
            : {
                research: {
                  refs,
                  finalContent,
                  channel: run.channel,
                  groupId: run.groupId,
                },
              }),
        });

        // 技能自蒸馏(self-improvement loop):成功多步父 run 收尾把"这类任务怎么做"沉淀成
        // enabled=false 的 user-scope topic_skill(待人评审)。子 agent(parentRunId)不自蒸馏。
        // runEpisodicMemory 仅在 abort 时 throw(普通失败内部 fail-open),故能走到这里 = 未取消。
        if (!run.parentRunId) {
          const { distillSkillFromRun } = await import('./skillDistill.js');
          await distillSkillFromRun({
            ownerId: run.ownerId,
            runId: run.id,
            inputText: run.inputText,
            finalContent,
            steps: stepsForSummary,
            llm,
            signal,
            log,
          });
        }
      }
    } catch {
      // fail-open:情景记忆 / 技能蒸馏任何失败绝不影响 run finalize
    }
  }

  // M7：群聊 run 终态 → 释放 slot，触发同 topic 队首 dequeue。
  if (run.channel === 'group' && run.topicId) {
    const { dequeueNextOnTopic } = await import('./topicCoord.js');
    await dequeueNextOnTopic(run.topicId);
  }
}

// ─── M3 Task 3: resumeAgentRun ────────────────────────────────────────────────

export type ResumeAgentRunInput = {
  runId: string;
  userInput: string;
};

/**
 * 校验 run 处于 awaiting_user_input，把用户回答写成一条 observe step，
 * 清空 pendingUserPrompt / pendingUserStepIdx，将 status 切回 running。
 */
export async function resumeAgentRun(
  input: ResumeAgentRunInput,
): Promise<{ run: AgentRun }> {
  const run = await store.getAgentRun(input.runId);
  if (!run) throw new Error(`run not found: ${input.runId}`);
  if (run.status !== 'awaiting_user_input') {
    throw new Error(
      `run ${input.runId} is not awaiting user input (status=${run.status})`,
    );
  }
  const trimmed = input.userInput.trim();
  if (!trimmed) throw new Error('userInput cannot be empty');

  // M3 hotfix：使用 'user_input' 而非 'observe'。
  // 'observe' 会被 recordReclaimIfNeeded 计入 dbAdvancing，导致 completedCount
  // 多算 1，executor 重入后跳过 ask_user 之后紧跟的那个 plan step（BLOCKER）。
  // 'user_input' 不在 advancing 过滤集中，只作上下文日志，不推进 plan 指针。
  await recordStep({
    runId: run.id,
    kind: 'user_input',
    toolName: 'ask_user',
    output: { userInput: trimmed, resumedFromStepIdx: run.pendingUserStepIdx },
  });

  await store.updateAgentRun(run.id, {
    status: 'running',
    pendingUserPrompt: null,
    pendingUserStepIdx: null,
    // M4 review fix：清掉过期时间戳，避免 stale 字段在 UI 或 worker 层被误读。
    pendingUserInputExpiresAt: null,
  });

  const updated = await store.getAgentRun(run.id);
  return { run: updated! };
}

// ─── cancelRun ────────────────────────────────────────────────────────────────

export async function cancelRun(
  runId: string,
  byUserId: string,
  reasonOverride?: CancelReason,
): Promise<void> {
  const controller = runControllers.get(runId);
  if (controller) {
    controller.abort('user_cancel');
  } else {
    // M2 Task 1B: best-effort sandbox cleanup on dead-worker cancel path.
    // When no active controller exists the worker never reaches softComplete (which normally
    // calls killSandboxForRun), so we must kill it here to avoid a sandbox leak.
    await killSandboxForRun(runId);
  }
  const run = await store.getAgentRun(runId);
  if (!run) return;
  if (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'budget_exhausted'
  ) {
    return;
  }
  // M4 review fix (critical)：user_timeout 竞态防护。
  // worker SELECT 到过期 awaiting_user_input 之后、cancelRun 执行之前，
  // 用户可能已经 resume（status 已变回 'running'）。
  // 只有 run 仍在 awaiting_user_input 时才允许 user_timeout 取消；
  // 其他原因（'user' / 'steer'）不做此限制，保持原有语义。
  if (reasonOverride === 'user_timeout' && run.status !== 'awaiting_user_input') {
    return;
  }
  // M4 review fix：idle-path cancel（无 controller）不经过 softComplete，
  // 需要在这里计算 summary，保证所有 terminal status 都有 summary 落库。
  const stepsForSummary = await store.listSteps(runId);
  // P0-S7:toolMap 建一次共用(同 softComplete)。
  const toolMap = new Map(toolRegistry.list().map((t) => [t.name, t]));
  const summary = buildRunSummary(stepsForSummary, toolMap);

  // M5A Task 1: Build artifact for idle-path cancel (no active controller).
  const refs = collectReplyRefs(stepsForSummary, toolMap);
  const artifact: RunArtifact = {
    finalContent: '[任务已取消]',
    refs,
    model: {
      providerId: run.providerId ?? 'deepseek',
      modelId: run.modelId ?? 'deepseek-v4-pro',
    },
    producedAt: new Date().toISOString(),
  };

  await store.updateAgentRun(runId, {
    status: 'cancelled',
    cancelledByUserId: byUserId,
    cancelReason: reasonOverride ?? 'user',
    endedAt: new Date(),
    summary,
    artifact,
  });
  const latest = (await store.getAgentRun(runId)) ?? run;
  agentHookBus.emitEvent({
    type: 'run.cancelled',
    run: latest,
    byUserId,
  });
  if (run.resultMessageId) {
    if (run.channel === 'private') {
      await finalizePrivatePlaceholder({
        messageId: run.resultMessageId,
        finalContent: '[任务已取消]',
        status: 'cancelled',
      });
    } else if (run.channel === 'group') {
      const llmJobId = await lookupGroupLlmJobId(run.resultMessageId);
      if (llmJobId) {
        await finalizeGroupPlaceholder({
          ownerId: run.ownerId,
          llmJobId,
          placeholderAiMessageId: run.resultMessageId,
          finalContent: '[任务已取消]',
          status: 'cancelled',
        });
      }
    }
  }

  // M7：cancelled 也是 terminal，释放 slot 触发队首 dequeue。
  // （dequeueNextOnTopic 幂等：提为 draft 后该 run 即算 blocking，softComplete 再调时 no-op。）
  if (run.channel === 'group' && run.topicId) {
    const { dequeueNextOnTopic } = await import('./topicCoord.js');
    await dequeueNextOnTopic(run.topicId);
  }
}

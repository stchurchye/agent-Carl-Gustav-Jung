import type {
  ContextSelection,
  IntentExecuteResult,
  IntentKind,
  MemoryIntentSlots,
} from '@xzz/shared';
import { resolveZenmuxChatModel } from '@xzz/shared';
import { applyMemoryIntent } from './memoryApply.js';
import { prepareChatContext } from './contextPipeline.js';
import { invokeGroupLlm } from './groupLlm.js';
import { zenmuxChatFromMessages } from './zenmux.js';
import { compactHistoryViaLlm } from './contextCompact.js';
import { salvageMemoriesBeforeCompact } from './memoryPreCompact.js';
import { ingestMagiContent, queryMagiSystem } from './integrations/magi.js';
import type { IntentChannel } from './intentAnalyzer.js';
import * as pg from '../store/pg.js';
import * as social from '../store/pg-social.js';
import { DEFAULT_BUDGET, type AgentRun } from './agent/types.js';

export type { IntentExecuteResult };

export type AgentOptions = {
  /** M1e Task 12：per-run LLM provider 选型，由 mobile "我的"页设置传过来 */
  providerId?: 'deepseek' | 'zenmux';
  /** modelId 必须是该 provider 的合法 id（前端校验，后端透传） */
  modelId?: string;
};

export type ExecuteIntentInput = {
  userId: string;
  text: string;
  kind: IntentKind;
  channel: IntentChannel;
  slots?: MemoryIntentSlots;
  targetFragmentId?: string;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  apiKey: string;
  deepseekApiKey?: string;
  /**
   * @deprecated M1e review followup：原来是 header-or-env 混合值，会把 server key
   * 误当 user key 加密落库。已废弃，新代码请用 `userDeepseekKey` / `userZenmuxKey`。
   * 暂时保留是因为有测试还在用，下次清理。
   */
  zenmuxApiKey?: string;
  /**
   * M1e review followup: **只在 user 真正传 header 时**才有值。worker 会把它 sealed
   * 落到 `agent_runs.user_api_key_enc`（providerId=deepseek 时）。
   */
  userDeepseekKey?: string;
  /** 同 userDeepseekKey，但对应 providerId=zenmux，落到 user_zenmux_key_enc。 */
  userZenmuxKey?: string;
  model?: string;
  dialect?: import('@xzz/shared').ReplyDialect;
  contextSelection?: ContextSelection;
  selectedMessageIds?: string[];
  /** M1e Task 12: agent-only options (per-run provider/model). */
  agentOptions?: AgentOptions;
};

async function persistPrivateToolReply(
  userId: string,
  sessionId: string,
  userText: string,
  confirmation: string,
): Promise<IntentExecuteResult> {
  const userMsg = (await pg.addChatMessage(userId, sessionId, 'user', userText))!;
  const assistantMsg = (await pg.addChatMessage(
    userId,
    sessionId,
    'assistant',
    confirmation,
  ))!;
  return {
    type: 'tool',
    userMessage: userMsg,
    assistantMessage: assistantMsg,
    confirmation,
  };
}

async function persistGroupToolReply(
  userId: string,
  groupId: string,
  topicId: string,
  userText: string,
  confirmation: string,
): Promise<IntentExecuteResult> {
  const userMsg = await social.addGroupMessage(userId, groupId, topicId, {
    kind: 'human',
    content: userText,
  });
  if (!userMsg) {
    throw new Error('Failed to persist user group message');
  }
  const sysMsg = await social.addGroupMessage(userId, groupId, topicId, {
    kind: 'system',
    content: confirmation,
  });
  if (!sysMsg) {
    throw new Error('Failed to persist system confirmation');
  }
  return {
    type: 'tool',
    groupMessages: [userMsg, sysMsg],
    confirmation,
  };
}

async function compactPrivateSession(
  userId: string,
  sessionId: string,
  apiKey: string,
  dialect?: import('@xzz/shared').ReplyDialect,
): Promise<string> {
  const session = await pg.getChatSession(userId, sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');
  const allMessages = await pg.getChatMessages(userId, sessionId);
  if (allMessages.length === 0) {
    return '当前对话还没有可压缩的历史消息。';
  }
  const turns = allMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    id: m.id,
  }));
  await salvageMemoriesBeforeCompact({
    apiKey,
    userId,
    messages: turns,
    scope: 'session',
    sessionId,
    log: { userId, channel: 'memory_extract', sessionId },
  });
  const summary = await compactHistoryViaLlm({
    apiKey,
    messages: turns,
    existingSummary: session.contextSummary ?? null,
    dialect,
  });
  const lastId = allMessages[allMessages.length - 1]?.id ?? null;
  await pg.updateChatSessionContext(userId, sessionId, summary, lastId);
  return '已整理并压缩对话上下文，后续回复会优先参考摘要。';
}

/**
 * M7：把 createAgentRun 的 user key 密封逻辑提前跑一次，避免 withTopicCoordination
 * 持锁的 critical section 内做加密 IO 拉长锁时长。返回可直接展开给 insertAgentRunInTx。
 */
async function sealUserApiKeysForInsert(opts: {
  apiKey: string;
  apiKeySource: 'user' | 'server';
  providerId?: 'deepseek' | 'zenmux';
  userApiKeys?: Record<string, string>;
}): Promise<{
  userApiKeyEnc?: string | null;
  userZenmuxKeyEnc?: string | null;
  userApiKeysEnc?: Record<string, string>;
}> {
  let userApiKeyEnc: string | null = null;
  let userZenmuxKeyEnc: string | null = null;
  if (opts.apiKeySource === 'user' && opts.apiKey) {
    try {
      const { isSecretBoxAvailable, sealUserApiKey } = await import('./agent/secretBox.js');
      if (isSecretBoxAvailable()) {
        const sealed = sealUserApiKey(opts.apiKey);
        if (opts.providerId === 'zenmux') userZenmuxKeyEnc = sealed;
        else userApiKeyEnc = sealed;
      }
    } catch {
      /* seal 失败 → worker 退回 server key，不阻塞建 run */
    }
  }
  const { sealUserApiKeys } = await import('./agent/userApiKeys.js');
  const sealedRaw = sealUserApiKeys(opts.userApiKeys ?? {});
  const userApiKeysEnc =
    Object.keys(sealedRaw).length > 0
      ? (sealedRaw as Record<string, string>)
      : undefined;
  return { userApiKeyEnc, userZenmuxKeyEnc, userApiKeysEnc };
}

export async function executeIntent(
  input: ExecuteIntentInput,
): Promise<IntentExecuteResult> {
  const slots: MemoryIntentSlots = {
    ...input.slots,
    targetFragmentId: input.targetFragmentId ?? input.slots?.targetFragmentId,
  };

  const memCtx = {
    userId: input.userId,
    sessionId: input.sessionId,
    groupId: input.groupId,
    topicId: input.topicId,
    apiKey: input.deepseekApiKey,
  };

  if (
    input.kind === 'persona_open_settings' ||
    input.kind === 'app_navigate'
  ) {
    return { type: 'skipped', reason: 'CLIENT_NAVIGATE' };
  }

  if (input.kind === 'persona_rename') {
    const target = slots.renameTarget;
    const name = slots.renameName?.trim().slice(0, 20);
    if (!target || !name) return { type: 'skipped', reason: 'RENAME_MISSING_SLOTS' };
    const { updatePersonaSettings } = await import('../store/pg-profile.js');
    const patch =
      target === 'assistant'
        ? { identity: { assistantName: name } }
        : { user: { preferredName: name } };
    const confirmation =
      target === 'assistant'
        ? `汪！记住了，我以后就叫「${name}」！`
        : `好嘞，以后就叫你「${name}」！`;
    if (input.channel === 'private') {
      if (!input.sessionId) return { type: 'skipped', reason: 'RENAME_REQUIRES_SESSION' };
      const persona = await updatePersonaSettings(input.userId, patch);
      const res = await persistPrivateToolReply(
        input.userId,
        input.sessionId,
        input.text,
        confirmation,
      );
      return { ...res, personaUpdated: persona };
    }
    if (!input.groupId || !input.topicId) {
      return { type: 'skipped', reason: 'RENAME_REQUIRES_GROUP_TOPIC' };
    }
    const persona = await updatePersonaSettings(input.userId, patch);
    const res = await persistGroupToolReply(
      input.userId,
      input.groupId,
      input.topicId,
      input.text,
      confirmation,
    );
    return { ...res, personaUpdated: persona };
  }

  if (input.kind === 'agent_run') {
    const { createAgentRun } = await import('./agent/runtime.js');
    const providerId = input.agentOptions?.providerId; // undefined → DB default 'deepseek'
    // M1e review followup：**只取 user-source 的 key**（即 caller 用 userDeepseekKey
    // / userZenmuxKey 显式传过来的）；server env key 由 worker 端 runLlmClient 取，
    // 永远不会被错误地加密落到 user_*_key_enc 列。
    const userKey =
      providerId === 'zenmux' ? input.userZenmuxKey : input.userDeepseekKey;
    // 给 createAgentRun 的 apiKey 仅在 apiKeySource='user' 时被使用；source='server'
    // 时 createAgentRun 不会读它，但需要传一个 string 占位 → 给 ''（落库为 null）。
    const apiKey = userKey ?? '';
    const apiKeySource: 'user' | 'server' = userKey ? 'user' : 'server';
    const modelId = input.agentOptions?.modelId;

    if (input.channel === 'private') {
      if (!input.sessionId) {
        return { type: 'skipped', reason: 'AGENT_PRIVATE_REQUIRES_SESSION' };
      }
      const r = await createAgentRun({
        ownerId: input.userId,
        channel: 'private',
        sessionId: input.sessionId,
        inputText: input.text,
        apiKey,
        apiKeySource,
        providerId,
        modelId,
      });
      return {
        type: 'agent',
        runId: r.run.id,
        userMessageId: r.userMessageId,
        placeholderMessageId: r.placeholderMessageId,
      };
    }

    if (input.channel === 'group') {
      if (!input.groupId || !input.topicId) {
        return { type: 'skipped', reason: 'AGENT_GROUP_REQUIRES_GROUP_TOPIC' };
      }
      const groupId = input.groupId;
      const topicId = input.topicId;

      // M7 T3：withTopicCoordination 持锁事务内决策 + INSERT → commit 后做 placeholder/hook。
      const { withTopicCoordination, acquireTopicSlot } =
        await import('./agent/topicCoord.js');
      const {
        applyMergeInTx,
        insertAgentRunInTx,
        MergeTargetTerminalError,
        getMergedInputCounts,
        getAgentRun,
      } = await import('./agent/store.js');
      const { getUserById } = await import('../store/pg-profile.js');
      const { agentHookBus } = await import('./agent/hooks.js');
      const { getPool } = await import('../db/client.js');

      // 提前密封 user key，让 critical section 内仅做 INSERT。
      const sealedKeys = await sealUserApiKeysForInsert({
        apiKey,
        apiKeySource,
        providerId,
      });

      type SlotResult =
        | { kind: 'merge'; targetRunId: string; mergedByUserId?: string }
        | { kind: 'fresh'; run: AgentRun }
        | { kind: 'queue'; run: AgentRun; precedingCount: number };

      let slot: SlotResult | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          slot = await withTopicCoordination(topicId, async (client) => {
            const decision = await acquireTopicSlot(
              { channel: 'group', topicId, ownerId: input.userId, parentRunId: null },
              client,
            );
            if (decision.action === 'merge') {
              const profile = await getUserById(input.userId);
              const byUsername =
                profile?.displayName ?? profile?.username ?? input.userId;
              await applyMergeInTx(
                decision.targetRunId,
                {
                  text: input.text,
                  byUserId: input.userId,
                  byUsername,
                  at: new Date().toISOString(),
                },
                client,
              );
              return {
                kind: 'merge' as const,
                targetRunId: decision.targetRunId,
                mergedByUserId: decision.mergedByUserId,
              };
            }
            const initialStatus = decision.action === 'queue' ? 'queued' : 'draft';
            const run = await insertAgentRunInTx(client, {
              ownerId: input.userId,
              channel: 'group',
              sessionId: null,
              groupId,
              topicId,
              intentTurnId: null,
              role: 'generalist',
              status: initialStatus,
              inputText: input.text,
              budget: DEFAULT_BUDGET,
              apiKeyOwnerId: apiKeySource === 'user' ? input.userId : null,
              apiKeySource,
              ...sealedKeys,
              providerId,
              modelId,
              parentRunId: null,
              queuePosition:
                decision.action === 'queue' ? decision.precedingCount : null,
            });
            return decision.action === 'queue'
              ? { kind: 'queue' as const, run, precedingCount: decision.precedingCount }
              : { kind: 'fresh' as const, run };
          });
          break; // 成功，跳出 retry
        } catch (err) {
          if (err instanceof MergeTargetTerminalError && attempt === 0) {
            continue; // 目标 run 在 merge 事务期间转 terminal，重判
          }
          throw err;
        }
      }
      if (!slot) throw new Error('agent run slot acquisition failed after retry');

      // ====== 锁已释放：以下都是非互斥后续工作 ======
      if (slot.kind === 'merge') {
        const counts = await getMergedInputCounts(slot.targetRunId);
        const targetRun = await getAgentRun(slot.targetRunId);
        if (targetRun && counts) {
          agentHookBus.emitEvent({
            type: 'run.merged_input_appended',
            runId: slot.targetRunId,
            mergedInputsCount: counts.total,
          });
        }
        // 写 1 条 invoker 群消息（人类发言），指向原 run。
        const invoke = await social.addGroupMessage(input.userId, groupId, topicId, {
          kind: 'human',
          content: input.text,
        });
        if (invoke) {
          await getPool().query(
            `UPDATE group_messages
               SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
                 'agentRun', jsonb_build_object(
                   'agentRunId', $2::text,
                   'role', 'merged_invoker',
                   'mergedByUserId', $3::text
                 )
               )
             WHERE id = $1`,
            [invoke.id, slot.targetRunId, input.userId],
          );
        }
        return {
          type: 'agent',
          runId: slot.targetRunId,
          userMessageId: invoke?.id ?? null,
          placeholderMessageId: null,
          mergedIntoRunId: slot.targetRunId,
        };
      }

      // queue / fresh：复用 createAgentRun 后半段写 placeholder / 联动 worker（跳过重复 INSERT）。
      const r = await createAgentRun({
        ownerId: input.userId,
        channel: 'group',
        groupId,
        topicId,
        inputText: input.text,
        apiKey,
        apiKeySource,
        providerId,
        modelId,
        existingRun: slot.run,
      });
      if (slot.kind === 'queue') {
        return {
          type: 'agent',
          runId: r.run.id,
          userMessageId: r.userMessageId,
          placeholderMessageId: r.placeholderMessageId,
          queued: true,
          queuePosition: slot.precedingCount,
        };
      }
      return {
        type: 'agent',
        runId: r.run.id,
        userMessageId: r.userMessageId,
        placeholderMessageId: r.placeholderMessageId,
      };
    }

    return { type: 'skipped', reason: 'AGENT_UNSUPPORTED_CHANNEL' };
  }

  if (
    input.kind === 'memory_remember' ||
    input.kind === 'memory_correct' ||
    input.kind === 'memory_forget'
  ) {
    const { confirmation } = await applyMemoryIntent(input.kind, slots, memCtx);

    if (input.channel === 'private' && input.sessionId) {
      const userMsg = (await pg.addChatMessage(
        input.userId,
        input.sessionId,
        'user',
        input.text,
      ))!;
      const assistantMsg = (await pg.addChatMessage(
        input.userId,
        input.sessionId,
        'assistant',
        confirmation,
      ))!;
      return {
        type: 'memory',
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        confirmation,
      };
    }

    if (input.channel === 'group' && input.groupId && input.topicId) {
      const groupResult = await persistGroupToolReply(
        input.userId,
        input.groupId,
        input.topicId,
        input.text,
        confirmation,
      );
      if (groupResult.type === 'tool') {
        return {
          type: 'memory',
          groupMessages: groupResult.groupMessages,
          confirmation,
        };
      }
      return { type: 'memory', confirmation };
    }

    return { type: 'memory', confirmation };
  }

  if (input.kind === 'context_compact') {
    if (!input.sessionId || input.channel !== 'private') {
      return { type: 'skipped', reason: 'COMPACT_PRIVATE_ONLY' };
    }
    const dsKey = input.deepseekApiKey ?? input.apiKey;
    const confirmation = await compactPrivateSession(
      input.userId,
      input.sessionId,
      dsKey,
      input.dialect,
    );
    return persistPrivateToolReply(
      input.userId,
      input.sessionId,
      input.text,
      confirmation,
    );
  }

  if (input.kind === 'magi_system_query') {
    const answer = await queryMagiSystem(input.text);
    const confirmation = answer?.trim()
      ? `知识库查询结果：\n${answer.trim()}`
      : '知识库暂无相关结果。';
    if (input.channel === 'private' && input.sessionId) {
      return persistPrivateToolReply(
        input.userId,
        input.sessionId,
        input.text,
        confirmation,
      );
    }
    if (input.channel === 'group' && input.groupId && input.topicId) {
      return persistGroupToolReply(
        input.userId,
        input.groupId,
        input.topicId,
        input.text,
        confirmation,
      );
    }
    return { type: 'tool', confirmation };
  }

  if (input.kind === 'magi_content_link') {
    const url = input.text.match(/https?:\/\/\S+/)?.[0];
    if (!url) return { type: 'skipped', reason: 'NO_URL' };
    const card = await ingestMagiContent(url);
    const confirmation = card?.title
      ? `已处理链接：${card.title}`
      : '链接已提交处理。';
    if (input.channel === 'private' && input.sessionId) {
      return persistPrivateToolReply(
        input.userId,
        input.sessionId,
        input.text,
        confirmation,
      );
    }
    if (input.channel === 'group' && input.groupId && input.topicId) {
      return persistGroupToolReply(
        input.userId,
        input.groupId,
        input.topicId,
        input.text,
        confirmation,
      );
    }
    return { type: 'tool', confirmation };
  }

  if (input.kind === 'human_group_message') {
    if (!input.groupId || !input.topicId) {
      return { type: 'skipped', reason: 'MISSING_GROUP' };
    }
    const msg = await social.addGroupMessage(
      input.userId,
      input.groupId,
      input.topicId,
      { kind: 'human', content: input.text },
    );
    if (!msg) return { type: 'skipped', reason: 'FORBIDDEN' };
    return { type: 'group_human', message: msg };
  }

  if (input.kind === 'chat_group_llm') {
    if (!input.groupId || !input.topicId) {
      return { type: 'skipped', reason: 'MISSING_GROUP' };
    }
    const model = resolveZenmuxChatModel(input.model);
    const { message, invokeMessage } = await invokeGroupLlm({
      userId: input.userId,
      groupId: input.groupId,
      topicId: input.topicId,
      apiKey: input.apiKey,
      model,
      instruction: input.text,
      selectedMessageIds: input.selectedMessageIds,
      contextSelection: input.contextSelection,
      dialect: input.dialect,
    });
    return { type: 'group', invokeMessage, aiMessage: message };
  }

  if (input.kind === 'chat_private_llm') {
    if (!input.sessionId) return { type: 'skipped', reason: 'MISSING_SESSION' };
    const model = resolveZenmuxChatModel(input.model);
    const prepared = await prepareChatContext({
      userId: input.userId,
      apiKey: input.apiKey,
      sessionId: input.sessionId,
      pendingUser: input.text,
      dialect: input.dialect,
      contextSelection: input.contextSelection,
    });
    const llmStarted = Date.now();
    const llm = await zenmuxChatFromMessages(input.apiKey, model, prepared.messages, {
      log: {
        userId: input.userId,
        channel: 'intent_execute',
        sessionId: input.sessionId,
        contextRatio: prepared.usage.ratio,
      },
    });
    const responseTimeMs = Date.now() - llmStarted;
    const userMsg = (await pg.addChatMessage(
      input.userId,
      input.sessionId,
      'user',
      input.text,
    ))!;
    const assistantMsg = (await pg.addChatMessage(
      input.userId,
      input.sessionId,
      'assistant',
      llm.content,
      {
        llmReply: {
          model,
          totalTokens: llm.usage.totalTokens,
          promptTokens: llm.usage.promptTokens,
          completionTokens: llm.usage.completionTokens,
          responseTimeMs,
        },
      },
    ))!;
    return { type: 'chat', userMessage: userMsg, assistantMessage: assistantMsg };
  }

  return { type: 'skipped', reason: 'UNSUPPORTED_KIND' };
}

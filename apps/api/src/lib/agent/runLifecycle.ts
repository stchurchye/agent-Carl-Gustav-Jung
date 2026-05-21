/**
 * Agent run lifecycle —— create / softComplete / cancel / confirm。
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
  type AgentRun,
} from './types.js';
import {
  writePrivatePlaceholder,
  finalizePrivatePlaceholder,
  writeGroupPlaceholder,
  finalizeGroupPlaceholder,
} from './messageBridge.js';
import { runControllers } from './runtimeRegistry.js';
import { buildFinalContent } from './runReply.js';

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
  // M1d T6：把 user 主动提供的 DeepSeek key 加密落到 agent_runs，worker 后台
  // 再用同一把 key 调 LLM。AGENT_KEY_SECRET 没配 → 不存（worker 退回 server key）。
  let userApiKeyEnc: string | null = null;
  if (input.apiKeySource === 'user' && input.apiKey) {
    try {
      const { isSecretBoxAvailable, sealUserApiKey } = await import('./secretBox.js');
      if (isSecretBoxAvailable()) {
        userApiKeyEnc = sealUserApiKey(input.apiKey);
      } else {
        console.warn(
          '[agent.createAgentRun] AGENT_KEY_SECRET not set; user-provided DeepSeek key dropped, worker will fall back to server key.',
        );
      }
    } catch (e) {
      console.warn('[agent.createAgentRun] failed to seal user api key', e);
    }
  }

  const run = await store.insertAgentRun({
    ownerId: input.ownerId,
    channel: input.channel,
    sessionId: input.sessionId ?? null,
    groupId: input.groupId ?? null,
    topicId: input.topicId ?? null,
    intentTurnId: input.intentTurnId ?? null,
    role: 'generalist',
    status: 'draft',
    inputText: input.inputText,
    budget: input.budget ?? DEFAULT_BUDGET,
    apiKeyOwnerId: input.apiKeySource === 'user' ? input.ownerId : null,
    apiKeySource: input.apiKeySource,
    userApiKeyEnc,
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
    const bridge = await writeGroupPlaceholder({
      userId: input.ownerId,
      groupId: input.groupId,
      topicId: input.topicId,
      inputText: input.inputText,
      agentRunId: run.id,
    });
    userMessageId = bridge.invokeMessageId;
    placeholderMessageId = bridge.placeholderAiMessageId;
    llmJobId = bridge.llmJobId;
    const updated = await store.updateAgentRun(run.id, {
      invokeMessageId: bridge.invokeMessageId,
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
  }

  await store.updateAgentRun(run.id, {
    status,
    endedAt: new Date(),
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
}

export async function cancelRun(
  runId: string,
  byUserId: string,
): Promise<void> {
  const controller = runControllers.get(runId);
  if (controller) controller.abort('user_cancel');
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
  await store.updateAgentRun(runId, {
    status: 'cancelled',
    cancelledByUserId: byUserId,
    cancelReason: 'user',
    endedAt: new Date(),
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
}

export async function confirmRun(runId: string): Promise<void> {
  const run = await store.getAgentRun(runId);
  if (!run || run.status !== 'awaiting_confirm') return;
  await store.updateAgentRun(runId, { status: 'running' });
}

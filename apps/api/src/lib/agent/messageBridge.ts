import { getPool } from '../../db/client.js';
import * as pg from '../../store/pg.js';
import * as social from '../../store/pg-social.js';
import * as intel from '../../store/pg-intelligence.js';

export type PrivatePlaceholderResult = {
  userMessageId: string;
  placeholderMessageId: string;
};

export type GroupPlaceholderResult = {
  invokeMessageId: string;
  placeholderAiMessageId: string;
  llmJobId: string;
};

/**
 * 在私聊 session 里写入 user message + assistant placeholder。
 *
 * `private_chat_messages` 的真实 schema 把整条 ChatMessage 存进 `payload` jsonb
 * （`payload->>'content'` / `payload->>'role'`），没有独立的 content 列。
 * 因此 placeholder 的 `agentRun` 元数据也合并写入 `payload`：
 *   payload.agentRun = { agentRunId, status: 'draft' }
 * 前端可据此识别这是一条 agent run 占位消息。
 */
export async function writePrivatePlaceholder(params: {
  userId: string;
  sessionId: string;
  inputText: string;
  agentRunId: string;
}): Promise<PrivatePlaceholderResult> {
  const userMsg = await pg.addChatMessage(
    params.userId,
    params.sessionId,
    'user',
    params.inputText,
  );
  if (!userMsg) throw new Error('failed to write user message');

  const placeholderContent = '[Agent 任务进行中…]';
  const placeholder = await pg.addChatMessage(
    params.userId,
    params.sessionId,
    'assistant',
    placeholderContent,
  );
  if (!placeholder) throw new Error('failed to write placeholder message');

  await getPool().query(
    `UPDATE private_chat_messages
     SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
       'agentRun', jsonb_build_object('agentRunId', $2::text, 'status', 'draft')
     )
     WHERE id = $1`,
    [placeholder.id, params.agentRunId],
  );

  return {
    userMessageId: userMsg.id,
    placeholderMessageId: placeholder.id,
  };
}

/**
 * 任务终态时更新 placeholder 的 content + agentRun.status。
 * content 存在 `payload->>'content'`，同时更新 payload.agentRun.status。
 */
export async function finalizePrivatePlaceholder(params: {
  messageId: string;
  finalContent: string;
  status: 'completed' | 'failed' | 'cancelled' | 'budget_exhausted';
}): Promise<void> {
  await getPool().query(
    `UPDATE private_chat_messages
     SET payload = COALESCE(payload, '{}'::jsonb)
       || jsonb_build_object('content', $2::text)
       || jsonb_build_object(
            'agentRun',
            COALESCE(payload->'agentRun', '{}'::jsonb)
              || jsonb_build_object('status', $3::text)
          )
     WHERE id = $1`,
    [params.messageId, params.finalContent, params.status],
  );
}

/**
 * 群聊 agent_run 起跑：
 * 1) 建 llm_invoke_jobs（status='pending'）以便前端旧的 invoke-job 渠道感知
 * 2) 写 `human` kind 群消息承载用户原文，payload.agentRun 注入 { agentRunId, role: 'invoker', llmJobId }
 * 3) 写 `ai` kind 群消息作为占位，payload.agentRun 注入 { agentRunId, status: 'draft', llmJobId }
 *
 * `group_messages.payload` 由 addGroupMessage 整条 GroupMessage JSON 化写入，
 * 这里再 UPDATE 一次合并 agentRun 字段（payload || jsonb_build_object）。
 */
export async function writeGroupPlaceholder(params: {
  userId: string;
  groupId: string;
  topicId: string;
  inputText: string;
  agentRunId: string;
}): Promise<GroupPlaceholderResult> {
  // Step 1: 先建 llm job 拿 jobId
  const job = await intel.createLlmJob({
    ownerId: params.userId,
    invokerUserId: params.userId,
    groupId: params.groupId,
    topicId: params.topicId,
    payload: { agentRunId: params.agentRunId, kind: 'agent' },
  });

  // Step 2: 用户发起消息（human kind）
  const invoke = await social.addGroupMessage(
    params.userId,
    params.groupId,
    params.topicId,
    {
      kind: 'human',
      content: params.inputText,
      jobId: job.id,
      invokerUserId: params.userId,
    },
  );
  if (!invoke) throw new Error('failed to write group invoke message');

  await getPool().query(
    `UPDATE group_messages
     SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
       'agentRun',
       jsonb_build_object(
         'agentRunId', $2::text,
         'role', 'invoker',
         'llmJobId', $3::text
       )
     )
     WHERE id = $1`,
    [invoke.id, params.agentRunId, job.id],
  );

  // Step 3: placeholder ai message
  const placeholder = await social.addGroupMessage(
    params.userId,
    params.groupId,
    params.topicId,
    {
      kind: 'ai',
      content: '[Agent 任务进行中…]',
      jobId: job.id,
      invokerUserId: params.userId,
    },
  );
  if (!placeholder) throw new Error('failed to write group placeholder');

  await getPool().query(
    `UPDATE group_messages
     SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
       'agentRun',
       jsonb_build_object(
         'agentRunId', $2::text,
         'status', 'draft',
         'llmJobId', $3::text
       )
     )
     WHERE id = $1`,
    [placeholder.id, params.agentRunId, job.id],
  );

  return {
    invokeMessageId: invoke.id,
    placeholderAiMessageId: placeholder.id,
    llmJobId: job.id,
  };
}

/**
 * 群聊任务终态：同时更新 placeholderAi 的 content/agentRun.status，以及 llm_invoke_jobs.status。
 * agent 的 cancelled/failed/budget_exhausted 都映射到 LlmJobStatus 'failed'；completed → 'done'。
 */
export async function finalizeGroupPlaceholder(params: {
  ownerId: string;
  llmJobId: string;
  placeholderAiMessageId: string;
  finalContent: string;
  status: 'completed' | 'failed' | 'cancelled' | 'budget_exhausted';
}): Promise<void> {
  await getPool().query(
    `UPDATE group_messages
     SET payload = COALESCE(payload, '{}'::jsonb)
       || jsonb_build_object('content', $2::text)
       || jsonb_build_object(
            'agentRun',
            COALESCE(payload->'agentRun', '{}'::jsonb)
              || jsonb_build_object('status', $3::text)
          )
     WHERE id = $1`,
    [params.placeholderAiMessageId, params.finalContent, params.status],
  );

  const jobStatus: 'done' | 'failed' =
    params.status === 'completed' ? 'done' : 'failed';
  await intel.updateLlmJob(params.ownerId, params.llmJobId, {
    status: jobStatus,
    resultMessageId: params.placeholderAiMessageId,
  });
}

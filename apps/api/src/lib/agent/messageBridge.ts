import { getPool } from '../../db/client.js';
import * as pg from '../../store/pg.js';

export type PrivatePlaceholderResult = {
  userMessageId: string;
  placeholderMessageId: string;
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

/**
 * M3 Task 2：ask_user 工具。
 *
 * 当任务真正含糊（数据源不明 / 范围不清 / 多种合理解读并存）时，agent 调用
 * 该工具向用户提一个澄清问题。工具的返回 { ok:true, paused:true } 是给
 * runtime 看的暂停信号 —— runExecute 检测到后会把 run.status 切到
 * 'awaiting_user_input'，break 主循环；worker 不再 pickup，等 mobile 通过
 * resume API 写回答案后 status 才回到 'running'。
 *
 * 当前只支持 private channel —— 群聊语境下 ask_user 暂停语义还没设计（多人
 * 谁来回答？）所以直接返回 ok:false，让 planner 改用普通文本回复传达问题。
 *
 * 写消息走 private_chat_messages 直接 INSERT（与 messageBridge 里的
 * placeholder 写法一致），payload 里塞 type='agent_question' / question /
 * options / agentRunId / agentStepIdx，前端按 type 分支渲染。
 */
import { randomUUID } from 'crypto';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { getPool } from '../../../db/client.js';

type AskUserInput = {
  question: string;
  options?: string[];
};

type AskUserOutput = {
  ok: boolean;
  paused: boolean;
  messageId: string;
  error?: string;
};

export const askUserTool: ToolDef<AskUserInput, AskUserOutput> = {
  name: 'ask_user',
  description:
    'Pause the run and ask the user a clarifying question. Use ONLY when the task is genuinely ambiguous (missing data source, unclear scope, multiple valid interpretations). Do NOT use for "do you want me to continue?" — just continue. The run pauses until the user replies via the resume API; the reply will be appended as the next observation. Private channel only.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 1 },
      options: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: true,
  idempotent: false,
  replyMeta: {
    summaryKind: 'silent',
    failureHint:
      'ask_user 失败：仅在 channel=private 可用。在 group 中触发请改写一段澄清问题作为普通回复直接发出，不要再选 ask_user。',
  },
  async handler(input, ctx) {
    if (ctx.channel !== 'private') {
      return {
        ok: false,
        paused: false,
        messageId: '',
        error: 'ask_user only supported in private channel',
      };
    }
    const question = (input.question ?? '').trim();
    if (!question) {
      return {
        ok: false,
        paused: false,
        messageId: '',
        error: 'question cannot be empty',
      };
    }
    if (!ctx.sessionId) {
      return {
        ok: false,
        paused: false,
        messageId: '',
        error: 'ask_user requires a private chat session (ctx.sessionId missing)',
      };
    }

    const id = randomUUID();
    const createdAt = new Date();
    const payload = {
      id,
      sessionId: ctx.sessionId,
      role: 'assistant' as const,
      content: question,
      type: 'agent_question',
      question,
      options: input.options ?? [],
      agentRunId: ctx.runId,
      agentStepId: ctx.stepId,
      createdAt: createdAt.toISOString(),
    };

    try {
      const { rows } = await getPool().query(
        `INSERT INTO private_chat_messages (id, session_id, owner_id, payload, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING id`,
        [id, ctx.sessionId, ctx.ownerId, JSON.stringify(payload), createdAt],
      );
      const messageId = (rows[0]?.id as string) ?? id;
      return { ok: true, paused: true, messageId };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        paused: false,
        messageId: '',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerAskUser(): void {
  if (!toolRegistry.get(askUserTool.name)) {
    toolRegistry.register(askUserTool);
  }
}

import { Hono } from 'hono';
import {
  CHAT_LLM_MODEL_HEADER,
  ErrorCodes,
  REPLY_DIALECT_HEADER,
  resolveZenmuxChatModel,
} from '@xzz/shared';
import type { IntentKind, MemoryIntentSlots } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDeepSeekKey, getDeepSeekKeyWithSource } from '../lib/ai-handler.js';
import {
  getZenMuxKey,
  getZenMuxKeyWithSource,
  handleZenMuxError,
} from '../lib/zenmux-handler.js';
import { parseReplyDialect } from '../lib/deepseek.js';
import {
  analyzeIntentUnified,
  type IntentChannel,
} from '../lib/intentAnalyzer.js';
import { executeIntent } from '../lib/intentExecute.js';
import {
  parseContextSelectionFromBody,
} from '../lib/contextSelectionParse.js';

export const intentRouter = new Hono<{ Variables: AppVariables }>();

intentRouter.use('*', requireAuth);

intentRouter.post('/analyze', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    text?: string;
    channel?: IntentChannel;
    aiMode?: boolean;
    hasAttachments?: boolean;
    sessionId?: string;
    groupId?: string;
    topicId?: string;
  }>();

  const text = body.text?.trim() ?? '';
  if (!text) return jsonError(c, ErrorCodes.VALIDATION, 400);

  let deepseekApiKey: string | undefined;
  try {
    deepseekApiKey = getDeepSeekKey(c);
  } catch {
    deepseekApiKey = undefined;
  }

  const result = await analyzeIntentUnified({
    text,
    channel: body.channel ?? 'private',
    aiMode: body.aiMode !== false,
    hasAttachments: body.hasAttachments,
    apiKey: deepseekApiKey,
    userId,
    sessionId: body.sessionId,
    groupId: body.groupId,
    topicId: body.topicId,
  });

  return c.json({ ok: true, data: result, requestId: c.get('requestId') });
});

intentRouter.post('/execute', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    text?: string;
    kind?: IntentKind;
    slots?: MemoryIntentSlots;
    targetFragmentId?: string;
    channel?: IntentChannel;
    sessionId?: string;
    groupId?: string;
    topicId?: string;
    model?: string;
    selectedMessageIds?: string[];
    contextSelection?: import('@xzz/shared').ContextSelection;
    /** M1e Task 12: agent run per-call provider/model 选型 */
    agentOptions?: {
      providerId?: 'deepseek' | 'zenmux';
      modelId?: string;
    };
  }>();

  const text = body.text?.trim() ?? '';
  const kind = body.kind;
  if (!text || !kind) return jsonError(c, ErrorCodes.VALIDATION, 400);

  // chat / writing 流程一直要 ZenMux key;缺就 400。
  // persona_rename 是纯写库操作(不调任何 LLM),没配 key 也要能给狗改名。
  let apiKey: string;
  if (kind === 'persona_rename') {
    apiKey = '';
  } else {
    try {
      apiKey = getZenMuxKey(c);
    } catch (e) {
      return handleZenMuxError(c, e);
    }
  }

  // 老的 deepseekApiKey 字段：legacy 路径（memory / context）仍然继续读这个，
  // 它依旧是 header-or-env 的混合值（pre-existing 行为，不动）。
  let deepseekApiKey: string | undefined;
  try {
    deepseekApiKey = getDeepSeekKey(c);
  } catch {
    deepseekApiKey = undefined;
  }

  // M1e review followup：agent_run 路径必须能分辨"user header key" vs "server env key"，
  // 否则 server key 会被当作 user key 加密落到 agent_runs.user_api_key_enc。
  // 只有 source='user' 时才传 user-scoped 字段，否则 intentExecute 会推导成 'user'。
  const dsResolved = getDeepSeekKeyWithSource(c);
  const zmResolved = getZenMuxKeyWithSource(c);
  const userDeepseekKey =
    dsResolved?.source === 'user' ? dsResolved.key : undefined;
  const userZenmuxKey =
    zmResolved?.source === 'user' ? zmResolved.key : undefined;

  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
  const model = resolveZenmuxChatModel(
    body.model ?? c.req.header(CHAT_LLM_MODEL_HEADER),
  );

  try {
    const data = await executeIntent({
      userId,
      text,
      kind,
      slots: body.slots,
      targetFragmentId: body.targetFragmentId,
      channel: body.channel ?? 'private',
      sessionId: body.sessionId,
      groupId: body.groupId,
      topicId: body.topicId,
      apiKey,
      deepseekApiKey,
      // M1e review followup: 只传 user-source 的 key 给 agent；server env key 由
      // runLlmClient.resolveEffectiveApiKeyForProvider 在 worker 里独立取。
      userDeepseekKey,
      userZenmuxKey,
      model,
      dialect,
      contextSelection: parseContextSelectionFromBody(body),
      selectedMessageIds: body.selectedMessageIds,
      agentOptions: body.agentOptions,
    });
    return c.json({ ok: true, data, requestId: c.get('requestId') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'MEMORY_TARGET_REQUIRED' || msg === 'MEMORY_CONTENT_REQUIRED') {
      return jsonError(c, ErrorCodes.VALIDATION, 400);
    }
    if (msg === 'MEMORY_NOT_FOUND') {
      return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    }
    return handleZenMuxError(c, e);
  }
});

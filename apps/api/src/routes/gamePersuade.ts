import { Hono } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDeepSeekKey, handleAiError } from '../lib/ai-handler.js';
import { deepseekChatFromMessages, type ChatMessageInput } from '../lib/deepseek.js';
import { parsePersuadeVerdict } from '../lib/persuadeVerdict.js';
import { buildPersuadeSystemPrompt } from '../lib/persuadePrompt.js';

export const gamePersuadeRouter = new Hono<{ Variables: AppVariables }>();

gamePersuadeRouter.use('*', requireAuth);

type PersuadeBody = {
  demand?: string;
  personality?: string;
  stubbornness?: number;
  /** 狗的隐藏性情(中文招式名),驱动 LLM 的破绽与给分 */
  softSpot?: string;
  landmine?: string;
  history?: { role: 'dog' | 'player'; text: string }[];
  playerLine?: string;
};

gamePersuadeRouter.post('/persuade', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<PersuadeBody>();
  const demand = body.demand?.trim();
  const playerLine = body.playerLine?.trim();
  if (!demand || !playerLine) return jsonError(c, ErrorCodes.VALIDATION, 400);

  let apiKey: string;
  try {
    apiKey = getDeepSeekKey(c);
  } catch (e) {
    return handleAiError(c, e);
  }

  const historyMsgs: ChatMessageInput[] = (body.history ?? []).map((h) => ({
    role: h.role === 'dog' ? 'assistant' : 'user',
    content: h.text,
  }));

  let answer: string;
  try {
    answer = await deepseekChatFromMessages(
      apiKey,
      [
        {
          role: 'system',
          content: buildPersuadeSystemPrompt({
            demand,
            personality: body.personality,
            stubbornness: body.stubbornness ?? 6,
            softSpot: body.softSpot,
            landmine: body.landmine,
          }),
        },
        ...historyMsgs,
        { role: 'user', content: playerLine },
      ],
      { log: { userId, channel: 'other', requestId: c.get('requestId') } },
    );
  } catch (e) {
    return handleAiError(c, e);
  }

  // 服务端夹紧:无论 LLM 怎么被忽悠,scoreDelta 不出界(防一句秒赢)
  const verdict = parsePersuadeVerdict(answer);
  return c.json({ ok: true, data: verdict, requestId: c.get('requestId') });
});

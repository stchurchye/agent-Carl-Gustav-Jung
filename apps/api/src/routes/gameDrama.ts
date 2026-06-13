import { Hono } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDeepSeekKey, handleAiError } from '../lib/ai-handler.js';
import { deepseekChatFromMessages } from '../lib/deepseek.js';
import { buildDramaSayPrompt } from '../lib/dramaPrompt.js';
import { parseDramaVerdict } from '../lib/dramaVerdict.js';

export const gameDramaRouter = new Hono<{ Variables: AppVariables }>();

gameDramaRouter.use('*', requireAuth);

type SayBody = {
  npcName?: string;
  npcPersonality?: string;
  sceneContext?: string;
  intent?: string;
  playerLine?: string;
};

/** 判玩家这句台词是否达到当前戏剧意图 → {pass,reply,score,hint} */
gameDramaRouter.post('/say', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<SayBody>();
  const npcName = body.npcName?.trim();
  const sceneContext = body.sceneContext?.trim();
  const intent = body.intent?.trim();
  const playerLine = body.playerLine?.trim();
  if (!npcName || !sceneContext || !intent || !playerLine) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }

  let apiKey: string;
  try {
    apiKey = getDeepSeekKey(c);
  } catch (e) {
    return handleAiError(c, e);
  }

  let answer: string;
  try {
    answer = await deepseekChatFromMessages(
      apiKey,
      [
        {
          role: 'system',
          content: buildDramaSayPrompt({ npcName, npcPersonality: body.npcPersonality, sceneContext, intent }),
        },
        { role: 'user', content: playerLine },
      ],
      { log: { userId, channel: 'other', requestId: c.get('requestId') } },
    );
  } catch (e) {
    return handleAiError(c, e);
  }

  // 服务端夹紧分数并据此派生 pass(LLM 改不动)
  const verdict = parseDramaVerdict(answer);
  return c.json({ ok: true, data: verdict, requestId: c.get('requestId') });
});

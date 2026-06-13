import {
  chatPersonaSystem,
  diaryPromptForDialect,
  ZENMUX_CHAT_COMPACT_MODEL,
  type DiaryScope,
  type ReplyDialect,
  type UserPersonaSettings,
} from '@xzz/shared';
import { zenmuxChatFromMessages } from './zenmux.js';

export interface GenerateDiaryParams {
  apiKey: string;
  persona: UserPersonaSettings | undefined;
  dialect?: ReplyDialect | null;
  scope: DiaryScope;
  /** group 篇的群名,带进 prompt 让狗狗知道是在写哪个群 */
  scopeName?: string | null;
  /** 当天对话已格式化的 transcript(formatDiaryTranscript) */
  transcript: string;
  /** 增量/重写:已有日记,LLM 在其基础上更新 */
  existingSummary?: string | null;
}

/**
 * 用 Bow Wow 的语气把当天对话写成一篇日记。
 * system = chatPersonaSystem(注入狗名/语气) + diaryPromptForDialect(日记规则);
 * user = 当天 transcript(有 existingSummary 时走「更新」)。空 transcript 不调用 LLM。
 */
export async function generateDiarySummary(p: GenerateDiaryParams): Promise<string> {
  const transcript = p.transcript.trim();
  if (!transcript) return p.existingSummary?.trim() ?? '';

  const system = `${chatPersonaSystem(p.persona, p.dialect)}\n\n${diaryPromptForDialect(p.scope, p.dialect)}`;
  const existing = p.existingSummary?.trim();
  const head = p.scope === 'group' && p.scopeName ? `群名:${p.scopeName}\n\n` : '';
  const userContent = existing
    ? `已有日记:\n${existing}\n\n请结合下面今天新增/补充的对话,更新这篇日记(保留仍准确的内容、去重,不丢原有要点):\n\n${head}${transcript}`
    : `${head}今天的对话:\n\n${transcript}`;

  const raw = await zenmuxChatFromMessages(
    p.apiKey,
    ZENMUX_CHAT_COMPACT_MODEL,
    [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    { maxTokens: 600, temperature: 0.4 },
  );
  return raw.content.trim();
}

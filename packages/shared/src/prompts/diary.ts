import type { ReplyDialect } from './persona.js';
import type { DiaryScope } from '../diary.js';

/**
 * 日记 system prompt(追加在 chatPersonaSystem 之后,继承狗狗语气/名字)。
 * 第一人称狗狗视角写当天小结:个人篇=我和主人;群篇=我眼中今天这个群。
 */
export function diaryPromptForDialect(scope: DiaryScope, _dialect?: ReplyDialect | null): string {
  const subject =
    scope === 'group'
      ? '今天在这个群里的见闻(从你这只狗的视角:你看着主人和群友聊了些什么、你的观察和心情)'
      : '今天你陪主人聊的事';
  return `接下来请你换成「写日记」的口吻,给${subject}写一篇当天小结。
要求:
- 用第一人称(你这只狗)写,像写给自己看的日记,温暖、口语、带点狗狗的可爱劲儿
- 120~300 字;只写对话里真实出现过的事,绝不编造没发生的内容
- 抓住:主人今天的重点事、情绪、做的决定,以及你陪着做了什么
- 不要标题、不要 markdown,只输出日记正文`;
}

/** 把当天对话格式化成 transcript(speaker:content),供日记生成喂给 LLM。 */
export function formatDiaryTranscript(
  lines: Array<{ speaker: string; content: string }>,
): string {
  return lines
    .filter((l) => l.content.trim().length > 0)
    .map((l) => `${l.speaker}：${l.content.trim()}`)
    .join('\n\n');
}

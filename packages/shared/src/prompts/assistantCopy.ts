import type { ReplyDialect } from './persona.js';

/** 写作小助手首条欢迎语 */
export function assistantWelcomeLine(_dialect?: ReplyDialect | null): string {
  return '你好，我是写作小助手。在下面说说想怎么改，我先帮你确认意思，对了再改到文章里。';
}

export function assistantRejectConfirmLine(_dialect?: ReplyDialect | null): string {
  return '好的，你再说具体一点，我重新理解。';
}

export function assistantWorkingLine(_dialect?: ReplyDialect | null): string {
  return '好的，我这就按你说的去改，请稍候。';
}

export function assistantRevisionReadyLine(_dialect?: ReplyDialect | null): string {
  return '改稿建议已经准备好了，点下面看一看。';
}

export function writingDoneComment(
  action: string,
  _dialect?: ReplyDialect | null,
): string {
  return action === '续写'
    ? '续写了一段，你看看是否合适。'
    : '润色了一下，意思没变，读起来更顺了。';
}

export function writingRetryDoneComment(_dialect?: ReplyDialect | null): string {
  return '已按你的新意见又改了一版，请再看看。';
}

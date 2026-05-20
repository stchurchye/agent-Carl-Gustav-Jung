import { buildChapterTitle, DEFAULT_CHAPTER_TYPE } from './chapterTitle.js';

/** 按类型 + 序号生成默认段落标题，如「段·1」 */
export function formatChapterTitle(index: number, type = DEFAULT_CHAPTER_TYPE): string {
  return buildChapterTitle({ type, index: String(index + 1), note: '' });
}

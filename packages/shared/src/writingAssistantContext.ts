import type { Document } from './types.js';

export type WritingUnderstandingScope = 'chapter' | 'document';

const MAX_DOCUMENT_EXCERPT = 8000;
const MAX_CHAPTER_CONTENT = 3000;

/** 写作小助手：待改段 + 全篇节选（供 LLM 理解，改稿仍只改一段） */
export function buildWritingAssistantChapterContext(
  doc: Document,
  chapterId: string,
  chapterDraft?: string,
) {
  const chapters = [...doc.chapters].sort((a, b) => a.order - b.order);
  const active = chapters.find((c) => c.id === chapterId);
  const chapterTitle = active?.title ?? '当前段';
  const persisted = active?.blocks[0]?.content ?? '';
  const chapterContent = (chapterDraft ?? persisted).trim().slice(0, MAX_CHAPTER_CONTENT);

  const documentExcerpt = chapters
    .map((ch) => {
      const text = ch.blocks
        .map((b) => b.content.trim())
        .filter(Boolean)
        .join('\n');
      const label = ch.id === chapterId ? '【当前待改段】' : '';
      return `${label}${ch.title}\n${text || '（本段暂无正文）'}`;
    })
    .join('\n\n')
    .slice(0, MAX_DOCUMENT_EXCERPT);

  return {
    chapterId,
    chapterTitle,
    chapterContent,
    documentExcerpt,
    hasMultipleChapters: chapters.length > 1,
  };
}

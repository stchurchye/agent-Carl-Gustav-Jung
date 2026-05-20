import type { Document } from '@xzz/shared';
import { displayChapterTitle } from '@xzz/shared';
import { api } from './api';
import { getCachedDocument } from './writingCache';
import { zh } from '../locales/zh-CN';

export type ChapterPreviewRow = {
  chapterId: string;
  chapterTitle: string;
  preview: string;
  time?: string;
};

function chapterPreviewFromDoc(doc: Document, chapterId: string): ChapterPreviewRow | null {
  const ch = doc.chapters.find((c) => c.id === chapterId);
  if (!ch) return null;
  const block = ch.blocks[0];
  const body = block?.content?.trim() ?? '';
  return {
    chapterId: ch.id,
    chapterTitle: displayChapterTitle(ch.title),
    preview: body || zh.writing.empty,
    time: doc.updatedAt,
  };
}

export async function loadWritingChapterPreviews(
  documentId: string,
): Promise<ChapterPreviewRow[]> {
  let doc = getCachedDocument(documentId);
  if (!doc) {
    const res = await api.getDocument(documentId);
    doc = res.data;
  }

  const sorted = [...doc.chapters].sort((a, b) => b.order - a.order);
  const rows = sorted
    .map((ch) => chapterPreviewFromDoc(doc!, ch.id))
    .filter((r): r is ChapterPreviewRow => r !== null);

  return rows;
}

export function findChapterIdForBlock(doc: Document, blockId: string): string | undefined {
  for (const ch of doc.chapters) {
    if (ch.blocks.some((b) => b.id === blockId)) return ch.id;
  }
  return undefined;
}

import type { Block, Chapter, Document } from '../types.js';
import { formatChapterTitle } from './formatChapterTitle.js';

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function emptyBlock(): Block {
  return { id: newId('blk'), content: '', currentRevisionId: null };
}

function emptyChapter(order: number): Chapter {
  return {
    id: newId('ch'),
    title: formatChapterTitle(order),
    order,
    chapterSummary: '',
    blocks: [emptyBlock()],
  };
}

function normalizeBlock(block: Block | undefined | null): { block: Block; changed: boolean } {
  if (!block?.id) {
    return { block: emptyBlock(), changed: true };
  }
  const normalized: Block = {
    id: block.id,
    content: typeof block.content === 'string' ? block.content : '',
    currentRevisionId: block.currentRevisionId ?? null,
  };
  const changed =
    block.content !== normalized.content || block.currentRevisionId !== normalized.currentRevisionId;
  return { block: normalized, changed };
}

function normalizeChapter(ch: Chapter, idx: number): { chapter: Chapter; changed: boolean } {
  let changed = false;
  const order = typeof ch.order === 'number' ? ch.order : idx;
  const id = ch.id?.trim() ? ch.id : newId('ch');
  if (id !== ch.id) changed = true;

  const title = ch.title?.trim() ? ch.title : formatChapterTitle(order);
  if (title !== ch.title) changed = true;

  let blocks = Array.isArray(ch.blocks) ? ch.blocks : [];
  if (blocks.length === 0) {
    blocks = [emptyBlock()];
    changed = true;
  } else {
    const normalizedBlocks: Block[] = [];
    for (const raw of blocks) {
      const { block, changed: blockChanged } = normalizeBlock(raw);
      normalizedBlocks.push(block);
      if (blockChanged) changed = true;
    }
    blocks = normalizedBlocks;
  }

  const chapterSummary = typeof ch.chapterSummary === 'string' ? ch.chapterSummary : '';
  if (chapterSummary !== ch.chapterSummary) changed = true;

  const chapter: Chapter = {
    id,
    title,
    order,
    chapterSummary,
    blocks,
  };

  if (
    !changed &&
    (ch.order !== chapter.order ||
      ch.blocks.length !== chapter.blocks.length ||
      ch.blocks.some((b, i) => b.id !== chapter.blocks[i]?.id))
  ) {
    changed = true;
  }

  return { chapter, changed };
}

/** 保证文稿至少有一段，且每段至少有一个正文块（写作小助手依赖 blockId）。 */
export function normalizeWritingDocument(doc: Document): { doc: Document; changed: boolean } {
  let changed = false;
  let chapters = Array.isArray(doc.chapters) ? doc.chapters : [];

  if (chapters.length === 0) {
    chapters = [emptyChapter(0)];
    changed = true;
  } else {
    const next: Chapter[] = [];
    chapters.forEach((ch, idx) => {
      const { chapter, changed: chapterChanged } = normalizeChapter(ch, idx);
      next.push(chapter);
      if (chapterChanged) changed = true;
    });
    chapters = next;
  }

  if (!changed) return { doc, changed: false };
  return { doc: { ...doc, chapters }, changed: true };
}

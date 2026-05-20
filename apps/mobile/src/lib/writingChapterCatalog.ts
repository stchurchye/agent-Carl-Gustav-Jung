import type { Document } from '@xzz/shared';
import {
  DEFAULT_CHAPTER_TYPE,
  parseChapterTitle,
  WRITING_CHAPTER_TYPE_PRESETS,
  type ChapterTitleParts,
} from '@xzz/shared';
import { zh } from '../locales/zh-CN';

/** 左侧类型导航预设（买菜式分类） */
export const CHAPTER_TYPE_PRESETS = WRITING_CHAPTER_TYPE_PRESETS;

export type ChapterCatalogItem = {
  chapterId: string;
  type: string;
  index: string;
  note: string;
  preview: string;
  rawTitle: string;
};

export function listChapterTypes(doc: Document | null): string[] {
  const custom = new Set<string>();
  if (doc) {
    for (const ch of doc.chapters) {
      custom.add(parseChapterTitle(ch.title).type);
    }
  }
  const result: string[] = [];
  for (const preset of CHAPTER_TYPE_PRESETS) {
    result.push(preset);
    custom.delete(preset);
  }
  for (const t of custom) result.push(t);
  return result;
}

export function groupChaptersByType(doc: Document | null): Map<string, ChapterCatalogItem[]> {
  const map = new Map<string, ChapterCatalogItem[]>();
  if (!doc) return map;

  for (const ch of doc.chapters) {
    const { type, index, note } = parseChapterTitle(ch.title);
    const block = ch.blocks[0];
    const body = block?.content?.trim() ?? '';
    const item: ChapterCatalogItem = {
      chapterId: ch.id,
      type,
      index,
      note,
      preview: body || zh.writing.empty,
      rawTitle: ch.title,
    };
    const list = map.get(type) ?? [];
    list.push(item);
    map.set(type, list);
  }

  for (const list of map.values()) {
    list.sort((a, b) => compareChapterIndex(a.index, b.index));
  }
  return map;
}

function compareChapterIndex(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, 'zh-CN', { numeric: true });
}

export function nextChapterIndexForType(doc: Document, type: string): string {
  const indices = doc.chapters
    .map((ch) => parseChapterTitle(ch.title))
    .filter((p) => p.type === type)
    .map((p) => Number(p.index))
    .filter((n) => !Number.isNaN(n));
  const max = indices.length > 0 ? Math.max(...indices) : 0;
  return String(max + 1);
}

export function buildPartsForNewChapter(
  doc: Document,
  type: string,
  note = '',
): ChapterTitleParts {
  return {
    type: type.trim() || DEFAULT_CHAPTER_TYPE,
    index: nextChapterIndexForType(doc, type),
    note: note.trim(),
  };
}

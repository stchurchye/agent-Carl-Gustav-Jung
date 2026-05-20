/** 在章节正文末尾追加识图文字 */
export function appendTextToChapterEnd(existing: string, text: string): string {
  const sep = existing.length && !existing.endsWith('\n') ? '\n\n' : '';
  return existing + sep + text;
}

/** 在正文中指定光标位置插入文字 */
export function insertTextAtOffset(existing: string, offset: number, text: string): string {
  const safe = Math.max(0, Math.min(offset, existing.length));
  return existing.slice(0, safe) + text + existing.slice(safe);
}

export type OcrPlacementTarget = {
  documentId: string;
  chapterId: string;
  blockId: string;
};

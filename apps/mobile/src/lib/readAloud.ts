export type TextSelection = { start: number; end: number };

export type ReadPortionMode = 'all' | 'fromCursor' | 'selection';

/** 根据光标或选中范围决定朗读哪一段 */
export function pickReadPortion(
  fullText: string,
  selection: TextSelection,
): { text: string; mode: ReadPortionMode; startIndex: number } {
  const len = fullText.length;
  const start = Math.max(0, Math.min(selection.start, len));
  const end = Math.max(0, Math.min(selection.end, len));

  if (end > start) {
    return {
      text: fullText.slice(start, end),
      mode: 'selection',
      startIndex: start,
    };
  }

  if (start > 0) {
    return {
      text: fullText.slice(start),
      mode: 'fromCursor',
      startIndex: start,
    };
  }

  return {
    text: fullText,
    mode: 'all',
    startIndex: 0,
  };
}

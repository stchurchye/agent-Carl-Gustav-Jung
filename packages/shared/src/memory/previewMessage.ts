const PREVIEW_LEN = 120;

export function previewMessageText(text: string, maxLen = PREVIEW_LEN): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${[...t].slice(0, maxLen).join('')}…`;
}

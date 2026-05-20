export { memoryTitleFromContent } from '@xzz/shared';

/** 按 Unicode 码点截断（与 persona limits 一致） */
export function trimToMaxChars(text: string, max: number): string {
  const t = text.trim();
  if (!t) return '';
  const chars = [...t];
  if (chars.length <= max) return t;
  return `${chars.slice(0, max - 1).join('')}…`;
}

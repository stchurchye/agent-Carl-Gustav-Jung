/** 按 Unicode 码点截断标题 */
export function memoryTitleFromContent(content: string, max = 20): string {
  const t = content.trim();
  if (!t) return '记忆';
  const chars = [...t];
  if (chars.length <= max) return t;
  return `${chars.slice(0, max - 1).join('')}…`;
}

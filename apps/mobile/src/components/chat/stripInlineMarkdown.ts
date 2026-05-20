/** 选中/展示用：去掉行内 **粗体** 与 `代码` 标记，保留可读正文 */
export function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1');
}

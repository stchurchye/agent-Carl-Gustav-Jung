export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'mermaid'; code: string };

/** 支持语言行后可选换行，便于粘贴 ```mermaid graph LR 等单行开头 */
const FENCE_RE = /```([^\n`]*)\r?\n?([\s\S]*?)```/g;

/** 发送/粘贴前统一换行，避免 Windows 粘贴导致 fence 无法识别 */
export function normalizeChatMessageInput(raw: string): string {
  return raw.replace(/\r\n/g, '\n');
}

/** 将聊天正文拆成段落、代码块、mermaid 图 */
export function parseChatMessageContent(raw: string): ChatContentBlock[] {
  const input = normalizeChatMessageInput(raw);
  if (!input.trim()) return [{ type: 'text', text: '' }];

  const blocks: ChatContentBlock[] = [];
  let lastIndex = 0;
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FENCE_RE.exec(input)) !== null) {
    const before = input.slice(lastIndex, match.index);
    if (before) blocks.push({ type: 'text', text: before });
    const lang = (match[1] ?? '').trim().toLowerCase();
    const code = match[2].replace(/\n$/, '');
    if (lang === 'mermaid') {
      blocks.push({ type: 'mermaid', code });
    } else {
      blocks.push({ type: 'code', language: lang || 'text', code });
    }
    lastIndex = match.index + match[0].length;
  }

  const tail = input.slice(lastIndex);
  if (tail || blocks.length === 0) blocks.push({ type: 'text', text: tail });

  return blocks;
}

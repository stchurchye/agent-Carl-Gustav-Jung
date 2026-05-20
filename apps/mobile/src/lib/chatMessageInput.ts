import { normalizeChatMessageInput } from '@xzz/shared';

/** 发送前规范化换行等，保证 ``` 代码块 / mermaid 可被解析 */
export function prepareChatMessageForSend(text: string): string {
  return normalizeChatMessageInput(text).trim();
}

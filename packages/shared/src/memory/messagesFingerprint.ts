/** 会话消息指纹，用于判断是否需要重新自动提炼 */
export function messagesFingerprint(messages: { id: string }[]): string {
  const tail = messages.slice(-3).map((m) => m.id).join(',');
  return `${messages.length}:${tail}`;
}

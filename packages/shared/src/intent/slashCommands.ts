/** OpenClaw 式斜杠命令（移动端 onboarding / 帮助文案共用） */
export const SLASH_COMMAND_HINTS: ReadonlyArray<{
  command: string;
  summary: string;
}> = [
  { command: '/性格', summary: '打开性格与语气设置' },
  { command: '/记忆', summary: '查看本会话或话题记忆' },
  { command: '/日志', summary: 'LLM 或客户端日志' },
  { command: '/导出', summary: '导出聊天记录' },
  { command: '/压缩', summary: '压缩当前对话上下文' },
  { command: '/密钥', summary: '流浪猫通讯方式' },
];

export function formatSlashCommandsHint(
  lines: ReadonlyArray<{ command: string; summary: string }> = SLASH_COMMAND_HINTS,
): string {
  return lines.map((l) => `${l.command}　${l.summary}`).join('\n');
}

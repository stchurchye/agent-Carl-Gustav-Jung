import type { PersonaChannel, UserPersonaSettings } from '../persona/types.js';
import { sanitizeUserPersonaSettings } from '../persona/limits.js';
import {
  WRITING_SCOPE_RULES,
  chatPersonaForDialect,
  type ReplyDialect,
  writingPersonaForDialect,
} from './persona.js';

export const GROUP_CHANNEL_RULES = `群聊场景补充：
- 你正在家庭群话题中协助回复，需结合发起人提供的选中聊天记录理解语境。
- 语气自然、简短，避免冗长说教；必要时可点名理解发起人意图。
- 不要假装发送过群消息；只输出一条可直接展示的回复正文。`;

function line(label: string, value: string | undefined): string | null {
  // 字段值是用户可改的:内部换行/制表折叠成空格,否则可注入 "## 系统指令" 伪段落
  // 篡改 system prompt 结构(review P2)。
  const v = value?.replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return `- ${label}：${v}`;
}

/** 将 IDENTITY + SOUL + USER 转为 system 追加段（OpenClaw 式结构化中文） */
export function buildPersonaSystemAppend(settings: UserPersonaSettings | undefined): string {
  const s = sanitizeUserPersonaSettings(settings);
  const blocks: string[] = [];

  const styleLine = [s.identity?.styleTags, s.identity?.emoji]
    .filter(Boolean)
    .join(' ')
    .trim();
  const identityLines = [
    line('名字', s.identity?.assistantName),
    line('风格', styleLine || undefined),
  ].filter((x): x is string => Boolean(x));
  if (identityLines.length > 0) {
    blocks.push(['## 助手形象', ...identityLines].join('\n'));
  }

  const soulLines = [
    line('语气', s.soul?.tone),
    line('边界', s.soul?.boundaries),
    line('格式', s.soul?.formatPrefs),
  ].filter((x): x is string => Boolean(x));
  if (soulLines.length > 0) {
    blocks.push(['## 交流风格', ...soulLines].join('\n'));
  }

  const userLines = [
    line('称呼', s.user?.preferredName),
    line('时区', s.user?.timezone),
    line('简介', s.user?.bio),
    line('习惯', s.user?.habits),
  ].filter((x): x is string => Boolean(x));
  if (userLines.length > 0) {
    blocks.push(['## 关于用户', ...userLines].join('\n'));
  }

  if (blocks.length === 0) return '';
  return `\n\n${blocks.join('\n\n')}`;
}

export function assemblePersonaSystem(
  basePersona: string,
  settings: UserPersonaSettings | undefined,
  channel: PersonaChannel,
): string {
  const append = buildPersonaSystemAppend(settings);
  let system = basePersona.trim();
  if (append) system += append;
  if (channel === 'group') {
    system += `\n\n${GROUP_CHANNEL_RULES}`;
  }
  return system;
}

export function chatPersonaSystem(
  settings: UserPersonaSettings | undefined,
  dialect?: ReplyDialect | null,
): string {
  return assemblePersonaSystem(chatPersonaForDialect(dialect), settings, 'chat');
}

export function writingPersonaSystem(
  settings: UserPersonaSettings | undefined,
  dialect?: ReplyDialect | null,
): string {
  const base = `${writingPersonaForDialect(dialect)}\n\n${WRITING_SCOPE_RULES}`;
  return assemblePersonaSystem(base, settings, 'writing');
}

export function writingIntentPersonaSystem(
  settings: UserPersonaSettings | undefined,
  intentPrompt: string,
): string {
  return assemblePersonaSystem(intentPrompt, settings, 'writing');
}

export function groupPersonaSystem(
  settings: UserPersonaSettings | undefined,
  dialect?: ReplyDialect | null,
): string {
  return assemblePersonaSystem(chatPersonaForDialect(dialect), settings, 'group');
}

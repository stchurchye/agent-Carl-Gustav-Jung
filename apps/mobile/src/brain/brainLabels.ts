import type { LlmRequestChannel, MemoryCategory, MemoryFragmentStatus, MemoryScope } from '@xzz/shared';
import { LLM_REQUEST_CHANNEL_LABELS } from '@xzz/shared';
import { zh } from '../locales/zh-CN';

export function labelMemoryCategory(c: MemoryCategory | undefined): string {
  if (c === 'user_profile') return zh.me.memoryCategoryProfile;
  if (c === 'project_note') return zh.me.memoryCategoryProject;
  return zh.me.memoryCategoryGeneral;
}

export function labelMemoryScope(s: MemoryScope | undefined): string {
  if (s === 'user') return '用户长期';
  if (s === 'session') return '会话';
  if (s === 'topic') return '话题';
  if (s === 'group') return '群组';
  return s ?? '—';
}

export function labelMemoryStatus(s: MemoryFragmentStatus | undefined): string {
  if (s === 'active') return '已生效';
  if (s === 'pending') return '待确认';
  if (s === 'suppressed') return '已抑制';
  if (s === 'deleted') return '已删除';
  return s ?? '—';
}

export function labelSearchChannel(c: 'private' | 'group'): string {
  return c === 'private' ? '工作台私聊' : '群聊';
}

export function labelLlmChannel(c: LlmRequestChannel): string {
  return LLM_REQUEST_CHANNEL_LABELS[c] ?? c;
}

export function labelPersonaBlock(key: 'identity' | 'soul' | 'user'): string {
  return zh.brain.personaBlocks[key];
}

export function formatZhDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

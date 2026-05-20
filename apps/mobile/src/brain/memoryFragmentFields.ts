import type { MemoryFragment } from '@xzz/shared';
import {
  formatZhDateTime,
  labelMemoryCategory,
  labelMemoryScope,
  labelMemoryStatus,
} from './brainLabels';
import { zh } from '../locales/zh-CN';

export function memoryFragmentToFields(f: MemoryFragment) {
  const F = zh.brain.fields;
  return [
    { label: F.id, value: f.id },
    { label: F.scope, value: labelMemoryScope(f.scope) },
    { label: F.category, value: labelMemoryCategory(f.category) },
    { label: F.status, value: labelMemoryStatus(f.status) },
    { label: F.title, value: f.title },
    { label: F.content, value: f.content ?? '' },
    { label: F.currentVersionId, value: f.currentVersionId ?? '' },
    { label: F.sessionId, value: f.sessionId ?? '' },
    { label: F.topicId, value: f.topicId ?? '' },
    { label: F.groupId, value: f.groupId ?? '' },
    { label: F.ownerId, value: f.ownerId },
    { label: F.createdAt, value: formatZhDateTime(f.createdAt) },
    { label: F.updatedAt, value: formatZhDateTime(f.updatedAt) },
  ];
}

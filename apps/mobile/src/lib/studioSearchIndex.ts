import type { GroupListItem } from '@xzz/shared';
import type { WorkbenchSessionRow } from './privateChatPreview';
import { getCachedTabs, type CachedTab } from './writingCache';

export type StudioSearchKind = 'group' | 'privateChat' | 'writing';

export type StudioSearchItem = {
  id: string;
  kind: StudioSearchKind;
  title: string;
  subtitle: string;
  groupId?: string;
  groupName?: string;
  sessionId?: string;
  documentId?: string;
};

function includesQuery(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.toLowerCase());
}

export function buildStudioSearchIndex(
  groups: GroupListItem[],
  sessions: WorkbenchSessionRow[],
  writingTabs: CachedTab[],
  extras?: { writeTextTitle: string; writeTextPreview: string },
): StudioSearchItem[] {
  const items: StudioSearchItem[] = [];

  if (extras) {
    items.push({
      id: 'writing:hub',
      kind: 'writing',
      title: extras.writeTextTitle,
      subtitle: extras.writeTextPreview,
    });
  }

  for (const g of groups) {
    items.push({
      id: `group:${g.id}`,
      kind: 'group',
      title: g.name,
      subtitle: g.lastMessage?.preview ?? '',
      groupId: g.id,
      groupName: g.name,
    });
  }

  for (const s of sessions) {
    items.push({
      id: `chat:${s.id}`,
      kind: 'privateChat',
      title: s.title,
      subtitle: s.preview,
      sessionId: s.id,
    });
  }

  for (const tab of writingTabs) {
    items.push({
      id: `writing:${tab.id}`,
      kind: 'writing',
      title: tab.title,
      subtitle: '',
      documentId: tab.id,
    });
  }

  return items;
}

export function filterStudioSearchItems(
  items: StudioSearchItem[],
  query: string,
): StudioSearchItem[] {
  const q = query.trim();
  if (!q) return [];
  return items.filter(
    (item) => includesQuery(item.title, q) || (item.subtitle && includesQuery(item.subtitle, q)),
  );
}

export function loadStudioSearchIndexInputs() {
  return {
    writingTabs: getCachedTabs(),
  };
}

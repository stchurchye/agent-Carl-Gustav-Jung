import type { Document } from '@xzz/shared';

export type CachedTab = { id: string; title: string };

let cachedTabs: CachedTab[] = [];
const cachedDocs = new Map<string, Document>();

export function rememberTabs(tabs: CachedTab[]) {
  if (tabs.length > 0) cachedTabs = tabs;
}

export function getCachedTabs(): CachedTab[] {
  return cachedTabs;
}

export function rememberDocument(doc: Document) {
  cachedDocs.set(doc.id, doc);
}

export function getCachedDocument(id: string): Document | undefined {
  return cachedDocs.get(id);
}

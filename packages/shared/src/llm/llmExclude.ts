import { usesExclusionMode, type ContextSelection } from './contextPreview.js';

export type LlmExcludeMarker = {
  userId: string;
  displayName: string;
  markedAt: string;
};

export type LlmExcludeCanceledBy = {
  userId: string;
  displayName: string;
  canceledAt: string;
};

export type LlmExcludeMeta = {
  active: boolean;
  markers: LlmExcludeMarker[];
  canceledBy?: LlmExcludeCanceledBy | null;
  everCanceled: boolean;
};

export type LlmExcludeActor = {
  userId: string;
  displayName: string;
};

export function markLlmExclude(
  existing: LlmExcludeMeta | null | undefined,
  actor: LlmExcludeActor,
): LlmExcludeMeta {
  const now = new Date().toISOString();
  const markers = [...(existing?.markers ?? [])];
  if (!markers.some((m) => m.userId === actor.userId)) {
    markers.push({
      userId: actor.userId,
      displayName: actor.displayName,
      markedAt: now,
    });
  }
  return {
    active: true,
    markers,
    canceledBy: null,
    everCanceled: existing?.everCanceled ?? false,
  };
}

export function cancelLlmExclude(
  existing: LlmExcludeMeta | null | undefined,
  actor: LlmExcludeActor,
): LlmExcludeMeta {
  const now = new Date().toISOString();
  return {
    active: false,
    markers: existing?.markers ?? [],
    canceledBy: {
      userId: actor.userId,
      displayName: actor.displayName,
      canceledAt: now,
    },
    everCanceled: true,
  };
}

export function serverExcludedMessageIds(
  messages: Array<{ id: string; llmExclude?: LlmExcludeMeta | null }>,
): string[] {
  return messages.filter((m) => m.llmExclude?.active).map((m) => m.id);
}

export function mergeExcludedMessageIds(
  serverExcluded: string[],
  localSelection?: ContextSelection | null,
): string[] {
  const merged = new Set(serverExcluded);
  for (const id of localSelection?.excludedMessageIds ?? []) {
    merged.add(id);
  }
  if (
    !localSelection?.excludedMessageIds?.length &&
    localSelection?.selectedMessageIds?.length
  ) {
    return [...localSelection.selectedMessageIds];
  }
  return [...merged];
}

export function formatLlmExcludeMarkers(meta: LlmExcludeMeta): string {
  return meta.markers.map((m) => m.displayName).join('、');
}

/** 合并服务端协作标记与本地组装器排除名单 */
export function contextSelectionWithServerMarks<T extends { id: string; llmExclude?: LlmExcludeMeta | null }>(
  allMessages: T[],
  contextSelection?: ContextSelection | null,
): ContextSelection | undefined {
  const serverExcluded = serverExcludedMessageIds(allMessages);
  if (!contextSelection && serverExcluded.length === 0) return undefined;
  if (contextSelection && usesExclusionMode(contextSelection)) {
    return {
      excludedMessageIds: [
        ...new Set([...serverExcluded, ...(contextSelection.excludedMessageIds ?? [])]),
      ],
      excludedBlockIds: contextSelection.excludedBlockIds ?? [],
    };
  }
  if (serverExcluded.length > 0) {
    return { excludedMessageIds: serverExcluded, excludedBlockIds: [] };
  }
  return contextSelection ?? undefined;
}

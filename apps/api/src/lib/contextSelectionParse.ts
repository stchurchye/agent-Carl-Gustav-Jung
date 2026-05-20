import type { Context } from 'hono';
import type { ContextSelection } from '@xzz/shared';

function splitIds(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === '') return [];
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids;
}

export function parseContextSelectionFromQuery(c: Context): ContextSelection | undefined {
  const excludedIdsRaw = c.req.query('excludedIds');
  const excludedBlockIdsRaw = c.req.query('excludedBlockIds');
  const hasExclusion =
    excludedIdsRaw !== undefined || excludedBlockIdsRaw !== undefined;
  if (hasExclusion) {
    return {
      excludedMessageIds: splitIds(excludedIdsRaw) ?? [],
      excludedBlockIds: splitIds(excludedBlockIdsRaw) ?? [],
    };
  }
  const selectedMessageIds = splitIds(c.req.query('selectedIds'));
  const selectedBlockIds = splitIds(c.req.query('selectedBlockIds'));
  if (selectedMessageIds === undefined && selectedBlockIds === undefined) return undefined;
  return {
    selectedBlockIds: selectedBlockIds ?? [],
    selectedMessageIds: selectedMessageIds?.length ? selectedMessageIds : undefined,
  };
}

export function parseContextSelectionFromBody(body: {
  contextSelection?: ContextSelection;
  selectedMessageIds?: string[];
}): ContextSelection | undefined {
  if (body.contextSelection) return body.contextSelection;
  if (body.selectedMessageIds?.length) {
    return {
      selectedBlockIds: [],
      selectedMessageIds: body.selectedMessageIds,
    };
  }
  return undefined;
}

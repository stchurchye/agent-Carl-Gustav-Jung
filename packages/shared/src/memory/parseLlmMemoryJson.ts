import type { MemoryCategory, MemoryScope } from '../social.js';
import { memoryTitleFromContent } from './memoryTitle.js';

export function lastNonEmptyLine(raw: string): string {
  return (
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? ''
  );
}

export type ParsedAutoExtractCandidate = {
  title: string;
  content: string;
  scope: MemoryScope;
  category: MemoryCategory;
  confidence: number;
};

export function parseAutoExtractCandidates(
  raw: string,
  opts?: { minConfidence?: number; maxCount?: number; defaultScope?: MemoryScope },
): ParsedAutoExtractCandidate[] {
  const minConfidence = opts?.minConfidence ?? 0.55;
  const maxCount = opts?.maxCount ?? 3;
  const defaultScope = opts?.defaultScope ?? 'session';

  try {
    const parsed = JSON.parse(lastNonEmptyLine(raw) || '{}') as {
      candidates?: Array<{
        title?: string;
        content?: string;
        scope?: MemoryScope;
        category?: MemoryCategory;
        confidence?: number;
      }>;
    };
    return (parsed.candidates ?? [])
      .filter((c) => c.content?.trim() && (c.confidence ?? 0) >= minConfidence)
      .slice(0, maxCount)
      .map((c) => ({
        title: String(c.title ?? memoryTitleFromContent(c.content!)).trim(),
        content: c.content!.trim(),
        scope: normalizeAutoExtractScope(c.scope, defaultScope),
        category: normalizeMemoryCategory(c.category),
        confidence: Math.min(1, Number(c.confidence) || 0.6),
      }));
  } catch {
    return [];
  }
}

export type ParsedPreCompactCandidate = {
  title: string;
  content: string;
  category: MemoryCategory;
};

export function parsePreCompactCandidates(
  raw: string,
  opts?: { maxCount?: number },
): ParsedPreCompactCandidate[] {
  const maxCount = opts?.maxCount ?? 2;

  try {
    const parsed = JSON.parse(lastNonEmptyLine(raw) || '{}') as {
      candidates?: Array<{
        title?: string;
        content?: string;
        category?: MemoryCategory;
      }>;
    };
    return (parsed.candidates ?? [])
      .filter((c) => c.content?.trim())
      .slice(0, maxCount)
      .map((c) => ({
        title: String(c.title ?? memoryTitleFromContent(c.content!)).trim(),
        content: c.content!.trim(),
        category: normalizeMemoryCategory(c.category),
      }));
  } catch {
    return [];
  }
}

function normalizeAutoExtractScope(
  scope: MemoryScope | undefined,
  defaultScope: MemoryScope,
): MemoryScope {
  if (defaultScope === 'topic') {
    return scope === 'user' ? 'user' : 'topic';
  }
  return scope === 'session' ? 'session' : 'user';
}

function normalizeMemoryCategory(category: MemoryCategory | undefined): MemoryCategory {
  if (category === 'user_profile' || category === 'project_note') return category;
  return 'general';
}

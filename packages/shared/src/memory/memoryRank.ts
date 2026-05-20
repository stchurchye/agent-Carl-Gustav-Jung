import type { MemoryLine } from './formatMemoryBlock.js';
import { scoreMemoryRelevance } from './scoreMemory.js';

export function trimMemoryLines(lines: MemoryLine[], maxChars: number): MemoryLine[] {
  let used = 0;
  const out: MemoryLine[] = [];
  for (const line of lines) {
    const cost = line.title.length + line.content.length + 6;
    if (out.length > 0 && used + cost > maxChars) break;
    out.push(line);
    used += cost;
  }
  return out;
}

export function rankMemoryFragments<
  T extends { title: string; content?: string; updatedAt: string },
>(items: T[], query: string | undefined): T[] {
  if (!query?.trim()) {
    return [...items].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }
  const q = query.trim();
  return [...items]
    .map((item) => ({
      item,
      score:
        scoreMemoryRelevance(q, item.title, item.content ?? '') +
        new Date(item.updatedAt).getTime() / 1e15,
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

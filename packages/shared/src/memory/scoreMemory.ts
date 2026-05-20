/** 轻量记忆相关性打分（无 embedding 依赖） */
export function scoreMemoryRelevance(
  query: string,
  title: string,
  content: string,
): number {
  const q = normalizeForScore(query);
  if (q.length < 2) return 0;

  const titleN = normalizeForScore(title);
  const contentN = normalizeForScore(content);
  const combined = `${titleN} ${contentN}`;

  if (combined.includes(q) || q.includes(titleN)) return 1;

  const qTokens = tokenize(q);
  if (qTokens.length === 0) return 0;

  let hits = 0;
  for (const t of qTokens) {
    if (t.length >= 2 && combined.includes(t)) hits += 1;
  }
  const tokenScore = hits / qTokens.length;

  let charOverlap = 0;
  for (const ch of q) {
    if (combined.includes(ch)) charOverlap += 1;
  }
  const charScore = charOverlap / q.length;

  return Math.max(tokenScore * 0.85, charScore * 0.55);
}

function normalizeForScore(text: string): string {
  return text.trim().replace(/\s+/g, '').toLowerCase();
}

function tokenize(text: string): string[] {
  const latin = text.match(/[a-z0-9]+/gi) ?? [];
  const cjk = [...text.replace(/[a-z0-9\s]/gi, '')].filter((c) => c.trim());
  return [...latin.map((w) => w.toLowerCase()), ...cjk];
}

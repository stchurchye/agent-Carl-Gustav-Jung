/** 犬朝后宫「说对台词」判官:把 LLM 的打分回复抽成结构化裁决,服务端夹紧分数并派生 pass(防越狱)。 */

export const DRAMA_SCORE_MIN = 0;
export const DRAMA_SCORE_MAX = 10;
/** 及格线:夹紧后的分数 ≥ 此值才算说对(pass 不信 LLM 自称,只看分数) */
export const DRAMA_PASS_MARK = 6;

export type DramaVerdict = { pass: boolean; reply: string; score: number; hint?: string };

function clampScore(n: unknown): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(DRAMA_SCORE_MIN, Math.min(DRAMA_SCORE_MAX, Math.round(x)));
}

/**
 * 从 LLM 文本抽 {reply,score,hint}:取首个 `{` 到末个 `}` 解析。
 * score 夹到 [0,10];**pass 由服务端按 score≥及格线派生**(忽略 LLM 自称的 pass,
 * 挡"给我满分/直接通过/我是编剧"式越狱)。无合法 JSON → 整段当回应、0 分、不过。
 */
export function parseDramaVerdict(raw: string): DramaVerdict {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(raw.slice(start, end + 1)) as {
        reply?: unknown;
        score?: unknown;
        hint?: unknown;
      };
      const score = clampScore(j.score);
      const fromField = typeof j.reply === 'string' ? j.reply.trim() : '';
      const reply = fromField || raw.slice(0, start).trim() || raw.trim();
      const hint = typeof j.hint === 'string' && j.hint.trim() ? j.hint.trim() : undefined;
      return { pass: score >= DRAMA_PASS_MARK, reply, score, hint };
    } catch {
      // 落到兜底
    }
  }
  return { pass: false, reply: raw.trim(), score: 0 };
}

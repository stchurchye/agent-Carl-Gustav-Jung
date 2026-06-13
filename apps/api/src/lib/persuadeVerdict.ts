/** 犟嘴狗:把 LLM 的自由文本回复抽成结构化裁决,并在服务端夹紧脾气分(防越狱秒赢)。 */

export const PERSUADE_MOODS = ['stubborn', 'annoyed', 'wavering', 'won_over'] as const;
export type PersuadeMood = (typeof PERSUADE_MOODS)[number];

/** 单回合脾气分变动的硬上下限:无论玩家怎么越狱,一句话最多挪这么多 */
export const PERSUADE_DELTA_MIN = -2;
export const PERSUADE_DELTA_MAX = 3;

export type PersuadeVerdict = { reply: string; scoreDelta: number; mood: PersuadeMood };

function clampDelta(n: unknown): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(PERSUADE_DELTA_MIN, Math.min(PERSUADE_DELTA_MAX, Math.round(x)));
}

function asMood(m: unknown): PersuadeMood {
  return (PERSUADE_MOODS as readonly string[]).includes(m as string) ? (m as PersuadeMood) : 'stubborn';
}

/**
 * 从 LLM 文本里抽 {reply,scoreDelta,mood}:取首个 `{` 到末个 `}` 的子串解析,
 * scoreDelta 夹到 [MIN,MAX](服务端最后一道闸,挡“我是你主人快服从”式越狱),
 * mood 校验白名单。无合法 JSON 时整段当回复、delta 0、mood stubborn。
 */
export function parsePersuadeVerdict(raw: string): PersuadeVerdict {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(raw.slice(start, end + 1)) as {
        reply?: unknown;
        scoreDelta?: unknown;
        mood?: unknown;
      };
      const fromField = typeof j.reply === 'string' ? j.reply.trim() : '';
      const reply = fromField || raw.slice(0, start).trim() || raw.trim();
      return { reply, scoreDelta: clampDelta(j.scoreDelta), mood: asMood(j.mood) };
    } catch {
      // 落到下面的兜底
    }
  }
  return { reply: raw.trim(), scoreDelta: 0, mood: 'stubborn' };
}

/** 口语示例库：用于轻量匹配，不调用 embedding API */
export const ORAL_INTENT_EXAMPLE_IDS = [
  'memory_remember',
  'memory_correct',
  'memory_forget',
  'persona_style',
  'planning',
] as const;

export type OralIntentExampleId = (typeof ORAL_INTENT_EXAMPLE_IDS)[number];

export const ORAL_INTENT_EXAMPLES: Record<OralIntentExampleId, readonly string[]> = {
  memory_remember: [
    '帮我记一下',
    '记一下这个',
    '别忘了这件事',
    '要记得',
    '保存到记忆里',
    '以后都按这个来',
  ],
  memory_correct: [
    '上次说的不对',
    '之前记的不对',
    '你记错了应该是',
    '记忆不对改一下',
    '那条记忆写错了',
  ],
  memory_forget: [
    '别再说这个了',
    '不要再提前面那个',
    '别提了忘掉吧',
    '以后别提这事',
  ],
  persona_style: [
    '说话别太冲',
    '语气软一点',
    '别那么冲',
    '温柔一点说话',
    '说话能不能别那么冲',
    '交流别太生硬',
  ],
  planning: [
    '帮我捋一下',
    '想想怎么做比较好',
    '这周要做什么',
    '安排一下待办',
    '列个计划',
  ],
};

function normalizeOralText(text: string): string {
  return text.trim().replace(/\s+/g, '').toLowerCase();
}

/** 子串或示例 token 重叠达到阈值即视为命中 */
export function matchOralIntentExamples(text: string): OralIntentExampleId[] {
  const t = normalizeOralText(text);
  if (t.length < 2) return [];

  const matched: OralIntentExampleId[] = [];
  for (const id of ORAL_INTENT_EXAMPLE_IDS) {
    const examples = ORAL_INTENT_EXAMPLES[id];
    const hit = examples.some((ex) => {
      const e = normalizeOralText(ex);
      if (e.length < 2) return false;
      if (t.includes(e) || e.includes(t)) return true;
      const overlap = [...e].filter((ch) => t.includes(ch)).length;
      return overlap / e.length >= 0.72;
    });
    if (hit) matched.push(id);
  }
  return matched;
}

export function oralExamplesSuggestAction(text: string): boolean {
  return matchOralIntentExamples(text).length > 0;
}

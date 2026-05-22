/**
 * Agent runtime cost accounting：按 model 估算每次 LLM call 的人民币成本。
 *
 * 设计原则：
 * - 数据手动维护：hardcode table + 月度对一次官方页面
 * - 统一按 cache-miss 估算：不区分 DeepSeek prompt-cache 命中与否，宁高勿低
 * - USD → CNY 汇率常数 7.2
 * - 查不到 model → return { costCny: 0, unknownModel: true } 让 caller 一次性 emit
 *   COST_UNKNOWN_MODEL notice，不阻塞 run
 */

type PriceEntry = { promptCny: number; completionCny: number };

/** 单价 = CNY per 1000 tokens（cache miss）。 */
export const MODEL_PRICING: Record<string, PriceEntry> = {
  // ─── DeepSeek 官方 CNY 原价（cache miss）─────────────────────────────────
  // input ¥2/M (miss)   output ¥8/M
  'deepseek-chat':                 { promptCny: 0.002,   completionCny: 0.008   },
  // input ¥4/M (miss)   output ¥16/M
  'deepseek-reasoner':             { promptCny: 0.004,   completionCny: 0.016   },
  // 'deepseek-v4-pro' 是 DB DEFAULT；按 deepseek-chat 一档估算
  'deepseek-v4-pro':               { promptCny: 0.002,   completionCny: 0.008   },

  // ─── OpenAI via ZenMux（USD × 7.2 → CNY）────────────────────────────────
  // gpt-4o $2.50 / $10 per M → 0.018 / 0.072
  'openai/gpt-4o':                 { promptCny: 0.018,   completionCny: 0.072   },
  // gpt-4o-mini $0.15 / $0.60 per M → 0.00108 / 0.00432
  'openai/gpt-4o-mini':            { promptCny: 0.0011,  completionCny: 0.0043  },
  // gpt-5 $1.25 / $10 per M → 0.009 / 0.072
  'openai/gpt-5':                  { promptCny: 0.009,   completionCny: 0.072   },

  // ─── Anthropic via ZenMux（USD × 7.2 → CNY）────────────────────────────
  // sonnet 4.5 $3 / $15 per M → 0.0216 / 0.108
  'anthropic/claude-sonnet-4.5':   { promptCny: 0.0216,  completionCny: 0.108   },
  // sonnet 4.6 与 4.5 同价（暂未公开调整）
  'anthropic/claude-sonnet-4.6':   { promptCny: 0.0216,  completionCny: 0.108   },
  // opus 4.6 $5 / $25 per M → 0.036 / 0.18
  'anthropic/claude-opus-4.6':     { promptCny: 0.036,   completionCny: 0.18    },
  // haiku 3.5 $0.80 / $4 per M → 0.00576 / 0.0288
  'anthropic/claude-haiku-3.5':    { promptCny: 0.00576, completionCny: 0.0288  },
  // 兼容历史 alias
  'anthropic/claude-3.5-sonnet':   { promptCny: 0.0216,  completionCny: 0.108   },
  'anthropic/claude-3.5-haiku':    { promptCny: 0.00576, completionCny: 0.0288  },

  // ─── Google via ZenMux（USD × 7.2 → CNY）────────────────────────────────
  // gemini 2.5 pro $1.25 / $10 per M → 0.009 / 0.072
  'google/gemini-2.5-pro':         { promptCny: 0.009,   completionCny: 0.072   },
  // gemini 2.5 flash $0.075 / $0.30 per M → 0.00054 / 0.00216
  'google/gemini-2.5-flash':       { promptCny: 0.00054, completionCny: 0.00216 },
};

/**
 * 计算单次 LLM call 的成本。
 *
 * @returns
 *   - `costCny`：CNY，保留 4 位小数（最小单位约 1 厘）
 *   - `unknownModel`：true 表示 modelId 不在 table，caller 应一次性 emit notice
 */
export function computeCallCostCny(
  modelId: string | null,
  promptTokens: number,
  completionTokens: number,
): { costCny: number; unknownModel: boolean } {
  if (!modelId) return { costCny: 0, unknownModel: true };
  const entry = MODEL_PRICING[modelId];
  if (!entry) return { costCny: 0, unknownModel: true };
  const cost =
    (promptTokens / 1000) * entry.promptCny +
    (completionTokens / 1000) * entry.completionCny;
  return {
    costCny: Math.round(cost * 10000) / 10000,
    unknownModel: false,
  };
}

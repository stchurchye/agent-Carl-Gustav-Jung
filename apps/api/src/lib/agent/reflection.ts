import type { LlmChatClient } from '../llm/types.js';
import type { AgentCheckpoint, AgentStep } from './types.js';
import { extractJsonCandidate } from './planner.js';
import { redactSecrets } from './redact.js';

/**
 * issue 0003：Reflection —— LLM 兜底的「目标完成判断」。
 *
 * 续跑/收尾不再只靠机械的 todo 状态（leaky：#7 被 replan 丢掉的 todo、#2b 跨轮 todo
 * 身份不稳），而是让 LLM 读「用户目标 + 已执行步骤」语义判断目标是否达成。
 *
 * fail-open：解析失败时默认 goalMet:true（放行收尾），避免坏掉的 reflection 把 run
 * 卡在无限续跑。
 */

const REFLECT_SYSTEM_PROMPT = `你是任务完成度评审。读取用户的目标和已执行的步骤（工具调用+结果/失败），判断用户的目标是否已经实质达成。
输出严格 JSON（单独一行，无代码块、无解释）：
{"goalMet": true|false, "reason": "一句话说明"}
- goalMet=true：目标已实质达成，可以收尾给用户回复。
- goalMet=false：还有关键部分没做完、或关键步骤失败了，应继续。`;

/**
 * 把工具步骤（含 tool_error 硬失败）摘成给 LLM 看的简短列表。
 * S2：有累积 checkpoint 时，前置「已确认的发现（累积）」—— 让评审看到整 run 的成果，
 * 而非只看 last-8 步（30 步 run 里目标可能早在第 5 步达成）。
 */
export function buildStepDigest(steps: AgentStep[], checkpoint?: AgentCheckpoint | null): string {
  // 不封顶 completed：reflection 是**收尾裁判**，最需要看到整 run 的全部成果（含最早的
  // 完成证据）—— 截掉早期项会让它漏判"目标其实早已达成"，正是 S2 累积要修的问题。
  // 安全性：reflection 读到的是上一次续跑写入的 checkpoint，若曾 >3500 字节已在那次续跑
  // 被 S4 压到 ≤10 条；故此处 completed 恒 ≤3500 字节(~≤1800 token)，不存在无界膨胀
  // （round2 的封顶是对"输出无 maxTokens"的误判：输入本就被续跑期压缩门控住了，round3 纠正）。
  const accumulated =
    checkpoint && checkpoint.completed.length > 0
      ? '# 已确认的发现（累积）\n' +
        checkpoint.completed.map((c) => `- ${c.text}: ${c.finding}`).join('\n') +
        '\n\n# 最近步骤\n'
      : '';
  return (
    accumulated +
    (steps
      // review #2：纳入 tool_error（重试耗尽的硬失败）—— 否则 reflection 看不到最该
      // 判"没完成/该重规划"的那类失败。
      .filter((s) => s.kind === 'tool_call' || s.kind === 'tool_error')
      .slice(-8)
      .map((s) => {
        let out = '';
        try {
          // S2d：投影脱敏（持久化 step.output 保持原始）。
          out = JSON.stringify(redactSecrets(s.output) ?? {}).slice(0, 200);
        } catch {
          out = '[unserializable]';
        }
        const failTag = s.error != null && s.error !== '' ? ` [失败: ${s.error}]` : '';
        return `- ${s.toolName ?? '?'}${failTag}: ${out}`;
      })
      .join('\n') || '（无工具调用）')
  );
}

export async function reflectGoalCompletion(params: {
  inputText: string;
  steps: AgentStep[];
  llm: LlmChatClient;
  signal: AbortSignal;
  checkpoint?: AgentCheckpoint | null;
}): Promise<{ goalMet: boolean; reason: string }> {
  const { inputText, steps, llm, signal } = params;

  const stepDigest = buildStepDigest(steps, params.checkpoint);
  const userPrompt = `# 用户目标\n${inputText}\n\n# 已执行的步骤\n${stepDigest}\n\n请判断目标是否达成。`;

  const result = await llm.chat(
    [
      { role: 'system', content: REFLECT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { signal },
  );

  const candidate = extractJsonCandidate(result.content);
  if (!candidate) {
    return { goalMet: true, reason: 'reflection JSON 解析失败（默认放行收尾）' };
  }
  try {
    const parsed = JSON.parse(candidate) as {
      goalMet?: unknown;
      reason?: unknown;
    };
    return {
      goalMet: typeof parsed.goalMet === 'boolean' ? parsed.goalMet : true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch {
    return { goalMet: true, reason: 'reflection JSON 解析失败（默认放行收尾）' };
  }
}

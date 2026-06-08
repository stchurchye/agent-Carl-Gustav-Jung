import type { LlmRequestLogContext } from '@xzz/shared';
import { lastNonEmptyLine } from '@xzz/shared';
import type { LlmChatClient } from '../llm/types.js';
import { isAbortError } from '../memoryAbort.js';
import type { AgentStep } from './types.js';
import { upsertSkill, hasDistilledSkillForRun } from './topicSkills.js';

/**
 * 技能自蒸馏（self-improvement loop，对齐 Hermes「完成任务 → 生成可复用 skill」）。
 *
 * 在 run 成功收尾时调用：若这次 run 做了真·多步工具工作，就用一次 LLM 把「这类任务该怎么做」
 * 蒸馏成一条**可复用的 user-scope topic_skill**，写入时 `enabled=false`（待人评审才注入，镜像
 * 记忆系统的 quality gate），`source='auto_distilled'`。用户在技能列表里启用后，`listForAgent`
 * 即把它注入后续同类 run 的 system prompt → 学习闭环成立。
 *
 * 全程 **fail-open**：任何失败都不抛（绝不影响 run finalize）；仅取消（abort）透传，让 runtime
 * 看到 cancel 语义。门控：成功 tool_call ≥ 2（单工具/纯聊天不值得蒸馏）；调用方保证非子 run。
 */

/** 单工具/纯聊天不值得蒸馏；要求至少这么多次成功工具调用才生成技能。 */
const MIN_SUCCESSFUL_TOOL_CALLS = 2;

const SYSTEM_PROMPT = `你在帮一个中文助理「沉淀方法」。下面是它刚完成的一个多步任务的记录。
请判断这次任务的**做法**是否值得提炼成一条可复用的「技能」(给以后遇到同类任务时照着做)。

值得 → 提炼成一条通用、可迁移的操作指南(不要照抄本次的具体内容/数据)，包含：
  - 何时适用(这类任务长什么样)
  - 步骤(先做什么、再做什么)
  - 用到的工具及顺序
  - 注意点/易错点
不值得(过于琐碎、一次性、无法泛化) → skip。

输出**单独一行 JSON**，不要代码块：
{"skip":false,"title":"≤80字的技能名","content":"markdown 操作指南，≤2000字"}
不值得时：{"skip":true}`;

type DistilledSkill = { title: string; content: string };

const MAX_TITLE = 80;
const MAX_CONTENT = 2000;

/**
 * 数成功的 tool_call：软失败不算;硬失败是独立的 tool_error kind,天然不计。
 * 软失败的权威信号是 step.error 非空(runExecute 记 tool_call 时把 softError 落到 step.error,
 * tool 的 ok 实际嵌在 output.result.ok,不在 output.ok)。
 */
function countSuccessfulToolCalls(steps: AgentStep[]): number {
  let n = 0;
  for (const s of steps) {
    if (s.kind !== 'tool_call') continue;
    if (s.error != null) continue; // 软失败
    n += 1;
  }
  return n;
}

/** 取最近一次 plan/replan step 里的 intentSummary（若有），给蒸馏 prompt 一点任务画像。 */
function extractIntentSummary(steps: AgentStep[]): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind !== 'plan' && s.kind !== 'replan') continue;
    const summary = (s.output as { intentSummary?: unknown } | null)?.intentSummary;
    if (typeof summary === 'string' && summary.trim()) return summary.trim();
  }
  return '';
}

/** 有序工具序列，去掉软失败，给 LLM 看「这次用了哪些工具、什么顺序」。 */
function toolSequence(steps: AgentStep[]): string {
  const names: string[] = [];
  for (const s of steps) {
    if (s.kind !== 'tool_call' || !s.toolName) continue;
    if (s.error != null) continue; // 软失败(step.error 是权威信号)
    names.push(s.toolName);
  }
  return names.join(' → ');
}

function parseDistilled(rawOut: string): DistilledSkill | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastNonEmptyLine(rawOut));
  } catch {
    return null;
  }
  const obj = parsed as { skip?: unknown; title?: unknown; content?: unknown } | null;
  if (!obj || obj.skip === true) return null;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const content = typeof obj.content === 'string' ? obj.content.trim() : '';
  if (!title || !content) return null;
  return { title: title.slice(0, MAX_TITLE), content: content.slice(0, MAX_CONTENT) };
}

export async function distillSkillFromRun(params: {
  ownerId: string;
  runId: string;
  inputText: string;
  finalContent: string;
  steps: AgentStep[];
  llm: LlmChatClient;
  signal: AbortSignal;
  log?: LlmRequestLogContext;
}): Promise<void> {
  // 门控：做过真·多步工具工作才蒸馏。
  if (countSuccessfulToolCalls(params.steps) < MIN_SUCCESSFUL_TOOL_CALLS) return;

  // 幂等：同一 run 已蒸馏过则跳过（crash 重 finalize 安全）。
  try {
    if (await hasDistilledSkillForRun(params.ownerId, params.runId)) return;
  } catch {
    // 查重失败不阻断（最坏多写一条，由 upsert 的 high-pattern 防御兜底）；继续。
  }

  const intentSummary = extractIntentSummary(params.steps);
  const userBlock = [
    `用户请求：${params.inputText}`,
    intentSummary ? `任务概述：${intentSummary}` : '',
    `工具序列：${toolSequence(params.steps) || '(无)'}`,
    `最终产出（节选）：${params.finalContent.slice(0, 800)}`,
  ]
    .filter(Boolean)
    .join('\n');

  let distilled: DistilledSkill | null;
  try {
    const result = await params.llm.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userBlock },
      ],
      { temperature: 0.3, maxTokens: 1024, log: params.log, signal: params.signal },
    );
    distilled = parseDistilled(result.content);
  } catch (e) {
    if (isAbortError(e, params.signal)) throw e; // 取消透传
    return; // fail-open：蒸馏 LLM 失败不影响 finalize
  }

  if (!distilled) return; // skip / 解析失败

  try {
    // enabled=false：待人评审才注入。upsertSkill 内部 validateSkillInput 会再过一道注入防御；
    // 若 LLM 吐出 high pattern → 抛 SkillValidationError，被下面 catch 兜住、不写入。
    await upsertSkill({
      scope: 'user',
      ownerId: params.ownerId,
      groupId: null,
      topicId: null,
      title: distilled.title,
      content: distilled.content,
      enabled: false,
      updatedByUserId: params.ownerId,
      source: 'auto_distilled',
      sourceRunId: params.runId,
    });
  } catch (e) {
    if (isAbortError(e, params.signal)) throw e;
    // fail-open：写入失败(含 SkillValidationError)不影响 finalize
  }
}

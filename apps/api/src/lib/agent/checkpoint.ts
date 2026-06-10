import type { AgentCheckpoint, AgentRun, AgentStep, CheckpointFinding, ReplyRef, TodoItem } from './types.js';
import type { ToolDef } from './toolRegistry.js';
import type { LlmChatClient } from '../llm/types.js';
import { collectReplyRefs, summarizeStepOutput } from './replyGen.js';
import { isToolFailure } from './critique.js';
import { redactSecrets } from './redact.js';
import { extractJsonCandidate } from './planner.js';

/**
 * S1：累积式结构化 checkpoint。机械版（无 LLM）—— 每步把成功工具调用的发现 +ref
 * 折叠进 completed，跨步累积、不丢旧发现。LLM 压缩（S4）只在累积过大时压列表。
 * 类型定义在 types.ts（避免循环依赖），这里 re-export 方便调用方。
 */
export type { AgentCheckpoint, CheckpointFinding };

/** 读 run 上累积的 checkpoint（替代 readStashedContinuationProgress 的结构化版）。 */
export function readLatestCheckpoint(run: AgentRun): AgentCheckpoint | null {
  return run.contextCheckpoint ?? null;
}

export type BuildCheckpointOpts = {
  goal: string;
  intent: string;
  successCount: number;
  toolMap: Map<string, ToolDef>;
};

/** output 是否是 ok:false 的失败观察（error 列没填时的兜底）。 */
function isOkFalseOutput(output: unknown): boolean {
  const raw =
    (output as { result?: unknown } | null)?.result ?? output;
  return (
    raw != null && typeof raw === 'object' && (raw as { ok?: unknown }).ok === false
  );
}

/**
 * 「有进展」步计数:成功 tool_call(error 列空)+ observe(幂等缓存命中也算进展)。
 * runExecute 续跑判停与 applyReplanningIfNeeded 的 checkpoint successCount 共用,
 * 防两处口径漂移。注意:这是**进展判定**口径(只看 error 列),与 buildCheckpoint 折叠
 * findings 的 successfulCalls 口径(额外滤 ok:false)有意不同 —— ok:false 的软失败
 * 不产 finding,但算"跑过一步"的进展。
 */
export function countProgressSteps(steps: AgentStep[]): number {
  return steps.filter(
    (s) =>
      (s.kind === 'tool_call' && (s.error == null || s.error === '')) ||
      s.kind === 'observe',
  ).length;
}

/**
 * 机械累积：把 prior 之后的新成功工具步折叠成 findings，并进 prior.completed。
 * - 只取 idx > prior.producedAtIdx 的新步（不重复折叠）。
 * - 滤掉 soft-fail/失败步（isToolFailure）。
 * - finding.refs 复用 collectReplyRefs（已按 kind:id 去重、ok:false 不产 ref）。
 */
export function buildCheckpoint(
  prior: AgentCheckpoint | null,
  steps: AgentStep[],
  todos: TodoItem[],
  opts: BuildCheckpointOpts,
): AgentCheckpoint {
  const sinceIdx = prior?.producedAtIdx ?? -1;
  const newSteps = steps.filter((s) => s.idx > sinceIdx);
  // 成功的工具步：tool_call 或 observe（idempotency 缓存命中复用了真实结果），
  // 排除失败（isToolFailure 看 error 列）与 ok:false（error 列没填时兜底）。
  const successfulCalls = newSteps.filter(
    (s) =>
      (s.kind === 'tool_call' || s.kind === 'observe') &&
      !isToolFailure(s) &&
      !isOkFalseOutput(s.output),
  );
  // 同一 idempotency key 的原始执行 + 缓存命中重放（observe）是同一逻辑结果 —— 只折一次。
  // 注意：生产里缓存命中 observe 的 toolCallKey 列是 null，key 落在 input.idempotencyKey；
  // 原始 tool_call 的 key 在 toolCallKey 列。两处都取出来才能真正配上对（整体 review #2）。
  const idemKeyOf = (s: AgentStep): string | null =>
    s.toolCallKey ??
    ((s.input as { idempotencyKey?: unknown } | null)?.idempotencyKey as string | undefined) ??
    null;
  const seenKeys = new Set<string>();
  const dedupedCalls = successfulCalls.filter((s) => {
    const k = idemKeyOf(s);
    if (!k) return true;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });

  const newFindings: CheckpointFinding[] = dedupedCalls.map((s) => {
    const tool = s.toolName ? opts.toolMap.get(s.toolName) : undefined;
    return {
      text: s.toolName ?? '<tool>',
      finding: buildRichFinding(s, tool),
      refs: collectReplyRefs([s], opts.toolMap),
      // 折叠时就钉死类别 —— LLM 压缩可改写 text,toolMap 查找会失效(review S7 #2)。
      // K1:工具显式声明 synthesis(spawn 类合成报告)优先;否则按 summaryKind 推断。
      kind: (tool?.replyMeta?.checkpointFindingKind ??
        (tool?.replyMeta?.summaryKind === 'list' ? 'list' : 'content')) as
        | 'list'
        | 'content'
        | 'synthesis',
    };
  });

  // 累积 + 去重：按**全部** ref id 去重（不止 refs[0]）—— S4 压缩会把多条合并成一条带
  // [A,B,C] 的 finding，若只认首 ref，重抓 B/C 会被当新发现重折（整体 review #4）。
  // 但只在**所有** ref 都已见过（=该条无任何新来源）时才跳：用 every 而非 some。
  // 否则一条"含已见 ref + 新 ref"的发现（如 LLM 压缩把 refs 跨条目重叠成 [A,B] 与
  // [B,C]）会因共享 B 被整条丢弃，连带丢掉只在该条出现的来源 C（round2 #4）。
  // ref-less finding 全留（每步独立；缓存重放已在 dedupedCalls 按 idempotency key 去过）。
  // P0-S7 修正:搜索工具现在产 top-N url ref,「ref 全部已见 → 整条丢弃」需区分 ref 的
  // **登记来源类别**,否则搜索列举会吞掉同 URL 的深读发现:
  // - 列举类发现(tool.summaryKind='list':search_web/search_papers…)的 ref 只记"来源已列出";
  // - 内容类发现(text/合并条目/未知工具)的 ref 记"内容已折叠"。
  // 跳过规则:内容类发现仅当其全部 ref 已被**内容类**登记才丢(fetch 重抓同 URL、
  // review #4 合并条目重折 → 仍去重;深读搜索列过的 URL → 保留,内容是新的);
  // 列举类发现的全部 ref 被任一类登记过即丢(重复列举无新来源)。
  // K1:synthesis(spawn 类合成报告)第三类 —— 报告引用了来源但**不是**任何来源的内容,
  // 永不被"ref 全已见"吞掉(否则引用全与早先深读重叠的研究报告会从 checkpoint 消失);
  // 其 refs 登记进列举侧("来源已提及"),之后深读这些来源仍算新内容。
  // 已知取舍:document_reader 深读 fetch_url 已抓过的同 URL 仍走内容去重(同 URL 重抓
  // 去重是既有设计;不同工具的抽取质量差异不在 checkpoint 层分辨,digestTail 兜近窗)。
  const seenListRefs = new Set<string>();
  const seenContentRefs = new Set<string>();
  const completed: CheckpointFinding[] = [];
  for (const f of [...(prior?.completed ?? []), ...newFindings]) {
    const ids = f.refs.map((r) => `${r.kind}:${r.id}`);
    // 类别优先用折叠时钉死的 f.kind(扛 LLM 压缩改写 text);旧行无 kind 再回退 toolMap;
    // 都查不到(合并条目)→ content(安全侧:深读不被吞,重复列举仍被 list∪content 去重)。
    const isSynthesis =
      f.kind === 'synthesis' ||
      (f.kind == null && opts.toolMap.get(f.text)?.replyMeta?.checkpointFindingKind === 'synthesis');
    const isListFinding =
      !isSynthesis &&
      (f.kind === 'list' ||
        (f.kind == null && opts.toolMap.get(f.text)?.replyMeta?.summaryKind === 'list'));
    const allSeen =
      !isSynthesis &&
      ids.length > 0 &&
      (isListFinding
        ? ids.every((id) => seenListRefs.has(id) || seenContentRefs.has(id))
        : ids.every((id) => seenContentRefs.has(id)));
    if (allSeen) continue;
    for (const id of ids) (isSynthesis || isListFinding ? seenListRefs : seenContentRefs).add(id);
    completed.push(f);
  }

  const maxIdx = steps.reduce((m, s) => Math.max(m, s.idx), sinceIdx);

  const remainingPlan = todos
    .filter((t) => t.status !== 'completed')
    .map((t) => t.text);

  // P0-S6:已完成 todo 文案跨轮并集去重 —— applyReplanningIfNeeded 清 todos 后,
  // round2 重建仍知道 round1 完成了什么(issue 0001 #2b 的轻解;todo 身份按文案对齐,
  // trim 抹平 LLM 重生成时的首尾空白差异;语义级对齐(改写文案)留 issue 0003 正解)。
  const completedTodos = Array.from(
    new Set([
      ...(prior?.completedTodos ?? []).map((t) => t.trim()),
      ...todos.filter((t) => t.status === 'completed').map((t) => t.text.trim()),
    ]),
  ).filter((t) => t.length > 0);

  return {
    version: 1,
    goal: opts.goal,
    intent: opts.intent,
    completed,
    remainingPlan,
    openQuestions: prior?.openQuestions ?? [],
    // 机械版：下一步 = 第一个未完成的 todo（S4 的 LLM 版会写更准的 nextStep / FINALIZE）。
    nextStep: remainingPlan[0] ?? prior?.nextStep ?? '',
    successCount: opts.successCount,
    producedAtIdx: maxIdx,
    digestTail: buildDigestTail(steps),
    completedTodos,
  };
}

/**
 * v4：finding 存储格式升级。
 * - silent / export_ref / list 工具走原有 summarizeStepOutput：
 *   silent → ''；export_ref → 固定标记；list → top-5 title 提取（结构化、不截断）。
 *   list 之所以不走 raw-JSON 路径：search 结果 JSON 通常 >2000 字，
 *   字符截断会断在 snippet 中间产生残缺 JSON，LLM 压缩器读到的是语法错误的碎片。
 * - text / 未知 → 保留 2000 字原始 output，让 LLM 压缩器从更丰富的原材料提炼，
 *   避免旧版 200 字截断导致的"摘要的摘要"信息损失。
 */
/**
 * R2-1:list 类 output(results/items/papers/citations 数组)→ 结构化摘录。
 * 形状不识别时返回 null,调用方回退 summarizeStepOutput 旧行为。
 */
export function buildListFinding(inner: unknown): string | null {
  if (inner == null || typeof inner !== 'object') return null;
  const o = inner as Record<string, unknown>;
  const arr = (o.results ?? o.items ?? o.papers ?? o.citations) as unknown[] | undefined;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const lines: string[] = [];
  // R1-2 质量警示置顶:重规划读 finding 时第一眼看到"别采信"。
  if (typeof o.note === 'string' && o.note.length > 0 && o.quality !== 'ok') {
    lines.push(`⚠ ${o.note}`);
  }
  // review 修正:超 5 条要声明总数 —— 否则大脑误以为"只搜到 5 条",决策基于片段数据。
  if (arr.length > 5) lines.push(`(共 ${arr.length} 条,以下为前 5;近窗全文见 digestTail)`);
  // xhigh 复审修复:警示行单独记 —— 全部条目无内容时警示不得随 null 一起被静默丢弃。
  const warningLines = [...lines];
  let itemLines = 0;
  for (const it of arr.slice(0, 5)) {
    if (it == null || typeof it !== 'object') continue;
    const r = it as { title?: unknown; url?: unknown; snippet?: unknown; abstract?: unknown; year?: unknown };
    // xhigh 复审修复:trim —— 空白-only title/snippet 是 truthy,会穿透跳过逻辑与 [无标题] 兜底。
    const titleRaw = typeof r.title === 'string' ? r.title.trim().slice(0, 80) : '';
    const excerptRaw = (
      typeof r.snippet === 'string' ? r.snippet : typeof r.abstract === 'string' ? r.abstract : ''
    ).trim();
    // review 修正:title 与摘录都缺的条目零信息量,不占槽位。
    if (!titleRaw && !excerptRaw) continue;
    const url = typeof r.url === 'string' && r.url ? ` — ${r.url}` : '';
    const year = typeof r.year === 'number' ? ` (${r.year})` : '';
    const excerpt = excerptRaw ? `\n  ${excerptRaw.slice(0, 200).replace(/\n/g, ' ')}` : '';
    lines.push(`- ${titleRaw || '[无标题]'}${year}${url}${excerpt}`);
    itemLines++;
  }
  if (itemLines === 0) {
    // 有 ⚠ 质量警示 → 返回警示(planner 必须看到"别采信");无警示 → null 回退旧路径。
    const warning = warningLines.find((l) => l.startsWith('⚠'));
    return warning ? (redactSecrets(warning) as string) : null;
  }
  return redactSecrets(lines.join('\n')) as string;
}

function buildRichFinding(s: AgentStep, tool?: ToolDef): string {
  const kind = tool?.replyMeta?.summaryKind ?? 'text';
  if (kind === 'silent' || kind === 'export_ref') {
    return summarizeStepOutput(s.output, kind);
  }
  if (kind === 'list') {
    // tool output 被包在 { result: ... } 里（runExecute.ts:382 `output: { result: output }`）；
    // summarizeStepOutput 直接读 out.results/out.items，需先解包 result wrapper 才能提取 title。
    const inner = (s.output as { result?: unknown } | null)?.result ?? s.output;
    // R2-1:搜索/列举类 finding 结构化为「title — url + snippet 摘录」。此前只存 top-5 标题:
    // 无 url(重规划无法安排深读)、无 snippet(只见"搜过什么"不见"搜到什么")。
    // quality 警示 note(R1-2)一并带上,重规划不会误信垃圾结果。每条 snippet 截 200,
    // 总量 ≤5 条 ≈ 1.2K,在 finding 2000 字预算内;近窗全文仍走 digestTail。
    const structured = buildListFinding(inner);
    if (structured) return structured;
    return summarizeStepOutput(inner, kind);
  }
  const redacted = redactSecrets(s.output);
  try {
    return JSON.stringify(redacted).slice(0, 2000);
  } catch {
    return '[unserializable]';
  }
}

// v4：近窗扩容到 8 步 × 4000 字/步。注意：digestTail 既进 reply 终稿，也（v5 后）经
// renderCheckpointState 限字节进 planner —— 是续跑规划唯一的"逐字近窗"来源。
const DIGEST_TAIL_STEPS = 8;
const DIGEST_TAIL_PER_STEP = 4000;

/**
 * 近窗高保真：取最近 K 步成功工具输出，各保留较全（≤4KB）。
 * 每行带 [步骤 N] idx 标注 —— 让 planner（及模型）能据此 recall_step({idx}) 重读完整原文。
 */
function buildDigestTail(steps: AgentStep[]): string {
  const recent = steps
    .filter(
      (s) =>
        (s.kind === 'tool_call' || s.kind === 'observe') &&
        !isToolFailure(s) &&
        !isOkFalseOutput(s.output),
    )
    .slice(-DIGEST_TAIL_STEPS);
  return recent
    .map((s) => {
      let out = '';
      try {
        // S2d：digestTail 是送 LLM 的投影 → 脱敏（持久化 step.output 保持原始）。
        out = JSON.stringify(redactSecrets(s.output) ?? {}).slice(0, DIGEST_TAIL_PER_STEP);
      } catch {
        out = '[unserializable]';
      }
      return `- [步骤 ${s.idx}] ${s.toolName ?? '<tool>'}: ${out}`;
    })
    .join('\n');
}

/**
 * S4：当累积 checkpoint 过大时，用 LLM 压缩 completed 列表（合并/丢弃条目、保留 refs），
 * 并更新 nextStep/openQuestions。**不重写每条 finding 措辞**（避免摘要的摘要漂移）。
 * 用 resolveLlmClient 包好的 client（计入 run.usage、可被 cancel 中断）。
 * fail-open：解析失败/LLM 出错 → 返回原 checkpoint，绝不阻塞循环；abort 透传。
 */
const AGENT_CHECKPOINT_SYSTEM = `你是 agent 任务状态的压缩器。读取当前任务状态(JSON)，把它压缩得更短，但绝不丢关键信息。
严格输出单个 JSON（无代码块、无解释）：
{"completed":[{"text":"做了什么","finding":"关键结论","refs":[{"kind":"url","id":"…","label":"…"}]}],"remainingPlan":["…"],"openQuestions":["…"],"nextStep":"下一步最具体动作；目标已达成写 FINALIZE"}
规则：
- 压缩方式 = 合并相似/重复的 completed 条目、丢弃最不重要的旧条目；不要逐条重写已有 finding 的措辞（避免摘要的摘要漂移）。
- completed 压到最多 10 条以内。
- 必须保留每条 finding 的来源 refs（url/document/magi_card/diagram），refs 不得丢（合并条目时把各自的 refs 并上）。
- nextStep 必须可执行；目标已达成写 "FINALIZE"。
- 不编造状态里没有的内容。`;

/**
 * S5：累积 checkpoint 是否大到该 LLM 压缩。**只量 completed**（压缩能缩的部分；
 * digestTail 是近窗高保真、压缩不动它，算进去会让阈值被 digestTail 主导、几乎恒真→白压）。
 * v4：finding 升级为最多 2000 字（原 200 字），阈值同步升至 15000——
 * 约 7-8 条富发现时触发（原 17+ 条短发现），与 finding 粒度对齐。
 */
const CHECKPOINT_COMPACT_CHARS = 15000;
export function checkpointNeedsCompaction(cp: AgentCheckpoint): boolean {
  return JSON.stringify(cp.completed).length > CHECKPOINT_COMPACT_CHARS;
}

const REF_KINDS = new Set(['document', 'url', 'magi_card', 'diagram']);
function validRefs(v: unknown): ReplyRef[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is ReplyRef =>
      r != null &&
      typeof r === 'object' &&
      typeof (r as ReplyRef).id === 'string' &&
      REF_KINDS.has((r as ReplyRef).kind),
  );
}

export async function compactCheckpointViaLlm(params: {
  checkpoint: AgentCheckpoint;
  llm: LlmChatClient;
  signal: AbortSignal;
}): Promise<AgentCheckpoint> {
  const { checkpoint, llm, signal } = params;
  const userPrompt =
    `# 当前任务状态（JSON）\n` +
    JSON.stringify({
      goal: checkpoint.goal,
      completed: checkpoint.completed,
      remainingPlan: checkpoint.remainingPlan,
      openQuestions: checkpoint.openQuestions,
      nextStep: checkpoint.nextStep,
    }) +
    `\n\n请压缩 completed 列表并输出新状态 JSON。`;
  try {
    const result = await llm.chat(
      [
        { role: 'system', content: AGENT_CHECKPOINT_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.2, maxTokens: 1500, signal },
    );
    const candidate = extractJsonCandidate(result.content);
    if (!candidate) return checkpoint;
    const parsed = JSON.parse(candidate) as {
      completed?: unknown;
      remainingPlan?: unknown;
      openQuestions?: unknown;
      nextStep?: unknown;
    };
    if (!Array.isArray(parsed.completed)) return checkpoint; // 校验失败 → fail-open
    const compressed: CheckpointFinding[] = parsed.completed
      .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
      .map((c) => ({
        text: typeof c.text === 'string' ? c.text : '',
        finding: typeof c.finding === 'string' ? c.finding : '',
        refs: validRefs(c.refs), // 只保留合法 {kind,id} ref，挡 undefined:undefined 引用
      }));
    // 压缩不该把发现清空：坏输出 → fail-open 保原。
    if (compressed.length === 0 && checkpoint.completed.length > 0) return checkpoint;

    // 来源神圣：把"refs 被压缩全丢掉的原始 ref-bearing 发现"补回，绝不丢来源。
    const keptRefIds = new Set(
      compressed.flatMap((c) => c.refs.map((r) => `${r.kind}:${r.id}`)),
    );
    const lost = checkpoint.completed.filter(
      (c) => c.refs.length > 0 && c.refs.every((r) => !keptRefIds.has(`${r.kind}:${r.id}`)),
    );
    const completed = [...compressed, ...lost];
    // 整体 review #3：缩小校验放在**补回之后** —— 否则补回后可能 >= 原始，但 needsCompaction
    // 仍真 → 每轮重压、永不收敛。补回后没变小 → 判这次压缩无效，fail-open 保原。
    // round2 #3：按**字节**量缩小（与 checkpointNeedsCompaction 一致），不按条数 ——
    // 同条数但每条 finding 大幅变短也是有效压缩，按条数会误判没缩、再次 fail-open 不收敛。
    // review#5 efficiency：只 stringify 一次 original（completed 侧在比较后即丢弃）。
    const originalBytes = JSON.stringify(checkpoint.completed).length;
    if (JSON.stringify(completed).length >= originalBytes) return checkpoint;
    const strArr = (v: unknown, fallback: string[]) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fallback;
    return {
      ...checkpoint, // 保留 version/goal/intent/successCount/producedAtIdx/digestTail/completedTodos(P0-S6,不送 LLM 压缩、原样跨轮保留)
      completed,
      remainingPlan: strArr(parsed.remainingPlan, checkpoint.remainingPlan),
      openQuestions: strArr(parsed.openQuestions, checkpoint.openQuestions),
      nextStep: typeof parsed.nextStep === 'string' ? parsed.nextStep : checkpoint.nextStep,
    };
  } catch (e) {
    if (signal.aborted) throw e; // 取消 → 透传，别误当压缩失败
    return checkpoint; // fail-open
  }
}

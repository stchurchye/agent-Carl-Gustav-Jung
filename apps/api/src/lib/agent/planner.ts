import type { AgentCheckpoint, Plan, PlanStep, TodoItem } from './types.js';
import { sanitizeMergedUsername } from './types.js';
import { toolRegistry, type ToolDef } from './toolRegistry.js';
import type { LlmChatClient, LlmChatMessage } from '../llm/types.js';
import type { AgentContextSnapshot } from './contextAdapter.js';
import { subagentToolsForRole } from './subagentTools.js';

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function extractStepCount(text: string): number {
  const arabic = text.match(/(\d+)\s*步/);
  if (arabic) return Math.min(Math.max(parseInt(arabic[1], 10), 1), 10);
  for (const [ch, n] of Object.entries(CN_NUM)) {
    if (new RegExp(`${ch}\\s*步`).test(text)) return Math.min(n, 10);
  }
  return 1;
}

/**
 * M1a echo-only planner. 不调 LLM，纯本地规则。
 * 当 M1c 把 LLM planner 接入后，此函数将保留作为 echo 工具的 fallback。
 */
export function generatePlanForEcho(text: string): Plan {
  const n = extractStepCount(text);
  const todos: TodoItem[] = [];
  const steps: PlanStep[] = [];
  for (let i = 1; i <= n; i++) {
    const todoId = `t${i}`;
    todos.push({
      id: todoId,
      text: `Echo 第 ${i} 次`,
      status: 'pending',
      stepRefs: [],
    });
    steps.push({
      toolName: 'echo_after_sleep',
      input: { text: `第 ${i} 次 echo`, sleepMs: 1500 },
      reason: `测试 runtime 第 ${i} 步`,
      todoId,
    });
  }
  return {
    intentSummary: `测试 agent 跑 ${n} 步 echo`,
    steps,
    todos,
    finalReplyHint: `回复：已完成 ${n} 次 echo，每次间隔 1.5s。`,
    reasoning: null,
    version: 1,
  };
}

// M1c：steer / approval_deny 重规划已从「M1b echo 桩」升级为 LLM-driven。
// 旧 generatePlanForSteer / generatePlanForApprovalDeny 已删 —— 现走
// applyReplanningIfNeeded 记 directive(steer 指令 / 被拒工具) + 清 plan → buildInitialPlan
// 把 directive 作为 replanDirective 喂 generatePlanWithLlm（最高优先级），让 planner 真改向 / 选替代。
// echo 计划仅作 buildInitialPlan 的无-LLM / 测试环境 fallback（generatePlanForEcho 保留）。

// =====================================================================
// M1c: LLM planner
// =====================================================================

export type LlmPlannerInput = {
  inputText: string;
  snapshot: AgentContextSnapshot;
  /**
   * M1e Task 11d：从 raw `apiKey: string` 升级为 provider-neutral client。
   * Caller 通过 `runLlmClient.resolveLlmClient(run)` 构造，传 null 时不会调到这里
   * （runPlanGlue 负责 short-circuit 到 echo）。
   */
  llm: LlmChatClient;
  /** 必须传，让 cancelRun 能中断 LLM 调用 */
  signal: AbortSignal;
  /** 默认 generalist。M1c 暂不区分 role。 */
  role?: string;
  /**
   * M1f #1：replan 场景下传入。让 LLM 知道上一步失败原因并避免重复同样错误。
   * caller（runPlanGlue / steer / approval_deny replan）按需填。
   */
  previousFailure?: string;
  /**
   * M3 ADR-3：子 run（parentRunId 非空）时为 true，planner 只允许白名单工具。
   * 防止子 agent 调 deep_research / ask_user / run_python 等危险/递归工具。
   */
  isSubagent?: boolean;
  /** M7 P1a：合并的追问；非空时 buildPlannerUserPrompt 拼入 "# 后续追问" 段。 */
  mergedInputs?: Array<{ text: string; byUserId: string; byUsername: string; at: string }>;
  /**
   * issue 0001 B2+B3：续跑(continuation-replan)重建时的「进展摘要」——已完成 todo +
   * 成功步骤观察。非空时 buildPlannerUserPrompt 拼入 "# 已完成进展" 段，让新 plan
   * 接着未完成的干、不重做已完成的，并基于已学到的结果规划。
   */
  progress?: string;
  /**
   * S3：累积式结构化 checkpoint。非空时 buildPlannerUserPrompt 渲染「# 任务状态（续跑中）」
   * 并附 sd0x 式重注入（"下一步 = …，不要问是否继续"），优先于扁平的 progress 字符串。
   * 注：nextStep 只是给 planner 的建议；是否收尾仍由 loop-end 的 reflection 单点裁决。
   */
  checkpoint?: AgentCheckpoint | null;
  /**
   * P0-S5:checkpoint 的注入框架。true(缺省,向后兼容)= 自动续跑框架(「不要问是否继续」);
   * false = steer/deny/critique/merge 等非续跑重规划 → 中性「已有任务进展(供参考)」框架,
   * 避免给用户新指令套上陈旧续跑话术。
   */
  checkpointIsContinuation?: boolean;
  /**
   * M1c steer/deny 重规划指令（替代旧 M1b echo 桩）。非空时 buildPlannerUserPrompt 渲染
   * 「# 用户中途指令（最高优先级）」段：steer = 用户改向要求；deny = 某工具被拒、改用替代。
   * 这是**用户/系统驱动的强制改向**，优先级高于原 inputText 的方向。
   */
  replanDirective?: string;
};

/**
 * 让 LLM 根据 input + context + 已注册工具生成 plan。
 *
 * M1e review followup（v0.m1e tag 前）：**不再吞 LLM 异常**。原来的 try/catch
 * 让 `buildInitialPlan` 那一层 emit `PLANNER_LLM_FALLBACK` notice 的代码路径成
 * 了死代码（test 用 `vi.mock` 直接 stub 这个函数，正好把死代码也 mock 住了）。
 *
 * 现在的契约：
 * - llm.chat throw  → 异常直接抛给 caller（`buildInitialPlan`），由它写 notice + system_error
 * - LLM 返回但 JSON 无法 parse → 抛 PlannerJsonParseError（caller 同样路径处理）
 * - 解析成功 → 返回 Plan
 *
 * caller 仍需 fallback 到 echo plan —— 这是 `buildInitialPlan` 的职责。
 */
export class PlannerJsonParseError extends Error {
  constructor(public readonly rawSnippet: string) {
    super(`planner LLM returned unparseable JSON: ${rawSnippet.slice(0, 200)}`);
    this.name = 'PlannerJsonParseError';
  }
}

/**
 * issue 0005(P0-S4):plan JSON 合法但引用了未注册(或角色子集外)的工具名。
 * generatePlanWithLlm 对此**带原因重试一次**;二次仍未知才抛本错误 ——
 * buildInitialPlan 收到后不再 echo 降级,记 system_error + notice 后透传,
 * 由 executeRun 收尾 failed(不悬挂、错误可见)。
 */
export class PlannerUnknownToolError extends Error {
  constructor(public readonly unknownTools: string[]) {
    super(`planner referenced unknown tools: ${unknownTools.join(', ')}`);
    this.name = 'PlannerUnknownToolError';
  }
}

export async function generatePlanWithLlm(
  input: LlmPlannerInput,
): Promise<Plan> {
  const allTools = toolRegistry.list();
  // M3-S1：子 agent 按 role 取工具子集(generalist=researcher 只读;analyst 含 run_python/render_diagram)。
  const tools = input.isSubagent
    ? allTools.filter((t) => subagentToolsForRole(input.role).has(t.name))
    : allTools;
  const systemPrompt = buildPlannerSystemPrompt(tools);
  const userPrompt = buildPlannerUserPrompt(input);

  const messages: LlmChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: input.snapshot.systemPrompt
        ? input.snapshot.systemPrompt + '\n\n---\n' + userPrompt
        : userPrompt,
    },
  ];

  const chatOpts = {
    temperature: 0.3,
    maxTokens: 1024,
    signal: input.signal,
  };
  const result = await input.llm.chat(messages, chatOpts);

  let parsed = parsePlannerJsonDetailed(result.content, tools);
  if (parsed.plan) return parsed.plan;
  if (parsed.unknownTools.length === 0) {
    throw new PlannerJsonParseError(result.content);
  }

  // issue 0005:LLM 幻造工具名 → 带原因**同一会话内重试一次**(原回答 + 纠错指令追加为新轮次),
  // 让 planner 看到自己引用了哪些不存在的工具。只重试一次:防 LLM 反复幻觉时无限循环。
  const retryNote = `上一版 plan 引用了不存在的工具:${parsed.unknownTools
    .map((n) => '`' + n + '`')
    .join('、')}。这些工具名不存在(或不在你的可用工具列表内),只能使用工具列表中列出的 name。请重新输出完整的严格 JSON plan,并确保每个 step.todoId 都能在 todos 数组里找到对应 id。`;
  const retryMessages: LlmChatMessage[] = [
    ...messages,
    { role: 'assistant', content: result.content },
    { role: 'user', content: retryNote },
  ];
  const retryResult = await input.llm.chat(retryMessages, chatOpts);
  parsed = parsePlannerJsonDetailed(retryResult.content, tools);
  if (parsed.plan) return parsed.plan;
  if (parsed.unknownTools.length > 0) {
    throw new PlannerUnknownToolError(parsed.unknownTools);
  }
  throw new PlannerJsonParseError(retryResult.content);
}

const PLANNER_INSTRUCTION = `你是任务规划器。读取用户的请求，挑选下列工具组成一个最小可行的 plan。
只输出**严格 JSON**，不要任何解释、不要 markdown 围栏、不要多余字段。

JSON 结构必须是：
{
  "intentSummary": "一句话概括用户想要什么",
  "steps": [
    {
      "toolName": "<上面工具列表里的 name>",
      "input": { ...符合该工具 inputSchema 的对象... },
      "reason": "为什么这一步",
      "todoId": "t1"
    }
  ],
  "todos": [
    { "id": "t1", "text": "对用户可读的待办描述", "status": "pending", "stepRefs": [] }
  ],
  "finalReplyHint": "执行完成后给用户的回复风格提示"
}

约束：
- 每个 step.todoId 必须能在 todos 数组里找到对应 id
- 不要发明不存在的 toolName
- steps 数量控制在 1-6 之间
- 若任务完全是闲聊或单步问答，可只放 1 个 step

工具调用约定（必读）：
- 调用前阅读 tool description 的 inputSchema
- 收到 observation 时检查 \`ok\` 字段：ok=false 或 error 字段非空 → 当前 step 失败
- 失败处理：
  a. 可以换参数重试（如不同搜索词 / 备选 url）→ 在新 plan 里补一个相同 tool 的 step
  b. 该工具能力本身不可用（持续 4xx/5xx）→ 跳过该工具，用其他工具达成目标
  c. 整条路径不可行 → 把已查到的部分写成 reply，明确告诉用户「X 不可达」
- 不要忽略 ok=false 直接进下一步

工具选型建议（心理学 / 经济学讨论场景）：
- **学术论断 / 理论名称 / 实证证据** → 优先 search_papers（OpenAlex+CrossRef），不要让 search_web 拿博客代替
- **概念定义 / 历史背景** → wikipedia 比 search_web 更稳
- **数字声明 / 计算 / 回归 / 画图** → run_python（沙箱里 statsmodels/pandas 都能用）
- **宏观经济数据**（GDP/CPI/失业率等） → get_economic_series 拉 FRED 官方数据，不要 LLM 拍脑袋
- **概念关系 / 因果图 / 流程** → render_diagram 生成 mermaid，让用户能看到结构
- **PDF / Word / Excel 链接** → document_reader
- **复杂论断（涉及"很多研究表明" / "数据支持" 等）后** → critique_last_answer 自检一次
- **时间相关问题** → 先调 datetime_now（你不知道今天是几号）
- **URL 用户粘的** → fetch_url
- **YouTube 链接（youtube.com / youtu.be）** → youtube_transcript({url})：比 fetch_url 拿到的网页 HTML 信息量更高，直接返回视频字幕文本
- **本系统知识库（用户导入的研究素材/资料）** → magi_system_read（研究知识库,不是聊天记忆）
- **回忆"用户是谁 / 以前聊过什么 / 之前学到的事"（跨会话长期记忆）** → recall_memory({query})（区别于 magi_system_read：这是 agent 自己的情景记忆,不是研究库）
- **问题模糊 / 缺关键前提**（"画个图" "做个分析" 没说数据源 / 时间范围） → 先 ask_user 反问，不要硬猜
- **需要多步深挖一个子问题**（如 "近 5 年关于禀赋效应的实证支持" / "X 理论的当前争议"） → deep_research 派子 agent，比串多个 search_papers + fetch_url 更整洁
- **需要某个旧步骤的完整细节**（"最近步骤"近窗里已滚出、或只剩摘要的那步） → recall_step({stepIdx}) 按步骤号重读完整原文（stepIdx 取自 [步骤 N] 标注或"更早 N 条已略"提示）
- **绝对禁止**：在 deep_research 子任务里嵌套 deep_research / ask_user（运行时会拦截）
`;

function buildPlannerSystemPrompt(tools: ToolDef[]): string {
  const toolBlock = tools
    .map((t) => {
      const schema = JSON.stringify(t.inputSchema).slice(0, 400);
      const hint = t.replyMeta?.failureHint
        ? `\n  失败常见原因：${t.replyMeta.failureHint}`
        : '';
      return `- ${t.name}: ${t.description}\n  inputSchema: ${schema}${hint}`;
    })
    .join('\n');
  return `${PLANNER_INSTRUCTION}\n\n可用工具：\n${toolBlock}`;
}

function buildPlannerUserPrompt(input: LlmPlannerInput): string {
  const summary = input.snapshot.shortSummary
    ? `\n\n# 当前上下文摘要\n${input.snapshot.shortSummary}`
    : '';
  const failure = input.previousFailure
    ? `\n\n# 上一步失败原因\n${input.previousFailure}\n请基于这个失败重新规划剩余步骤，避免重复同样错误。`
    : '';
  // S3：有 checkpoint 时渲染结构化「任务状态」（含 sd0x 重注入），优先于扁平 progress。
  // issue 0001 B2+B3：无 checkpoint（或 checkpoint 渲染为空——全 soft-fail 等边角）时退回
  // 续跑进展摘要。整体 review #5：checkpoint 渲染空串也要落到 progress 兜底，别让续跑
  // re-planner 拿不到任何先前上下文。
  const cpRender = input.checkpoint
    ? renderCheckpointState(input.checkpoint, input.checkpointIsContinuation ?? true)
    : '';
  const progress =
    cpRender ||
    (input.progress
      ? `\n\n# 已完成进展\n${input.progress}\n请接着还没完成的部分继续，不要重做上面已完成的 todo；可基于已得到的结果规划下一步。`
      : '');
  // M7 P1a：合并的追问段（不污染 DB，每次 planner 调用按当前 merged_inputs 全量拼）。
  const merged = input.mergedInputs ?? [];
  const mergedSection =
    merged.length > 0
      ? `\n\n# 后续追问（合并自其他成员，需在新 plan 中一并回应）\n` +
        merged.map((m, i) => `${i + 1}. @${sanitizeMergedUsername(m.byUsername)} (${m.at}): ${m.text}`).join('\n')
      : '';
  // M1c steer/deny 重规划：用户/系统中途强制改向。优先级**高于**原 inputText 方向——
  // 与之冲突的原计划应放弃，据此重新规划剩余步骤。
  const directive = input.replanDirective
    ? `\n\n# 用户中途指令（最高优先级，必须遵循）\n${input.replanDirective}\n请据此重新规划剩余步骤；与此冲突的原计划方向应放弃。`
    : '';
  return `# 用户请求\n${input.inputText}${directive}${mergedSection}${summary}${failure}${progress}`;
}

/**
 * S3：把累积 checkpoint 渲染成 planner 的「任务状态」段 + sd0x 式重注入。
 * 让续跑接着已完成的干、基于已确认发现规划，并明确"别问是否继续、直接规划剩余步骤"。
 */
/** planner prompt 里最多渲染多少条累积发现（防长 run 撑爆；S4 会进一步压缩列表）。 */
const CHECKPOINT_RENDER_MAX_FINDINGS = 20;
/** 累积发现渲染字节上限。v4 后单条 finding 可达 2000 字 → 仅限条数不够，须再按字节收口。 */
const CHECKPOINT_RENDER_MAX_CHARS = 10000;
/** 近窗 digestTail 在 planner prompt 里的字节上限（digestTail 整体可达 32K）。 */
const CHECKPOINT_RENDER_DIGEST_MAX_CHARS = 6000;

function renderCheckpointState(cp: AgentCheckpoint, isContinuation = true): string {
  // 全空（无发现、无待办）→ 不渲染"自动续跑中"框架，避免给裸目标 + "别问是否继续"的误导。
  if (cp.completed.length === 0 && cp.remainingPlan.length === 0) return '';

  // 先按条数取最近 20，再按字节预算从最近往前收（planner 偏好近期进展；富 finding 不撑爆）。
  const recent = cp.completed.slice(-CHECKPOINT_RENDER_MAX_FINDINGS);
  const lines = recent.map((c) => (c.finding ? `- ${c.text}: ${c.finding}` : `- ${c.text}`));
  const keptLines: string[] = [];
  let usedChars = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (keptLines.length > 0 && usedChars + lines[i].length + 1 > CHECKPOINT_RENDER_MAX_CHARS) break;
    keptLines.unshift(lines[i]);
    usedChars += lines[i].length + 1;
  }
  const overflow = cp.completed.length - keptLines.length;
  const done =
    cp.completed.length > 0
      ? '\n已确认的发现（不要重做）：\n' +
        (overflow > 0 ? `（更早 ${overflow} 条已略）\n` : '') +
        keptLines.join('\n')
      : '';
  const remaining =
    cp.remainingPlan.length > 0
      ? '\n待完成：\n' + cp.remainingPlan.map((t) => `- ${t}`).join('\n')
      : '';
  const next = cp.nextStep ? `\n下一步 = ${cp.nextStep}` : '';
  // v5：把近窗逐字 digestTail 接进 planner（此前只进 reply 终稿 → planner 续跑只能看
  // ≤2000 字摘要、看不到最近几步逐字细节）。限 6000 字防撑爆；带 [步骤 N] 标注，
  // 模型可据此 recall_step({idx}) 重读已滚出近窗的旧步完整原文。
  const tail = cp.digestTail
    ? `\n\n最近步骤（逐字近窗，需更早细节可 recall_step(步骤号)）：\n${cp.digestTail.slice(0, CHECKPOINT_RENDER_DIGEST_MAX_CHARS)}`
    : '';
  // P0-S5 双框架:续跑用「自动续跑中 + 不要问是否继续」;steer/deny/critique/merge 等
  // 非续跑重规划用中性框架 —— 进展仅供参考、新指令优先,不复用续跑话术。
  if (!isContinuation) {
    return (
      `\n\n# 已有任务进展（供参考）\n目标：${cp.goal}${done}${remaining}${tail}` +
      `\n（以上为此前进展，仅供参考避免重做；请优先遵循新指令/最新方向规划剩余步骤。）`
    );
  }
  return (
    `\n\n# 任务状态（自动续跑中）\n目标：${cp.goal}${done}${remaining}${next}${tail}` +
    `\n（自动续跑仍在进行；请直接规划剩余步骤，不要问"是否继续"。）`
  );
}

type LooseStep = {
  toolName?: unknown;
  input?: unknown;
  reason?: unknown;
  todoId?: unknown;
};

type LooseTodo = {
  id?: unknown;
  text?: unknown;
  status?: unknown;
  stepRefs?: unknown;
};

type LoosePlan = {
  intentSummary?: unknown;
  steps?: unknown;
  todos?: unknown;
  finalReplyHint?: unknown;
};

/**
 * M1f #4：宽容解析 LLM 输出。处理常见污染：
 * - markdown 围栏（```json / ``` 都剥）
 * - 前后散文（截取第一个 { 到对应 } 的子串）
 * - 尾随逗号（,} → } / ,] → ]）
 * - CRLF（normalize 到 LF）
 *
 * 不引入 JSON5；只做 regex / bracket-counter 预处理 + 一次 JSON.parse。
 */
function tryParseJson(raw: string): LoosePlan | null {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;
  try {
    const v = JSON.parse(candidate) as LoosePlan;
    if (!v || typeof v !== 'object') return null;
    return v;
  } catch {
    return null;
  }
}

export function extractJsonCandidate(raw: string): string | null {
  let s = raw.replace(/\r\n/g, '\n').trim();

  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }

  // 截取第一个 { ... } 平衡子串（应对前后散文 / string 内含 }）
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  let body = s.slice(start, end + 1);

  // 去尾随逗号：,} / ,] / ,\s*}。
  // M1f polish #2：原 regex `,(\s*[}\]])` 不区分字符串字面量，会把
  // `{"hint":"lookup foo,]"}` 这种正常 string 误剪成 `lookup foo]`。
  // 走和上面 bracket-counter 同款的字符串状态机，只剪 JSON 结构里的尾逗号。
  body = stripTrailingCommas(body);

  return body;
}

function stripTrailingCommas(body: string): string {
  const out: string[] = [];
  let inStr = false;
  let escape = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (escape) {
      out.push(c);
      escape = false;
      continue;
    }
    if (c === '\\') {
      out.push(c);
      escape = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      out.push(c);
      continue;
    }
    if (!inStr && c === ',') {
      // peek：跳过空白后若紧跟 } 或 ] 才丢逗号
      let j = i + 1;
      while (j < body.length && /\s/.test(body[j])) j++;
      if (j < body.length && (body[j] === ']' || body[j] === '}')) {
        continue;
      }
    }
    out.push(c);
  }
  return out.join('');
}

export function parsePlannerJson(raw: string, tools: ToolDef[]): Plan | null {
  return parsePlannerJsonDetailed(raw, tools).plan;
}

/**
 * issue 0005:parsePlannerJson 的细分版 —— 区分「JSON/结构坏」(unknownTools=[])与
 * 「JSON 合法但引用了未注册/角色子集外的工具名」(unknownTools 点名,去重)。
 * generatePlanWithLlm 据此决定:结构坏 → PlannerJsonParseError(原契约);
 * 未知工具 → 带原因重试一次。
 */
export function parsePlannerJsonDetailed(
  raw: string,
  tools: ToolDef[],
): { plan: Plan | null; unknownTools: string[] } {
  // 每次新建对象:多个调用方共享同一 {plan,unknownTools} 引用会有被改写串味的风险。
  const fail = () => ({ plan: null, unknownTools: [] as string[] });
  const obj = tryParseJson(raw);
  if (!obj) return fail();
  const knownNames = new Set(tools.map((t) => t.name));

  if (typeof obj.intentSummary !== 'string') return fail();
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) return fail();
  if (!Array.isArray(obj.todos) || obj.todos.length === 0) return fail();

  const todos: TodoItem[] = [];
  for (const raw of obj.todos as LooseTodo[]) {
    if (typeof raw.id !== 'string' || typeof raw.text !== 'string') return fail();
    todos.push({
      id: raw.id,
      text: raw.text,
      status: 'pending',
      stepRefs: [],
    });
  }
  const todoIds = new Set(todos.map((t) => t.id));

  const steps: PlanStep[] = [];
  const unknownTools: string[] = [];
  for (const raw of obj.steps as LooseStep[]) {
    if (typeof raw.toolName !== 'string') return fail();
    if (!knownNames.has(raw.toolName)) {
      // 未知工具:继续扫完整个 steps,把所有幻造的工具名一次性点给 LLM 纠正。
      if (!unknownTools.includes(raw.toolName)) unknownTools.push(raw.toolName);
      continue;
    }
    if (typeof raw.todoId !== 'string' || !todoIds.has(raw.todoId)) return fail();
    steps.push({
      toolName: raw.toolName,
      input: (raw.input ?? {}) as Record<string, unknown>,
      reason: typeof raw.reason === 'string' ? raw.reason : '',
      todoId: raw.todoId,
    });
  }
  if (unknownTools.length > 0) return { plan: null, unknownTools };

  return {
    plan: {
      intentSummary: obj.intentSummary,
      steps,
      todos,
      finalReplyHint:
        typeof obj.finalReplyHint === 'string' ? obj.finalReplyHint : '',
      reasoning: null,
      version: 1,
    },
    unknownTools: [],
  };
}

// =====================================================================
// M1f：仅测试用 export
//
// 命名约定（M1f 起）：`_<name>ForTest` 表示"该 export 仅供单元测试访问 module
// 内部 helper，不属于稳定 public API"。生产代码请不要 import；如果发现需要
// 在生产里用，先把它升级为正式 export（去 `_` 前缀和 `ForTest` 后缀）。
// 后续模块如有同样需求请沿用此约定。
// =====================================================================
export const _buildPlannerSystemPromptForTest = buildPlannerSystemPrompt;
export const _buildPlannerUserPromptForTest = buildPlannerUserPrompt;

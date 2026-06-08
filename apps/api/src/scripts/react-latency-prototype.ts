/**
 * M2-S0 throwaway prototype —— 实测 ReAct(每步一次 LLM)延迟 vs 现有 plan-once,产 go/no-go 真数字。
 *
 * 背景:docs/issues/0000 把 Phase 2 纯 ReAct 暂缓,要求"先估算/实测延迟达标再 opt-in 共存"。
 * 本脚本是那个前置实测。**不碰生产 runExecute/worker/agent_runs**,直连 DeepSeek raw fetch。
 *
 * 量什么:LLM 往返延迟 —— react = 每步一次 LLM(总延迟≈步数×往返);plan-once = 一次 LLM 出完整 N 步。
 * 工具执行 **stub-instant**(react/plan-once 工具耗时相同,不是变量;变量是 LLM 往返次数)。
 *
 * 跑:  set -a; . <repo>/.env; set +a   # 或 export DEEPSEEK_API_KEY=sk-...
 *       npx tsx src/scripts/react-latency-prototype.ts
 * 可调:DEEPSEEK_MODEL(默认 deepseek-chat)、ITERS(每任务迭代次数,默认 3)。
 */

const KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
const BASE = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
const ITERS = Number(process.env.ITERS ?? 3);
const STEP_CAP = 8;

if (!KEY) {
  console.error('缺 DEEPSEEK_API_KEY(set -a; . repo/.env 或 export)。');
  process.exit(1);
}

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

async function chat(
  messages: ChatMsg[],
  maxTokens: number,
): Promise<{ content: string; ms: number; tokens: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: maxTokens }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };
  return { content: j.choices?.[0]?.message?.content ?? '', ms, tokens: j.usage?.total_tokens ?? 0 };
}

// 代表性工具目录(真实工具名子集;喂 prompt 让 LLM 选择,贴近生产 token 规模)。
const TOOL_LIST = [
  'web_search: 联网搜索',
  'fetch_url: 抓取网页正文',
  'wikipedia: 查维基',
  'run_python: 在沙箱跑 Python',
  'datetime_now: 取当前日期时间',
  'recall_memory: 召回长期记忆',
  'document_reader: 读用户文档',
  'render_diagram: 画图',
  'deep_research: 派子 agent 做深度研究',
]
  .map((t) => `- ${t}`)
  .join('\n');

// 代表性任务(预期步数 1 / 3 / 5)
const TASKS = [
  { name: '单步', goal: '现在几点?' },
  {
    name: '多步(查+算+答)',
    goal: '查今天日期,算出距 2026 年元旦还有多少天,用一句话回答。',
  },
  {
    name: '多步研究式',
    goal: '研究「流浪猫冬天怎么保暖」,给 3 条可执行建议并各说依据。',
  },
];

// 稳健提取 JSON:剥 ```json 围栏,取第一个 { 或 [ 到对应的最后一个 } 或 ]。
function extractJson(s: string): string {
  const noFence = s.replace(/```(?:json)?/gi, '').trim();
  const obj = noFence.indexOf('{');
  const arr = noFence.indexOf('[');
  const start = obj === -1 ? arr : arr === -1 ? obj : Math.min(obj, arr);
  if (start === -1) return noFence;
  const open = noFence[start];
  const close = open === '{' ? '}' : ']';
  return noFence.slice(start, noFence.lastIndexOf(close) + 1);
}

// 给工具一个**可用的假观察**,让 ReAct 能自然收敛(否则空观察 → 死循环跑满 cap,步数不真实)。
function cannedResult(tool: string): string {
  if (tool === 'datetime_now') return `当前时间 ${new Date().toISOString()}`;
  if (tool === 'web_search' || tool === 'wikipedia')
    return '检索到 3 条相关结果:① 保暖窝要离地防潮;② 用旧衣物+反光毯;③ 喂高热量湿粮。';
  if (tool === 'run_python') return '计算结果:23';
  if (tool === 'recall_memory') return '(无相关长期记忆)';
  return '(已执行,返回简短结果)';
}

const lastJsonLine = (s: string): string => extractJson(s);

// ReAct:每步一次 LLM 选 {tool} 或 {done}
async function runReact(goal: string) {
  const obs: string[] = [];
  const perStep: number[] = [];
  let steps = 0;
  let tokens = 0;
  const t0 = Date.now();
  while (steps < STEP_CAP) {
    const sys = `你是 ReAct agent。可用工具:\n${TOOL_LIST}\n每步只输出一行 JSON:{"tool":"名","input":{}} 选下一个工具,或 {"done":true,"answer":"最终答复"} 收尾。不要解释。`;
    const user = `目标:${goal}\n已观察:\n${obs.length ? obs.join('\n') : '(无)'}`;
    const r = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], 300);
    perStep.push(r.ms);
    tokens += r.tokens;
    steps++;
    let parsed: { tool?: string; done?: boolean };
    try {
      parsed = JSON.parse(lastJsonLine(r.content));
    } catch {
      obs.push('(上一步输出无法解析,重试)');
      continue;
    }
    if (parsed.done) break;
    const tool = parsed.tool ?? '?';
    obs.push(`[${tool}] → ${cannedResult(tool)}`); // 工具 stub-instant(可用假结果,助 react 收敛)
  }
  return { totalMs: Date.now() - t0, steps, perStep, tokens };
}

// plan-once:一次 LLM 出完整 N 步 plan
async function runPlanOnce(goal: string) {
  const sys = `你是规划器。可用工具:\n${TOOL_LIST}\n一次性输出完成目标所需的完整步骤 JSON 数组 [{"tool":"名","input":{}}],可含最后一步 {"reply":"..."}。只输出 JSON 数组。`;
  const r = await chat([{ role: 'system', content: sys }, { role: 'user', content: `目标:${goal}` }], 800);
  let planSteps = 0;
  try {
    const arr = JSON.parse(lastJsonLine(r.content));
    if (Array.isArray(arr)) planSteps = arr.length;
  } catch {
    /* ignore */
  }
  return { totalMs: r.ms, planSteps, tokens: r.tokens };
}

const pct = (arr: number[], p: number): number => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

async function main() {
  console.log(`# M2-S0 ReAct vs plan-once 延迟 prototype`);
  console.log(`model=${MODEL} base=${BASE} iters/task=${ITERS} step_cap=${STEP_CAP}\n`);
  for (const task of TASKS) {
    const reactRuns: Awaited<ReturnType<typeof runReact>>[] = [];
    const planRuns: Awaited<ReturnType<typeof runPlanOnce>>[] = [];
    for (let i = 0; i < ITERS; i++) {
      reactRuns.push(await runReact(task.goal));
      planRuns.push(await runPlanOnce(task.goal));
    }
    const rTot = reactRuns.map((x) => x.totalMs);
    const pTot = planRuns.map((x) => x.totalMs);
    const allStep = reactRuns.flatMap((x) => x.perStep);
    console.log(`## ${task.name} — 「${task.goal}」`);
    console.log(
      `  react   : 总 p50=${pct(rTot, 50)}ms p95=${pct(rTot, 95)}ms | 步数 ${reactRuns
        .map((x) => x.steps)
        .join('/')} | 每步 LLM p50=${pct(allStep, 50)}ms p95=${pct(allStep, 95)}ms`,
    );
    console.log(
      `  planOnce: 总 p50=${pct(pTot, 50)}ms p95=${pct(pTot, 95)}ms | 计划步数 ${planRuns
        .map((x) => x.planSteps)
        .join('/')}`,
    );
    const ratio = pct(rTot, 50) / Math.max(1, pct(pTot, 50));
    console.log(`  → react/planOnce 总延迟倍率 p50≈${ratio.toFixed(1)}x\n`);
  }
  console.log(
    '注:工具执行 stub-instant,量的是 LLM 往返(react=每步一次,planOnce=一次)。\ngo/no-go:看多步任务 react 的 p95 总延迟是否落在你能接受的上限内。',
  );
}

void main();

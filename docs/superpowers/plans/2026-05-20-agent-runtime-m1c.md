# Agent Runtime M1c Implementation Plan — 第一个真 Agent

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** 把 M1a/M1b 的 echo mock runtime 升级为能「搜资料 → 读网页 → 写文档 → 调 magi」的真 agent：5 个 M1 工具 + LLM planner + LLM final reply + runtime 幂等恢复 + intent 升级。

**Architecture:**
- **工具层**：在 `toolRegistry` 注册 5 个 ToolDef；读工具 Tier A（auto），写工具 Tier B/C（ask + idempotency key）。
- **规划层**：`planner.ts` 新增 `generatePlanWithLlm()`，把 `snapshotForAgent` + 全部 tool schema 喂给现有 chat LLM；保留 `generatePlanForEcho` 作测试 fallback。
- **执行层**：`runtime.ts` 工具循环前查 `tool_call_key` 缓存（`store.findStepByToolCallKey`）；命中则跳过 handler、直接写 `observe`。
- **收尾层**：新增 `replyGen.ts`，终态前用 LLM 根据 steps 输出摘要 + 文档链接。
- **入口层**：`intentRules.ts` 按 spec §10.2 加关键词/长文/URL+动词规则；`intentAnalyzer.pickAutoExecute` 加 agent 高阈值。

**Tech Stack:** 现有 DeepSeek/Zenmux 调用链（复用 `contextPipeline` 或抽 `callChatLlm`）、Tavily API、`undici` + `@mozilla/readability` + `jsdom`、现有 `integrations/magi.ts`、PG `documents` 表。

**前置：** `main` 已含 M1b（tag `v0.m1b`）。

**Spec：** §10.2–10.4、§11、§17–18.3、T9/T10

**估时：** 约 **4 天**（32–40h 纯编码）

---

## Pre-Task

```bash
git checkout main
git pull   # 若有多机
git checkout -b feat/agent-runtime-m1c
set -a; source .env; set +a
pkill -f "tsx watch.*行动中止派" 2>/dev/null
npm run typecheck && npm run test -w @xzz/api   # baseline 87 tests
```

`.env.example` 追加（implementer 同步文档）：

```
TAVILY_API_KEY=
# 已有 MAGI_* 保持不变
```

---

## File Structure

新建：

```
apps/api/src/lib/agent/replyGen.ts
apps/api/src/lib/agent/mcpAdapter.ts
apps/api/src/lib/agent/tools/webSearch.ts
apps/api/src/lib/agent/tools/urlFetch.ts
apps/api/src/lib/agent/tools/docExportMarkdown.ts
apps/api/src/lib/agent/tools/magiSystemRead.ts
apps/api/src/lib/agent/tools/magiContentIngest.ts
apps/api/src/lib/agent/__tests__/tools.webSearch.test.ts
apps/api/src/lib/agent/__tests__/tools.urlFetch.test.ts
apps/api/src/lib/agent/__tests__/tools.docExport.test.ts
apps/api/src/lib/agent/__tests__/tools.magi.test.ts
apps/api/src/lib/agent/__tests__/planner.llm.test.ts
apps/api/src/lib/agent/__tests__/runtime.idempotency.test.ts
apps/api/src/lib/agent/__tests__/runtime.research.e2e.test.ts
apps/api/src/lib/__tests__/intentRules.agentUpgrade.test.ts
```

修改：

```
apps/api/package.json                          # 加 tavily / readability / jsdom
apps/api/src/lib/agent/runtime.ts              # idempotency gate + replyGen
apps/api/src/lib/agent/planner.ts              # LLM planner
apps/api/src/lib/agent/stepRecorder.ts         # 可选：helper 生成 toolCallKey
apps/api/src/lib/intentRules.ts                # §10.2 规则
apps/api/src/lib/intentAnalyzer.ts             # pickAutoExecute agent 阈值
apps/api/src/index.ts                          # register M1c tools
.env.example
README.md
```

---

## Task 1: Runtime 幂等 gate（T10 基础）

**Files:**
- Modify: `apps/api/src/lib/agent/runtime.ts`
- Create: `apps/api/src/lib/agent/__tests__/runtime.idempotency.test.ts`

### 1.1 实现 `resolveToolCallKey` + 缓存命中

在 `executeRun` 工具循环内、approval gate 之后：

```typescript
function resolveToolCallKey(tool: ToolDef, planStep: PlanStep): string | null {
  if (!tool.computeIdempotencyKey) return null;
  return `${tool.name}:${tool.computeIdempotencyKey(planStep.input)}`;
}

// 执行前：
const toolCallKey = resolveToolCallKey(tool, planStep);
if (toolCallKey) {
  const cached = await store.findStepByToolCallKey(runId, toolCallKey);
  if (cached?.output) {
    await recordStep({ runId, kind: 'observe', toolName: tool.name, input: { cached: true }, output: cached.output });
    // usage.steps++ 并 continue
  }
}

// tool_call step 写入时带上 toolCallKey
await recordStep({ ..., kind: 'tool_call', toolCallKey, ... });
```

**注意：** 同 run 内重试不应重复调外部 API；跨 run 是否共享缓存 — M1c 先 **仅同 runId** 查重（与 store 现有 unique `(run_id, tool_call_key)` 一致）。跨 run 全局缓存可 defer M1d。

### 1.2 测试

- 注册一个带 `computeIdempotencyKey` 的 mock 工具，两次 loop 同 input → 只 1 次 handler 调用。
- `findStepByToolCallKey` 返回 prior output。

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/runtime.idempotency.test.ts
git commit -m "feat(agent): tool_call_key idempotency gate in runtime"
```

---

## Task 2: `magiSystemRead` + `magiContentIngest` 工具

**Files:**
- Create: `apps/api/src/lib/agent/tools/magiSystemRead.ts`
- Create: `apps/api/src/lib/agent/tools/magiContentIngest.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.magi.test.ts`

### 2.1 magiSystemRead

```typescript
// approvalMode: 'auto', hasSideEffects: false, idempotent: true
// input: { question: string }
// output: { answer: string }
// handler: queryMagiSystem(input.question)
```

### 2.2 magiContentIngest

```typescript
// approvalMode: 'ask', hasSideEffects: true, idempotent: false
// computeIdempotencyKey: (input) => sha256(input.url)
// handler:
//   1) 查 documents 表 payload 是否已有同 url 摘要（jsonb 路径）
//   2) 无则 ingestMagiContent(url)，把结果写入 documents（或 agent 专用 cache 表 — 优先复用 documents payload.agentIngestCache）
//   3) 返回 { title, summary, videoUrl?, documentId? }
```

未启用 magi 时返回友好 stub（不抛），让 planner 能 replan。

### 2.3 测试

- mock `integrations/magi.ts` 或 env 未启用 → stub 文本。
- 同 URL 两次 ingest → 第二次不调 fetch（查本地 cache）。

```bash
git commit -m "feat(agent): magiSystemRead + magiContentIngest tools"
```

---

## Task 3: `webSearch` + `urlFetch` 工具

**Files:**
- Create: `apps/api/src/lib/agent/tools/webSearch.ts`
- Create: `apps/api/src/lib/agent/tools/urlFetch.ts`
- Tests: `tools.webSearch.test.ts`, `tools.urlFetch.test.ts`

### 3.1 依赖

```bash
npm i @tavily/core @mozilla/readability jsdom -w @xzz/api
```

`webSearch`：无 `TAVILY_API_KEY` 时返回 `{ results: [], note: '搜索未配置' }`（测试可 mock）。

`urlFetch`：`undici` fetch HTML → JSDOM + Readability → `{ title, textContent, excerpt }`；超时 30s；失败抛错供 runtime 重试/replan。

### 3.2 Schema（给 planner）

```typescript
// web_search: { query: string, maxResults?: number }
// url_fetch: { url: string }
```

```bash
git commit -m "feat(agent): webSearch (Tavily) + urlFetch (readability) tools"
```

---

## Task 4: `docExportMarkdown` 工具

**Files:**
- Create: `apps/api/src/lib/agent/tools/docExportMarkdown.ts`
- Test: `tools.docExport.test.ts`

### 4.1 实现

```typescript
// input: { title: string, markdown: string }
// computeIdempotencyKey: (i) => sha256(`${ctx.ownerId}:${i.title}`)
// handler: createDocument 或 updateDocument（同 title upsert）
// output: { documentId: string, title: string }
// approvalMode: 'auto'（M1c 先 auto；写 documents 算 Tier B 但用户预期要自动出稿）
// hasSideEffects: true, idempotent: true
```

复用 `store/pg.ts` 的 `createDocument` / `updateDocument`。

### 4.2 测试

- 同 title 两次 export → 同一 `documentId`，内容被覆盖。

```bash
git commit -m "feat(agent): docExportMarkdown tool (documents upsert)"
```

---

## Task 5: LLM Planner

**Files:**
- Modify: `apps/api/src/lib/agent/planner.ts`
- Create: `apps/api/src/lib/agent/__tests__/planner.llm.test.ts`

### 5.1 `generatePlanWithLlm`

```typescript
export async function generatePlanWithLlm(params: {
  inputText: string;
  snapshot: AgentContextSnapshot;
  apiKey: string;
  role?: AgentRole;
}): Promise<Plan>
```

**Prompt 结构（简化）：**
1. system：你是任务规划器；可用工具列表（`toolRegistry.list(role)` 的 name + description + inputSchema 摘要）。
2. user：`inputText` + `snapshot.shortSummary` + 要求输出 **严格 JSON** `{ intentSummary, steps: [{toolName,input,reason,todoId}], todos, finalReplyHint }`。
3. 解析 JSON；校验 `toolName` 均存在；非法则 fallback `generatePlanForEcho` 或单步 `magi_system_read`。

**M1c 验收路径 plan 示例**（测试可 assert 结构，不必真调 LLM）：
- 输入含「研究家族信托写成 md」→ steps 含 `web_search` → 若干 `url_fetch` → `doc_export_markdown`。

### 5.2 `runtime.ts` 接入

`createAgentRun` / replanning 分支：若 `inputText` 不匹配 `/echo|测试/` 且非 test env 强制 echo，则调 `generatePlanWithLlm`；测试 env 仍可用 echo 保持 CI 快。

```bash
git commit -m "feat(agent): LLM planner with tool schema"
```

---

## Task 6: `replyGen.ts` 终稿回复

**Files:**
- Create: `apps/api/src/lib/agent/replyGen.ts`
- Modify: `apps/api/src/lib/agent/runtime.ts`（`softComplete` 前调用）

### 6.1 实现

```typescript
export async function generateFinalReply(params: {
  run: AgentRun;
  plan: Plan;
  steps: AgentStep[];
  apiKey: string;
}): Promise<string>
```

- 把 plan.finalReplyHint + 最近 tool_call outputs 摘要喂给 LLM。
- 若有 `doc_export_markdown` 成功 step，在回复末尾附 `documentId` / 深链（mobile 后续 M1d 做可点链接；M1c 先纯文本）。

`softComplete`：`finalContent = await generateFinalReply(...)` 替代 echo 占位文案。

```bash
git commit -m "feat(agent): LLM final reply generation"
```

---

## Task 7: Intent 规则升级（§10.2 + T9）

**Files:**
- Modify: `apps/api/src/lib/intentRules.ts`
- Modify: `apps/api/src/lib/intentAnalyzer.ts`（`pickAutoExecute`）
- Create: `apps/api/src/lib/__tests__/intentRules.agentUpgrade.test.ts`

### 7.1 intentRules

在 `collectRuleMatches` 末尾、chat 兜底前插入 spec §10.2 的 `AGENT_KEYWORDS_RE` / `URL+动词` / `长文+问号` 规则；`forceChips: true`。

**互斥：** 纯 `记住 X` 仍走 memory；纯 URL 无动词仍走 `magi_content_link`。

### 7.2 pickAutoExecute

```typescript
if (top.kind === 'agent_run') {
  if (top.confidence < 0.92) return false;
  if (second && top.confidence - second.confidence < 0.20) return false;
}
```

### 7.3 测试

| 输入 | 期望 top candidate |
|------|------------------|
| `帮我研究家族信托` | agent_run |
| `记住我喜欢猫` | memory_*（非 agent） |
| `https://x.com/foo` | magi_content_link |
| `https://x.com/foo 帮我总结` | agent_run |

```bash
git commit -m "feat(intent): agent_run upgrade rules + stricter autoExecute"
```

---

## Task 8: MCP Adapter 骨架

**Files:**
- Create: `apps/api/src/lib/agent/mcpAdapter.ts`
- Create: `apps/api/src/lib/agent/__tests__/mcpAdapter.test.ts`

### 8.1 实现

```typescript
export async function loadMcpTools(config: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}): Promise<ToolDef[]>
```

M1c：**不连真实 MCP 进程**；返回内置 mock tool `mcp_echo`（注册到 registry 仅测试用），证明协议可扩展。

```bash
git commit -m "feat(agent): mcpAdapter skeleton + mock server test"
```

---

## Task 9: 注册工具 + index 启动

**Files:**
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/src/lib/agent/registerTools.ts`（可选集中 register）

```typescript
export function registerAgentTools(): void {
  registerEchoSleep();       // 保留测试
  registerWebSearch();
  registerUrlFetch();
  registerDocExportMarkdown();
  registerMagiSystemRead();
  registerMagiContentIngest();
  if (process.env.NODE_ENV !== 'production') registerRiskyEcho();
}
```

```bash
git commit -m "feat(agent): register M1c tools at startup"
```

---

## Task 10: E2E 研究流程测试（T10 部分）

**Files:**
- Create: `apps/api/src/lib/agent/__tests__/runtime.research.e2e.test.ts`

### 10.1 策略

- **无 API key 时 skip**：`describe.skipIf(!process.env.TAVILY_API_KEY)`。
- **有 key 时**：跑缩短 plan（mock planner 返回固定 3 步：web_search → url_fetch → doc_export）验证 runtime 串联。
- **Idempotency**：magi ingest mock 两次同 URL → handler 调用计数 = 1。

### 10.2 Crash recovery（T10 完整）

模拟：在 `tool_call` 写入后、手动插入带 `tool_call_key` 的 completed step，再 `executeRun` → 不应第二次调 handler。

```bash
npm run test -w @xzz/api
git commit -m "test(agent): research e2e + idempotency integration"
```

---

## Task 11: README + .env.example + 验收

### 11.1 README

新增 **Agent Runtime M1c** 节：工具列表、env 变量、示例 prompt（`@agent 帮我研究…`）、与 M1b echo 测试命令区分。

### 11.2 手工验收

1. 配置 `TAVILY_API_KEY` + magi env（可选）
2. `npm run dev:api` + mobile
3. 私聊：`@agent 帮我研究家族信托，整理成 markdown 文档`
4. AgentRunCard 出现 web_search / url_fetch / doc_export steps
5. 完成后聊天里有文档 ID 摘要
6. `SELECT * FROM agent_event_logs` 有事件流

```bash
npm run typecheck
npm run test -w @xzz/api
npm run test -w @xzz/shared
git add README.md .env.example docs/superpowers/plans/2026-05-20-agent-runtime-m1c.md
git commit -m "docs: M1c real agent tools + planner"
```

---

## 验收清单（spec §18.3）

| # | 验收项 | Task |
|---|--------|------|
| 1 | 端到端：研究 + 写 md 文档 | 5–6, 10 |
| 2 | url_fetch 失败 → 重试/replan | 3, 5（runtime 已有 retry 1 次） |
| 3 | magi ingest 同 URL 缓存 | 2, 1 |
| 4 | MCP adapter 加载 mock | 8 |
| 5 | T10 idempotency PASS | 1, 10 |
| 6 | T9 intent 升级 PASS | 7 |

---

## Self-Review 备注

- **LLM 调用复用**：implementer 先 grep `prepareChatContext` / `routeToLlm` / `privateChat` 找最简封装，避免新造轮子。
- **测试策略**：CI 默认不依赖 Tavily；集成测试用 mock planner + mock fetch。
- **工具命名**：与 spec 一致用 snake_case（`web_search`）注册名。
- **replyGen / planner 模型**：默认跟用户 chat 模型（header `X-Chat-Llm-Model`）或 DeepSeek 环境变量。
- **M2 占位**：pdf_reader 等只在 `registerTools` 注释列出，不实现。

---

Plan complete. 执行前在 `main` 上 `git checkout -b feat/agent-runtime-m1c`。

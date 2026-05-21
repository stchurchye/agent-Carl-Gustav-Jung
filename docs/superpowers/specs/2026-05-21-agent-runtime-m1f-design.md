# Agent Runtime M1f 设计文档 —— Hardening（M2 真工具洪水前的清理）

- 项目代号：`agent-runtime` 子项目 A，M1 系列第 6 个里程碑
- 日期：2026-05-21
- 状态：spec 待用户复核 → writing-plans
- 前置：`v0.m1e` 已 tag、261 api tests 全绿、`feat/agent-runtime-m1e` 已 merge

---

## 1. 背景

M1a-M1e 共交付了完整 ReAct 循环 + 后台 worker + 5 个 M1 工具 + provider 抽象 + 模型选择 UI + 用户可感 notice 通道。但在 M1c review 和 M1e review 中累积了一组「不修不爆、修了更稳」的 hardening 项被推迟。M1e plan 明确把这些推到 "M2 真工具洪水前"，因为它们的共性是：

- 都不是新功能，都是"消化技术债"
- M2 会大量新增工具 / prompt 模板 / output 结构，这些 hardening 不做的话每个新工具都得绕同样的坑
- 各项独立，互不阻塞

M1f 的目标是**把这组 hardening 一次清完**，让 M2 起步在干净的底座上。

## 2. 范围（6 项）

按"先动 prompt 路径 → 再动 output 路径 → 最后清死代码"排序，每项一个 commit。

| # | 主题 | P | 工时 | 核心改动 |
|---|------|---|------|---------|
| 1 | planner prompt 升级：工具失败重规划约定 | P0 | 0.5d | `apps/api/src/lib/agent/planner.ts` system prompt 模板 |
| 2 | replyGen 解耦 + ToolDef.replyMeta | P0 | 1d | `ToolDef` 加 `replyMeta` 字段；`runReply.ts` 去硬编码 |
| 3 | cancel signal audit + ESLint rule | P0 | 0.5d | 手动 audit 5 个工具 + `eslint-plugin-local` 规则 |
| 4 | parsePlannerJson 宽容化 | P1 | 0.3d | `planner.ts.parsePlannerJson` 容尾随逗号 / 代码块包裹 |
| 5 | 工具 output 统一 `{ok, ...}` 软约定 | P1 | 0.5d | `toolRegistry.invoke` 拦 `ok===false` 标 soft-fail；5 个工具补字段 |
| 6 | `awaiting_confirm` 死路径清理（删） | P1 | 0.3d | 状态机 / worker / 测试 / docs 全删 |

**总工时**：3.5-4 天。

## 3. 锁定的设计决策

| # | 决策 | 选定方案 | 备选 / 理由 |
|---|------|---------|------------|
| D1 | replyGen 解耦模式 | **A. ToolDef.replyMeta 字段** | B (register 回调) indirection 多；C (output 强结构) 改 schema 成本大 |
| D2 | cancel signal 保证强度 | **A + B**：手动 audit + 单文件 ESLint rule（只检查 `agent/tools/**` 下 `fetch(` 必带 `signal`） | C (ctx.fetch wrapper) 侵入太深 |
| D3 | tool output `ok` 字段 | **toolRegistry.invoke 层软识别**（不动 `ToolDef.handler` 返回类型） | 强约束会 break 现有 tool；软识别是渐进迁移 |
| D4 | `awaiting_confirm` 处置 | **删**（migration 加 enum 移除 + worker 死代码删 + docs 标注） | "保留 + 注释" 留债；"接 UI" 超 M1f 范围 |
| D5 | MCP 切官方 SDK | **不在 M1f**，推到 M2 跟 browser-use 一起换 | 切完 M2 再调一次 = 改两次 |
| D6 | 其它 P2 项（跨 run agentIngestCache / reservation 模式 / docExport v2 race） | **不在 M1f**，留到 M2 或 M1g | 个位数并发 + 自愈 / YAGNI |

## 4. 各项详细设计

### #1 planner prompt 升级

**问题**：M1c review #6 — planner system prompt 只描述"有哪些工具"，没告诉 LLM "工具失败时怎么办"。结果 web_search 失败 → LLM 不知道要 replan，继续按原 plan 跑后续 step → 全错。

**改动**：

1. `buildPlannerSystemPrompt` 加一段「失败处理约定」：
   ```
   工具调用约定：
   - 调用前阅读 tool description 的 inputSchema
   - 收到 observation 时检查 `ok` 字段：ok=false 或 error 字段非空 → 当前 step 失败
   - 失败处理：
     a. 如果可以换参数重试（如不同搜索词 / 备选 url）→ 在新 plan 里补一个相同 tool 的 step
     b. 如果该工具能力本身不可用（API 401 / 持续超时）→ 跳过该工具，用其他工具达成目标
     c. 如果整条路径不可行 → 把已查到的部分写成 reply，明确告诉用户「X 不可达」
   - 不要忽略 ok=false 直接进下一步
   ```

2. `buildPlannerUserPrompt` 在 replan 场景（有 `previousFailure` context）加一行：
   ```
   上一步失败原因：<error>
   请基于这个失败重新规划剩余步骤。
   ```

3. 工具 schema 输出里强制带 `replyMeta.failureHint`（如果工具定义了）：
   > "web_search 失败常见原因：rate limit、网络超时、API key 失效。"

**验收**：
- 单测：mock LLM 返回带 `previousFailure` 的 user prompt → 断言包含约定文本
- 集成：触发 web_search 失败 → 重 run → planner 输出新 step 不重复同样错误（mock 验证）

### #2 replyGen 解耦 + ToolDef.replyMeta

**问题**：`runReply.ts` 的 `collectExportedDocs` 硬编码识别 `toolName === 'doc_export_markdown'` 来抽 documentId 渲染链接；`summarizeOutput` 用单一字符串截断策略，导致 magi/web_search 等不同 output 形态都摘成同一种丑样子。

**改动**：

1. `ToolDef` 接口加可选字段：
   ```ts
   type ToolReplyMeta = {
     /** 摘要策略 */
     summaryKind?: 'text' | 'list' | 'export_ref' | 'silent';
     /** 从 output 里提取展示用 ref（如 documentId） */
     extractRef?: (output: unknown) => { kind: 'document' | 'url' | 'magi_card'; id: string; label?: string } | null;
     /** 工具失败时给 planner 的提示文字 */
     failureHint?: string;
   };

   interface ToolDef<I, O> {
     // ... existing fields
     replyMeta?: ToolReplyMeta;
   }
   ```

2. `runReply.collectExportedDocs` 改名 `collectReplyRefs`，遍历所有 step 按 `tool.replyMeta.extractRef` 收集；不再 if-by-toolName。

3. `summarizeOutput` 按 `replyMeta.summaryKind` 分发：
   - `text`：现状（截断 600 字符）
   - `list`：把 output 当数组，取前 5 项 title
   - `export_ref`：完全不摘，只渲染 ref 链接
   - `silent`：不进 reply

4. 现有 5 个工具补 `replyMeta`：
   - `echo_after_sleep`: `{ summaryKind: 'silent' }`
   - `web_search`: `{ summaryKind: 'list', failureHint: '搜索可能限流，可换关键词或稍后重试' }`
   - `url_fetch`: `{ summaryKind: 'text', failureHint: 'url 可能 404/超时，可跳过' }`
   - `magi_system_read`: `{ summaryKind: 'text', failureHint: 'MAGI 内部 API 故障，可跳过' }`
   - `magi_content_ingest`: `{ summaryKind: 'silent', extractRef: o => ({ kind: 'magi_card', id: o.id, label: o.title }) }`
   - `doc_export_markdown`: `{ summaryKind: 'export_ref', extractRef: o => ({ kind: 'document', id: o.documentId, label: o.title }) }`

**验收**：
- 单测：mock 一个 step 列表（混合 5 个工具）→ `collectReplyRefs` 返回正确分类
- 单测：每种 summaryKind 各一个用例
- 集成：跑现有 `runtime.research.e2e.test.ts` → final reply 内容跟改造前相同（兼容性）

### #3 cancel signal audit + ESLint rule

**问题**：M1e 改 runtime 时已经把 `ctx.signal` 透传给 tool handler，但工具实现里 `fetch(...)` 是否真传 `signal:` 没有全 audit。用户 cancel 后请求继续跑 = 浪费 ZenMux/DeepSeek token。

**改动**：

1. 手动 audit 5 个工具的所有 IO 调用：
   - `web_search`: Tavily fetch
   - `url_fetch`: undici fetch + jsdom parse（jsdom 不可中断，至少 fetch 要 signal）
   - `magi_system_read` / `magi_content_ingest`: 内部 `queryMagiSystem` / `ingestMagiContent` —— 看是否接 signal，不接就改
   - `echo_after_sleep`: `setTimeout` 改成可 abort 的 `sleep(ms, signal)`
   - `doc_export_markdown`: 纯 DB，DB driver 自带；audit `createDocument` / `saveDocumentContent` 是否在 abort 后仍写

2. 新增 ESLint local rule：
   ```
   apps/api/eslint-rules/agent-tool-fetch-signal.js
   ```
   只检查 `apps/api/src/lib/agent/tools/**/*.ts`：禁止 `fetch(` 调用不在同一对象字面量里出现 `signal:`。
   `.eslintrc` 引用本地 rule。

3. 写一份 `apps/api/src/lib/agent/tools/README.md`，说明 tool 作者约定：
   - 所有 IO 必须接 `ctx.signal`
   - 不接的话 = bug，会被 lint 拦
   - `ctx.signal.aborted` 在每次循环 / 长 await 后检查

**验收**：
- ESLint rule 单测：故意写一个不带 signal 的 fetch → 报 error
- 集成：模拟 cancelRun → 工具 fetch 被中断（mock fetch 校验 signal.aborted）

### #4 parsePlannerJson 宽容化

**问题**：M1c review #4 — 部分模型（Kimi K2.6、Gemini）容易输出：
- 尾随逗号 `[{...}, {...},]`
- 代码块包裹 `` ```json ... ``` ``
- 前后带说明文字 `"Here's the plan:\n{...}"`

当前 `parsePlannerJson` 直接 `JSON.parse` 会失败 → fallback echo plan。

**改动**：

1. 加预处理函数 `extractJsonCandidate(raw: string): string`：
   - 剥 markdown 代码块（` ```json ... ``` ` / ` ``` ... ``` `）
   - 截取第一个 `{` 到对应闭合 `}`（用 bracket counter）或第一个 `[` 到对应 `]`
   - 去尾随逗号（`,}` → `}` / `,]` → `]`）

2. `parsePlannerJson` 先调 `extractJsonCandidate` 再 `JSON.parse`；失败时尝试一次  `JSON5.parse`（如果有，否则跳过）；都失败再抛 `PlannerJsonParseError`。

3. 不引入 JSON5 依赖（保持 zero new dep）；只做 regex 预处理。

**验收**：
- 单测：~10 个污染样本（来自 spike 时记录的 Kimi/Gemini 输出）→ 解析成功
- 单测：纯 garbage（"hello world"）→ 仍正确抛 PlannerJsonParseError

### #5 工具 output 统一 `{ok, ...}` 软约定

**问题**：M1c review #5 — `magi_system_read` 拿到 MAGI 500 时把错误吞掉，return `{}`。replyGen 看到空 output → "已查到内容（无数据）"，用户被骗。

**改动**：

1. `toolRegistry.invoke`（在 `runExecute.ts` 里调用处）拦截：
   ```ts
   const output = await tool.handler(input, ctx);
   const softFailed =
     output != null && typeof output === 'object' && 'ok' in output && output.ok === false;
   await recordStep({
     ...
     kind: softFailed ? 'observe' : 'observe',
     warning: softFailed ? (output as { ok: false; error?: string }).error : undefined,
   });
   if (softFailed) {
     // 让 planner 知道，下一轮 plan 时 critique 会触发
   }
   ```

   （注意：不破坏 `observe` 步骤的现有写入，只是多打一个 warning 字段；step 表已有 `error` 列复用。）

2. 5 个工具 audit + 补 `{ok}` 字段：
   - `web_search`: 现状 throw → 改 catch 后 return `{ok: false, error, results: []}`
   - `url_fetch`: 现状 throw → 改 `{ok: false, error, status?: number}`
   - `magi_system_read`: 现状吞错 return `{}` → 改 `{ok: false, error}`
   - `magi_content_ingest`: 现状 throw → 改 `{ok: false, error}`
   - `doc_export_markdown`: 现状 throw → 加 `ok: true` 到成功 output；失败仍 throw（DB 失败属 hard error）
   - `echo_after_sleep`: 加 `ok: true`

3. planner.ts system prompt 引用本约定（与 #1 联动）。

**验收**：
- 单测：每个工具 happy path output 含 `ok: true`；失败路径 output 含 `ok: false` + `error`
- 集成：触发 web_search 失败 → 下一 step 的 planner snapshot 里能看到上一步 `ok: false`

### #6 `awaiting_confirm` 死路径删除

**问题**：M1d 引入 `awaiting_confirm` 状态但 mobile 从未接对应 UI，worker 里有处理逻辑但永远进不去 = 死代码。M1e review 已建议清理。

**改动**：

1. Migration `016_drop_awaiting_confirm.sql`：
   - PG enum 改动复杂，新建 enum 类型 + 转表 + drop 老 enum；或保留 enum 但 DB CHECK constraint 禁止该值
   - 选**保留 enum 值不动**（PG enum drop value 风险高），只在应用层禁止：worker 不再进入该状态，confirmRun 函数删除

2. `apps/api/src/lib/agent/types.ts`：
   - `AgentStatus` union 移除 `'awaiting_confirm'`（编译期收窄）
   - 加注释说明 DB enum 仍有此值但应用层 deprecated

3. 删除：
   - `runLifecycle.confirmRun` 函数
   - `routes/agent.ts` 的 `POST /runs/:id/confirm` 路由
   - worker 里 `pickUpAwaitingConfirm` 路径（如果有）
   - 相关 mobile types（如果有）

4. 测试：
   - 删除引用 `awaiting_confirm` 的所有测试（应该都是单测 mock 出来的）
   - 加一个 migration smoke test：DB 里若有遗留 `awaiting_confirm` 状态的 run（不可能，但兜底）→ 启动时打 warning 不 crash

5. 文档：
   - `docs/superpowers/specs/2026-05-20-agent-runtime-design.md` 加 ADR 说明 M1f 删除该状态
   - M1f plan 记录 migration 016 的注意事项

**验收**：
- `grep -r awaiting_confirm apps/` 只剩 ADR 引用
- 现有所有测试 + 261 tests 仍绿
- migration 016 跑两次幂等

## 5. 排序 / 依赖

```
#1 planner prompt 升级
    ↓ (planner prompt 引用 replyMeta.failureHint，所以 #2 也要早做)
#2 ToolDef.replyMeta + replyGen 解耦
    ↓ (audit 5 个工具时顺手补 replyMeta，所以 #3 在 #2 之后)
#3 cancel signal audit + ESLint rule
    ↓ (audit 工具时也补 ok 字段，所以 #5 紧跟 #3)
#5 工具 output {ok} 约定
    ↓ (独立)
#4 parsePlannerJson 宽容化
    ↓ (独立 / 收尾)
#6 awaiting_confirm 删
```

**实际推荐执行**：#2 → #1 → #3+#5 合并一轮工具 audit → #4 → #6

理由：#2 立 ToolReplyMeta 接口后，#1 prompt 模板可以直接引用 failureHint。`#3` 和 `#5` 都要改 5 个工具的实现，合并一次 PR/commit 避免重复扫文件。

## 6. 不在 M1f 范围（推后）

| 项 | 推到 | 理由 |
|----|------|------|
| MCP 切官方 `@modelcontextprotocol/sdk` | M2 + browser-use | 切完 M2 还要再调，等于改两次 |
| 跨 run `agentIngestCache` | M2 真接 magi-content 工作流 | 无真用户场景前 = 过度设计 |
| `tool_call` reservation 模式 | M2 高并发时 | 当前并发个位数，partial unique index 够 |
| docExportMarkdown v2 title race | 永不修（接受） | 罕见 + 自愈（用户改名即可） |
| awaiting_confirm 接 mobile UI | 真有"先确认参数再 run"需求时 | YAGNI |

## 7. 验收清单（汇总）

完成 M1f 时必须满足：

- [ ] 6 项每项一个独立 commit，subject 用 `fix(agent)` / `refactor(agent)` / `chore(agent)`
- [ ] 261 → ≥261 API tests passing（每项加 2-5 个新测）
- [ ] `tsc --noEmit -p apps/api` clean
- [ ] `tsc --noEmit -p apps/mobile` clean
- [ ] ESLint rule 在 CI 里跑通（agent/tools/** 任一 fetch 漏 signal 红灯）
- [ ] `grep awaiting_confirm apps/` 只剩 ADR / migration comment
- [ ] code-reviewer subagent 审 branch 不再 surface "硬编码" / "silent fallback" / "death path" 类 blocker
- [ ] 合并到 main，tag `v0.m1f`

## 8. 时间估算 + Sequencing

| 阶段 | 工时 | 累计 |
|------|------|------|
| 准备 baseline + 开 branch | 0.2d | 0.2d |
| #2 ToolDef.replyMeta + replyGen 解耦 | 1d | 1.2d |
| #1 planner prompt 升级 | 0.5d | 1.7d |
| #3+#5 工具 audit（signal + ok 字段） | 1d | 2.7d |
| #4 parsePlannerJson 宽容化 | 0.3d | 3.0d |
| #6 awaiting_confirm 删 | 0.3d | 3.3d |
| code-reviewer + followups | 0.5-0.7d | 3.8-4.0d |
| merge + tag | 0.1d | 3.9-4.1d |

**总计**：3.9-4.1 天。

## 9. 与后续 milestone 的衔接

- **M1g（obs-dx）**：依赖 M1f 的 `ToolReplyMeta` —— trace UI 可以用 `summaryKind` 决定如何渲染 step output；ESLint rule 框架 M1g 可加 trace 相关规则
- **M1h（ux-polish）**：steer UI 依赖 #1 planner prompt 改进（replan flow 更可控）
- **M2（真工具洪水）**：所有新工具都按 `ok` schema + `replyMeta` + cancel signal 三件套写，模板成熟；MCP 切 SDK 一并做
- **B 子项目（multi-user）**：独立，不依赖 M1f

---

（spec 待用户复核 → 进入 writing-plans 阶段生成实施计划）

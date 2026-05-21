# Agent Tool 作者约定 (M1f)

写新工具前必读。约定来自 M1c/M1e/M1f review 推迟的几项 hardening。

## 1. cancel signal 必须接通

`ctx.signal` 是 runtime 给的 cancel 信号源。所有 IO 调用必须接：

- `fetch(url, { signal: ctx.signal })`
- `setTimeout` / `setInterval` → 用 `ctx.signal.addEventListener('abort', () => clearTimeout(t), { once: true })` 包
- DB 操作 / 长循环 / 多步 `await`：在每轮 await 之间穿插 `if (ctx.signal.aborted) throw new Error('aborted')`
- 内部包了 AbortController（如 urlFetch 的超时控制）：用 `ctx.signal.addEventListener('abort', () => innerAc.abort(), { once: true })`，并在 `finally` 里 `removeEventListener` 防泄漏

ESLint local rule `agent-tool-rules/fetch-signal`（`apps/api/eslint-rules/agent-tool-fetch-signal.js`）会拦不带 signal 的 fetch。apps/api 尚未启用 ESLint 流水线，等启用后此 rule 自动生效；目前作为 audit checklist 保留。

### 关键不变量：AbortError 必须透传

`catch` 块里看到 `e.name === 'AbortError'`（或 `ctx.signal.aborted === true`），**永远要把这个 error 重新抛出**，不要包装成 `{ ok: false }`。runtime 通过 throw 区分 cancel 语义 vs. soft-fail；包装成 `{ok}` 会让 cancelRun 表现得像普通失败。

## 2. output 形如 `{ ok, ... }` 软失败约定

每个 tool 的 output 必须有 `ok: boolean` 字段：

- **成功路径** `return { ok: true, ...data }`
- **软失败**（外部 4xx / 5xx / 限流 / 超时 / 非预期 content-type 等可恢复错）：`return { ok: false, error: '...', ...partialData }`
- **硬失败**（DB 故障 / 内部 bug / 不可恢复的代码错）：`throw new Error(...)`。runtime 会重试 1 次后把 run 标 `failed`。

runtime（`runExecute.ts`）会在 tool 返回后识别 `output.ok === false`：
- 写 step.error，让 planner 下一轮 snapshot 能看到
- **不**抛错、**不**把 run 标 failed —— 给 planner 机会换参数 / 跳过工具 / 友好告知

## 3. replyMeta（推荐配置）

```ts
replyMeta: {
  summaryKind: 'text' | 'list' | 'export_ref' | 'silent',
  extractRef: (output) => ({ kind, id, label }) | null,
  failureHint: '失败常见原因 + 重试建议',
}
```

- `summaryKind`：`replyGen` 拿来决定 step output 怎么摘要进 final reply。`'silent'` 完全不出现，`'list'` 取前 5 项 title，`'export_ref'` 只放一个短标记，详情走 ref 列表。
- `extractRef`：成功输出能聚合到「已写入资源」段时返回 ref（文档 / 链接 / MAGI 卡片）。
- `failureHint`：planner system prompt 会在 tool 列表里把这段渲染出来，告诉 LLM 失败时怎么 replan。

## 4. idempotency

`hasSideEffects: true` 的工具**必须**实现 `computeIdempotencyKey(input)`，runtime 会按 `${ownerId}:${key}` 在同一个 run 内防止重复调用。读型工具（`hasSideEffects: false`）也建议加（让缓存命中）。

## 5. approvalMode

- `auto`：自动跑（多数读工具 + 写到用户私有数据的工具）
- `ask`：跑前要用户授权（mobile 弹窗），适合写到外部 / 第三方账号的工具
- `never`：占位禁用，runtime 看到会直接 deny 并跳过本 step

## 6. 测试约定

每个新工具至少要有：

- 注册测试（`registerXxx()` 幂等 + `toolRegistry.get(name)` 命中）
- 成功路径 + `ok: true` 断言
- 软失败路径 + `ok: false, error` 断言
- AbortError 透传断言（mock fetch 在 abort 时 reject，验证 handler 不吞）
- idempotency key 测试（如果实现了 `computeIdempotencyKey`）

参考 `__tests__/tools.webSearch.test.ts` / `tools.urlFetch.test.ts` 的模板。

## 文件位置

- 工具实现：`apps/api/src/lib/agent/tools/<name>.ts`
- 工具测试：`apps/api/src/lib/agent/__tests__/tools.<name>.test.ts`
- 注册入口：`apps/api/src/lib/agent/registerAgentTools.ts`
- ESLint rule：`apps/api/eslint-rules/agent-tool-fetch-signal.js`（待 lint pipeline 启用）

# Agent Runtime M1d 实施计划

> Phase: M1d Hardening
> 前置：v0.m1c 已 tag、134 api tests + 44 shared tests 全绿
> 目标：把 §19 测试矩阵全部点亮，agent 在生产路径上达到"可放心暴露给朋友"的成熟度

## 0. 范围与排序

按风险/收益排序，先做**对正确性影响最大**的（T5、T14、UX 错误兜底），再做**用户体验**（任务面板、SSE），最后做**扩展性**（MCP transport、per-user key、prompt-injection 防御）。

| Task | 主题 | 大小 | 依赖 |
|------|------|------|------|
| 1 | T5 heartbeat reclaim 集成测试 + bugfix | M | runtime.ts |
| 2 | T14 budget_exhausted 软着陆 UX | S | runtime.softComplete + mobile |
| 3 | failed / cancelled placeholder UX + "再试一次" | M | messageBridge + AgentRunCard |
| 4 | 任务面板 mobile UI（列表 + 详情） | M | 新 screen / nav |
| 5 | T16 SSE 切回 + Last-Event-ID 续传 | M | routes/agent.ts + useAgentRunStream |
| 6 | Per-user DeepSeek key 在 worker 上下文里取用 | S | agent_runs schema migration + runtime |
| 7 | Topic skill prompt-injection 防御 | S | topicSkills.ts |
| 8 | MCP stdio transport（最简） + smoke demo | M | mcp/ |
| 9 | Migration smoke + AGENTS.md / README 收尾 | S | 文档 |

**预估总工时**：12-16h，比 M1c 略大但 task 数少（每个偏 hardening，单 task 1-3h）。

如果时间紧，**Task 8 + 9 可拆 M1d-bis**；Task 1-7 是必须的 M1d 收口。

---

## 1. baseline 准备

```bash
git checkout main
git pull   # 若有多机
pkill -f "tsx watch.*agent-Carl-Gustav-Jung" 2>/dev/null
git checkout -b feat/agent-runtime-m1d
set -a; source .env; set +a
npm run typecheck && npm run test -w @xzz/api   # baseline 134 tests
```

---

## 2. Task 1：T5 Heartbeat Reclaim 集成测试

### 2.1 问题陈述

spec §19 T5：worker A 跑到一半进程死亡，30s 后 worker B pickup，从下一 step 继续；同一 run 不会被两 worker 同时跑。

M1b-2 通过"让出模型"已经覆盖大部分 reclaim（approval 让出后状态写到 db，re-pickup 自然能续）。**但真正的进程崩溃**（在 `tool_call` step 写完前 process kill）还没测试。

### 2.2 当前 invariant 复核

读 `apps/api/src/lib/agent/store.ts::pickupNextRun`：

```sql
WHERE status IN ('draft','planning','running','replanning')
  AND (last_heartbeat_at IS NULL
       OR last_heartbeat_at < now() - interval '30 seconds')
```

`stepRecorder.startHeartbeat` 启动后每 10s 写 `last_heartbeat_at = now()`。若进程死了，30s 后 row 自然变 "stale"，下一个 worker tick 能拿。

**潜在 bug**：
- `executeRun` 进入 try 时立刻 `startHeartbeat`，但**没有显式 stopHeartbeat 的 finally**——已确认 line 561 的 `stopHb()` 在哪个分支调；要补 finally
- worker B reclaim 后从 `completedCount = run.usage.steps` 继续，但**worker A 可能写了 tool_call step 但还没 `incrementUsage`**——会重复执行该 step

第一个工具 idempotency gate（M1c）能避免副作用工具的重复，但**不带 `computeIdempotencyKey` 的工具会重复**。需要：
- 把"从 db 最大 idx 反推 completedCount"作为更可靠源：`completedCount = max(plan.steps idx where对应 tool_call 已 success)`

### 2.3 TDD 测试

文件：`apps/api/src/lib/agent/__tests__/runtime.reclaim.test.ts`

模拟手段：不用 testcontainers，**直接在测试里调 store API 构造"半死状态"**：
1. 用一个能"卡住"的 mock tool（含 promise 永不 resolve + AbortSignal 监听）
2. 起 `executeRun(runId)` 协程，等到第 1 个 tool_call step 完成
3. 不 await——直接 `controller.abort()` 模拟进程死（在共享 `runControllers` 里 abort）
4. 手动把 `last_heartbeat_at` 改成 `now() - 60s` 模拟超时
5. 起第二个 `executeRun(runId)` 协程
6. 验证：所有 step 跑完、`usage.steps` 等于 plan.steps.length、tool handler 被调的总次数 == plan.steps.length（无重复执行）

### 2.4 实现修复

**A. 加 stopHeartbeat 的 finally 保护**（runtime.ts）：

```typescript
const stopHb = startHeartbeat(runId, 10_000);
try {
  // ... existing logic ...
} finally {
  stopHb();
  runControllers.delete(runId);
}
```

（注意：现有 catch 块里已 stop heartbeat 的逻辑要重新审视，避免双调）

**B. completedCount 用 db tool_call 实际计数**（更安全）：

```typescript
// 旧：const completedCount = run.usage.steps;
// 新：
const allSteps = await store.listSteps(runId);
const successfulToolCalls = allSteps.filter(
  (s) => s.kind === 'tool_call' || s.kind === 'observe',
).length;
const completedCount = successfulToolCalls;
```

**C. crash 接管事件留痕**（spec §11 提到 `heartbeat` step）：

reclaim 路径（执行循环进入前）写一条 `kind:'heartbeat'` step，`output: { reclaim: true, prevHeartbeatAt }`，方便排查。

### 2.5 commit

```bash
git commit -m "fix(agent): heartbeat finally + DB-driven completedCount; T5 reclaim test"
```

---

## 3. Task 2：T14 Budget Exhausted 软着陆 UX

### 3.1 当前现状

`runtime.softComplete(status='budget_exhausted')` 已经把 `[预算已用尽：…]` 拼到 finalContent，但 mobile `AgentRunCard` 没专门展示"已花费"细节。

### 3.2 后端：扩展 final reply

`runtime.ts::buildFinalContent` budget_exhausted 分支拼具体数据：

```typescript
const u = run.usage;
const limit = run.budget;
return [
  pickFallbackFinalContent(run, run.plan),
  '',
  `[预算已用尽：${detail ?? ''}]`,
  `已花费：${u.steps}/${limit.maxSteps} 步、${u.tokens}/${limit.maxTokens} tokens、${u.elapsedSeconds}/${limit.maxSeconds}s`,
].join('\n');
```

### 3.3 前端：AgentRunCard 加 usage 行

`AgentRunCard.tsx` 在 status === 'budget_exhausted' 时额外渲染：

```tsx
<View style={styles.usageRow}>
  <Text>步: {run.usage.steps}/{run.budget.maxSteps}</Text>
  <Text>tokens: {run.usage.tokens}/{run.budget.maxTokens}</Text>
  <Text>用时: {run.usage.elapsedSeconds}s/{run.budget.maxSeconds}s</Text>
</View>
```

需要把 `usage` / `budget` 从前端 `AgentRun` 类型里暴露——`apps/mobile/src/features/agent/types.ts` 加字段，`agentApi.ts` 的 unwrap 也透传。

### 3.4 测试

- `apps/api/src/lib/agent/__tests__/runtime.budget.ux.test.ts`：调用 `executeRun` 触发 budget_exhausted（已有测试 → 加 assertion 验 finalContent 包含 "已花费"）
- mobile 端不写 component test（用 RN），用 typecheck 兜底

### 3.5 commit

```bash
git commit -m "feat(agent): budget_exhausted UX with usage breakdown (T14)"
```

---

## 4. Task 3：Failed / Cancelled UX + 重试

### 4.1 后端：retry endpoint

`apps/api/src/routes/agent.ts`：

```typescript
agentRouter.post('/runs/:id/retry', async (c) => {
  const userId = c.get('userId') as string;
  const run = await getAgentRun(c.req.param('id'));
  if (!run) return jsonError(c, 404, 'NOT_FOUND');
  if (!(await canAccessRun(run, userId))) return jsonError(c, 403, 'FORBIDDEN');
  if (!isTerminal(run.status)) return jsonError(c, 400, 'NOT_TERMINAL');

  const newRun = await createAgentRun({
    ownerId: run.ownerId,
    channel: run.channel,
    sessionId: run.sessionId ?? undefined,
    groupId: run.groupId ?? undefined,
    topicId: run.topicId ?? undefined,
    inputText: run.inputText,
    apiKey: '', // worker 自己取 server / per-user key (Task 6)
    apiKeySource: run.apiKeySource,
    budget: run.budget,
  });
  return c.json({ run: newRun.run, placeholderMessageId: newRun.placeholderMessageId });
});
```

### 4.2 前端：AgentRunCard 在 failed/cancelled 时显示按钮

```tsx
{(run.status === 'failed' || run.status === 'cancelled' || run.status === 'budget_exhausted') && (
  <TouchableOpacity onPress={onRetry}>
    <Text>再试一次</Text>
  </TouchableOpacity>
)}
```

`onRetry` 调 `POST /api/agent/runs/:id/retry`，拿到新 runId 后调 callback 触发上层切换到新 run（chat screen 刷新消息列表自然能挂上新的 AgentRunCard）。

### 4.3 测试

- `apps/api/src/routes/__tests__/agent.routes.test.ts` 加 retry 路由：terminal 状态才允许；403 / 404 边界
- 单测 `runtime.retry.test.ts`：retry 后两个 run 是独立的（不复用 step / 不复用 placeholder）

### 4.4 commit

```bash
git commit -m "feat(agent): retry terminal runs (failed/cancelled/budget_exhausted) + UX button"
```

---

## 5. Task 4：任务面板 Mobile UI

### 5.1 后端：list endpoint

`apps/api/src/routes/agent.ts`：

```typescript
agentRouter.get('/runs', async (c) => {
  const userId = c.get('userId') as string;
  const status = c.req.query('status'); // 可选过滤
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const runs = await listRunsForUser(userId, { status, limit });
  return c.json({ runs });
});
```

`store.ts::listRunsForUser`：列出 ownerId == userId **或** 用户在该 run.groupId 群里 的 run。

### 5.2 Mobile

新 screen `apps/mobile/src/screens/AgentTasksScreen.tsx`：

- FlatList 渲染 run 列表（status badge、intentSummary、createdAt、tap 进详情）
- 详情页可复用 `AgentRunCard`（独立 screen `AgentTaskDetailScreen`）

挂到 `BrainStack`，从 BrainHub 入口加一个 "Agent 任务" 卡片。

### 5.3 测试

- 后端：routes 测试加 list + 权限
- mobile：typecheck 兜底

### 5.4 commit

```bash
git commit -m "feat(agent): task panel screen (list + detail) + GET /runs endpoint"
```

---

## 6. Task 5：SSE 切回 + Last-Event-ID 续传

### 6.1 后端

`apps/api/src/routes/agent.ts::GET /runs/:id/stream` 当前用 `streamSSE`。需要支持：

- 客户端可以传 `Last-Event-ID: <stepIdx>` header
- 服务端拿到后，先把 db 里 idx > lastEventId 的所有 step 一次性发出来（catch-up），再开始订阅 `agentHookBus` 推新事件
- 每条 SSE 事件 `id: <stepIdx>`

### 6.2 前端

新 hook `useAgentRunStream`（替换 `useAgentRunPoll` 的实现，保留同名 alias）：

- 用 React Native 的 `EventSource` polyfill（`react-native-event-source` 或 fetch + ReadableStream）
- 维护 `lastEventId`，断线时 reconnect 自动带上
- 失败超过 3 次自动 fallback 回 polling
- 连接成功时调 GET `/runs/:id` 取全状态（避免漏 run-level 字段更新）

如果 RN EventSource polyfill 太重，用 **fetch streaming + 手写 SSE 解析**（约 50 行）。

### 6.3 测试

- 后端：`routes/__tests__/agent.stream.test.ts`：模拟 Last-Event-ID 续传——构造一个 run + 5 个 step，请求带 `Last-Event-ID: 2`，验证 stream 头几个事件 id 是 3、4、5
- 前端：手测（hook 单测困难）

### 6.4 commit

```bash
git commit -m "feat(agent): SSE Last-Event-ID resume + mobile useAgentRunStream (T16)"
```

---

## 7. Task 6：Per-User DeepSeek Key 在 Worker 上下文

### 7.1 问题

M1c 的 `buildInitialPlan` / `buildFinalContent` 只用 `process.env.DEEPSEEK_API_KEY`。用户在 mobile app 里填的 per-user key 没有被使用。

### 7.2 方案（最小化）

- `agent_runs` 加列 `user_api_key_enc TEXT NULL`（aes-256-gcm 加密）
- `createAgentRun` 收到 `apiKeySource: 'user'` 时，把 apiKey 用进程级 `AGENT_KEY_ENC_SECRET` 环境变量加密后存
- worker 跑时按 source 解出真实 key
- 加密用 node `crypto` 内置，不引入新依赖

### 7.3 Migration

`apps/api/src/db/migrations/014_agent_user_key.sql`：

```sql
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS user_api_key_enc TEXT;
```

### 7.4 测试

- `runtime.userKey.test.ts`：set env、createRun with user key、验证 db 里是密文、解密回原文一致；env 未设时 createRun with user key → 抛明确错误

### 7.5 commit

```bash
git commit -m "feat(agent): per-user DeepSeek key encrypted at rest + decrypted in worker"
```

---

## 8. Task 7：Topic Skill Prompt-Injection 防御

### 8.1 规则

`topicSkills.ts::create/update` 输入校验：

- title ≤ 100 字符
- content ≤ 4000 字符
- content 不能含 `<system>` / `</system>` / `<|im_start|>` / `<|im_end|>` / `[INST]` 等 LLM 控制 token（regex 黑名单）
- 违规直接 400 而不是 silent strip

### 8.2 测试

`topicSkills.test.ts` 已存在，加边界测试：超长、含黑名单字符串、合法输入对比。

### 8.3 commit

```bash
git commit -m "feat(agent): topic_skills input validation (length + prompt-injection blacklist)"
```

---

## 9. Task 8：MCP Stdio Transport + Demo

### 9.1 范围

最小可工作的 stdio MCP client：

- 启动一个子进程（`spawn`），按 JSON-RPC 2.0 over stdio 通信
- 实现 `listTools` / `callTool` 两个方法
- 不实现完整 MCP spec（resources / prompts / sampling 留 M2）

### 9.2 文件

- `apps/api/src/lib/agent/mcp/stdioClient.ts`：`createStdioMcpClient({ command, args, env, serverName })`
- demo：`apps/api/src/lib/agent/mcp/demo/fs-read-server.ts`（极简 Node 脚本，暴露一个 `read_file` 工具）

### 9.3 测试

`mcp.stdioClient.test.ts`：spawn 自身 demo server（用 `tsx`），调 listTools + callTool，验证 round-trip。

### 9.4 commit

```bash
git commit -m "feat(agent): MCP stdio transport + demo fs server"
```

---

## 10. Task 9：Migration Smoke + 文档

### 10.1 Migration smoke

`apps/api/src/db/__tests__/migrate.idempotent.test.ts`（如果没有）：

- 在干净 DB 上跑 `runMigrations()` 两次，第二次必须 noop
- 验证所有 agent 相关表都被创建：`agent_runs`、`agent_steps`、`topic_skills`、`agent_event_logs`、加上 014 新 column

### 10.2 文档

- `README.md` 顶部 Agent Runtime 章节追加 M1d 内容
- 新建 `AGENTS.md` 根目录：项目级"AI / agent 开发须知"（如果还没）——这次只列 agent runtime 的开发约定（如何注册新工具、如何加新 hook 等）
- M1d 完成后在 `m1b-completion.md` 同款节加一个 `m1d-completion.md`，登记 ADR / 完成清单

### 10.3 commit

```bash
git commit -m "docs(agent): M1d README + AGENTS.md + completion doc; migration idempotency test"
```

---

## 11. M1d 完成闭环

```bash
npm run typecheck && npm run test -w @xzz/api && npm run test -w @xzz/shared
git checkout main
git merge --no-ff feat/agent-runtime-m1d -m "merge: agent runtime M1d (hardening + task panel + SSE + MCP transport)"
git tag v0.m1d
```

完成判据（spec §18.4 + §19）：

- [ ] §19 T1-T16 全部 PASS
- [ ] 任务面板能列 / 详情 / 取消 / 重试
- [ ] 预算耗尽时 placeholder 显示已花费明细
- [ ] failed / cancelled / budget_exhausted 都有 "再试一次" 按钮且有效
- [ ] SSE 断网 5s 后重连不丢 step
- [ ] MCP stdio demo 能从 agent runtime 调通
- [ ] per-user DeepSeek key 跑 agent 时确实用了用户的 key（验法：log + 收据）

---

## 12. 风险 / 已知 trade-off

- **EventSource polyfill**：RN 没有原生 EventSource。如果手写 SSE 太复杂，**Task 5 可降级**为"polling 间隔从 1.5s 缩到 800ms + 加 jitter"，把 SSE 切回挪 M2。
- **MCP stdio**：spawn 子进程在 Docker 环境里要确保 binary 可达；demo server 用 node 自带，可控。
- **Per-user key 加密 secret 轮换**：M1d 不做 key rotation，只用单 `AGENT_KEY_ENC_SECRET`；上线前 ops 自己保管。
- **Migration smoke**：本地 PG 不能完整模拟生产数据；只验幂等性 + 表结构，不验性能。

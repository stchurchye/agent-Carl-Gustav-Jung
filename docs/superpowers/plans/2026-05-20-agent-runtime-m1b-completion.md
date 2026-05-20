# Agent Runtime M1b 完成定义 + ADR

> 三份 M1b sub-plan（m1b-1/2/3）的**统一验收依据**。先于任何 M1b 实现 task 阅读。审阅人提出的"架构 ADR 必须先定再写 task"已落地于本文件第 2 节。

---

## 1. M1b 合并验收清单（必须全 PASS 才能 tag v0.m1b）

### 1.1 功能验收（对照 spec §18.2）

| AC | 内容 | 负责 plan | 验收方式 |
|----|------|----------|----------|
| AC1 | 群聊 `/agent ...` 走通：invokeMessage + placeholderAi + `llm_invoke_jobs.status='done'` | M1b-1 | T8 集成测 + runtime.group.test.ts |
| AC2 | 任意群成员可 cancel；**非成员 403** | M1b-1 | T12 |
| AC3 | `approvalMode='ask'`：60s 超时按 `costHint` 处理（low → grant、其他 → deny → replanning） | M1b-2 | T4 + runtime.approval.test.ts |
| AC4 | 用户中途 steer："改成总结" → 当前 step **abort** + 新 plan 替换剩余 steps | M1b-2 | T11 |
| AC5 | 创建 `topic_skill` 后下次同 topic agent run system prompt 含该 skill；**跨 topic 不污染** | M1b-1 | T13 |
| AC6 | critique 在 5 步后或连续失败 2 次插入（M1b 用规则 stub，LLM 留 M1c） | M1b-2 | critique.test.ts + runtime 集成 |
| AC7 | mobile：私聊 + 群聊里都能展开 AgentRunCard 看每一步、cancel/approve/deny/steer 按钮工作 | M1b-3 | 手工验收 |

### 1.2 测试矩阵（spec §19）

| ID | 主题 | M1b 状态 | 归属 |
|----|------|---------|------|
| T4 | Approval timeout（含 timeout checker） | **必做** | M1b-2 |
| T5 | Heartbeat reclaim | **defer M1d** | — |
| T7 | Context Adapter（私聊 + 群聊 + 成员名前缀） | **必做** | M1b-1 |
| T8 | Message Bridge（私聊 + 群聊） | **必做** | M1b-1（私聊在 M1a） |
| T11 | Steer 流程（abort + 新 plan + 剩余 step 数对齐） | **必做** | M1b-2 |
| T12 | Cancel 权限（非群成员 403） | **必做** | M1b-1 |
| T13 | Topic Skills 跨 topic 隔离 | **必做** | M1b-1 |
| T16 | SSE 断线重连 | **defer M1d**（M1b 用 polling 占位） | — |

### 1.3 同步 spec 更新（M1b 收尾必做）

- [x] `docs/superpowers/specs/2026-05-20-agent-runtime-design.md` §19 表格：T5/T16 阶段列 `M1b` → `M1d`，加 footnote 解释。
- [x] 同 §16：`/agent/skills` 是确定路径；spec 已是真理，plan 对齐即可（无需改 spec）。

### 1.4 Git 收尾（2026-05-20）

- [x] `main` ← `feat/agent-runtime-m1b-1`（含 M1a 全量）
- [x] `main` ← `feat/agent-runtime-m1b-2`
- [x] `main` ← `feat/agent-runtime-m1b-3`
- [x] tag `v0.m1b`
- [x] `npm run typecheck` + `npm run test -w @xzz/api`（87 passed）

---

## 2. 架构 ADR（三份 plan 头部引用本节）

### ADR-1：Approval 等待模型 = **A（spec-aligned，executeRun 让出）**

**决策：**
- `executeRun` 遇到 `tool.approvalMode === 'ask'` 时：写 `approval_request` step、把 run 状态切到 `awaiting_approval`、设置 `awaiting_approval_until = now()+60s`、**立即 return**（不阻塞）。
- 后续触发恢复的三条路径：
  1. **HTTP `/approve`**：路由把 run 切回 `running`、清空 `awaiting_*` 字段、写 `approval_grant` step、调 `enqueueRun(runId)`（即写 `pickup_after = now()`，让 worker 立即 pickup）。
  2. **HTTP `/deny`**：路由把 run 切到 `replanning`、写 `approval_deny` step（含 `byUserId / reason`）、enqueue。worker 下次 pickup 时 planner 用 `reason='approval_deny'`（M1b stub：用 echo planner + instruction `"用户拒绝了工具 X,改用替代方案"`）重规划。
  3. **Timeout checker**：worker tick 内每 5s 扫 `WHERE status='awaiting_approval' AND awaiting_approval_until < now()`。按 `costHint`：
     - `low` → 自动写 `approval_grant`（byUserId='system', reason='auto-low-cost'）+ enqueue running
     - 其他 → 自动写 `approval_deny` step（reason='auto-timeout-deny'）+ enqueue replanning（**不是** cancelled）

**为什么不选 B（plan 原稿的阻塞 poll）：**
- B 在进程重启时丢失 awaiting 状态（poll 循环死掉）
- B 让 executeRun 内嵌 60s 阻塞，worker 并发度被吃满
- A 实现成本只多 ~30 行 timeout checker，可重用现有 worker tick

**影响的代码：**
- `approval.ts`：删 `waitForApprovalOrTimeout` 这种 in-loop poll；改成纯 `approveRun / denyRun / autoResolveTimeout` 三函数
- `runtime.ts`：approval gate 改成"写 step + 切状态 + return"
- `worker.ts`：tick 内加 `autoResolveTimeout` 扫描；加 `enqueueRun` helper（M1b 简化：直接给 worker 一个 in-memory queue，或写 `agent_runs.next_pickup_at` 让现有 pickup SQL 命中）

### ADR-2：Deny → `replanning`（不是 `cancelled`）

`denyRun` 落库：
```typescript
status: 'replanning',
// 不写 cancelled / endedAt;cancelReason 保持 null
```

worker pickup 时 `if (status === 'replanning')` 分支：调 planner 用 `reason='approval_deny'` 或 `reason='retry_after_tool_fail'` 生成新 plan、切回 `running`、继续 loop。

### ADR-3：Steer = abort 当前 step + `replanning`

- `runControllers` Map 从 `runtime.ts` 抽到 `runtimeRegistry.ts`（新建小文件），让 `steer.ts` 能 import。
- `steerRun(runId, ...)` 内：
  1. 读 run、生成新 plan、写库（status='replanning'、plan 替换、todos 替换、`steer_instruction` 字段存进 plan.reasoning 或独立列）
  2. **abort 本进程的 controller**（若存在）；跨进程的 worker 重启时也会读到 `status='replanning'` 重新进入 planner
  3. 写 `steer` step（input: `{ instruction, newPlanVersion }`, byUserId）

abort 后 `executeRun` 抛 `AgentCancelled('steer')`（新 cancelReason 枚举）；catch 块识别 `replanning` status → 不 softFail，让下次 pickup 继续。

**runtime.ts catch 改造：**
```typescript
} catch (e) {
  if (e instanceof AgentCancelled && e.reason === 'steer') {
    // 不写 status=cancelled,让 worker pickup replanning 路径
    return;
  }
  // 原 cancelled/failed 处理
}
```

### ADR-4：Timeout enum 不复用 `'budget'`

新加 `cancelReason` 枚举值：`'approval_timeout'`（自动 deny 时记录到 step.error，不进 cancelReason，因为 run 不进 cancelled）。

### ADR-5：T16 / T5 defer 到 M1d

- M1b-3 `useAgentRunSSE` 用 polling fallback 实现并验收
- spec §19 T16 标 M1d、加 footnote
- T5 heartbeat reclaim 同理：M1b 主路径已是 worker pickup（ADR-1 选定后），但完整 crash-resilience 测试用 testcontainers 模拟进程死，独立写

---

## 3. 跨 plan 依赖与 merge 顺序

```
main
  ↓
feat/agent-runtime-m1b-1   (群聊 + topicSkills + cancel 放权 + view/stream 放权 + agentRouter /agent/skills)
  ↓ merge --no-ff
feat/agent-runtime-m1b-2   (approval ADR-1 + deny ADR-2 + steer ADR-3 + timeout checker + runtimeRegistry)
  ↓ merge --no-ff
feat/agent-runtime-m1b-3   (mobile AgentRunCard + hooks + logHook 消费者)
  ↓ merge --no-ff
tag v0.m1b
```

**M1b-1 必须先合并**：M1b-3 的 `agentApi.getAgentRun` 在群聊里依赖放权（否则 403）。
**M1b-2 必须先于 M1b-3**：mobile approve/deny 按钮调的是 M1b-2 的路由。

---

## 4. 估时（修订后）

| Plan | 修订后估时 | 增量原因 |
|------|----------|---------|
| M1b-1 | 8–12h | +T12/T13/T7 三组测试、共享 fixture、view/stream 放权、路径迁 `/agent/skills` |
| M1b-2 | 10–14h | ADR-1/2/3 实现（runtimeRegistry + timeout checker + replanning 分支） |
| M1b-3 | 6–10h | +logHook 消费者；不含 T16 |
| **合计** | **24–36h** | ~3–4 人日 |

---

## 5. 后续 plan 修订单（与本文件配套）

每份 sub-plan 头部加 banner：

```markdown
> **本 plan 已根据 m1b-completion.md（2026-05-20）修订。**
> 关键决策见 ADR-1（approval）/ ADR-2（deny→replanning）/ ADR-3（steer abort）。
> 估时已上调至 X-Yh。
```

具体修订条目见 `m1b-1.md / m1b-2.md / m1b-3.md` 的 **"修订记录"** 章节（位于文件末尾）。

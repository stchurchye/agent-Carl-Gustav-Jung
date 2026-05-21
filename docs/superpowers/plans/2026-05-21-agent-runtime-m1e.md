# Agent Runtime M1e 实施计划

> Phase: M1e —— Tech-debt cleanup + 架构铺垫
> 前置：v0.m1d 已 tag、169 api tests 全绿、`tsc -p apps/{api,mobile}` clean
> 评审依据：M1d code-reviewer 报告（2026-05-21）4 个 blocker + 11 个建议 + 5 项后续议程
> 目标：消化 M1d review 出的所有 blocker、把 762 行的 `runtime.ts` 拆掉、给后续 M2 真工具洪水做架构铺垫，让"用户可感降级"不再是隐患

---

## 0. 范围与排序

按"先拆模块 → 再修 blocker → 再补建议 → 收尾文档"顺序，确保每个 task 的 commit 在新模块结构上发生，而不是先 patch 老 runtime.ts 再拆（避免无谓的 merge 冲突 / review 噪声）。

| Task | 主题 | 大小 | 依赖 | 来源 |
|------|------|------|------|------|
| **11a** | **SPIKE**：钉 `LlmChatClient` 接口（response_format/function-calling/signal 在 DeepSeek vs ZenMux 表面差异），跑通 1 个 hello-world 调用打两边 | S (1-1.5h) | 现 deepseek.ts / zenmux.ts | M1e review 强烈建议 |
| 1 | `runtime.ts` 拆 5 个模块（lifecycle/execute/reply/planGlue + shared；apiKey/llm 解析合并到 task 11 一起落） | L | 现 runtime.ts + 11a | review 全局 #1 |
| 2 | 统一"用户可感降级 notice"通道（agent_event_logs.kind='user_facing_notice' + NoticeCode enum + SSE id namespace + mobile 顶部 toast） | M | 新表列 / hook | review 全局 #5 |
| 3 | **Blocker 1+3**：retry 复制 `user_api_key_enc` + per-user key 解密失败 surface | M | task 2 (notice 通道) | review T6 + T3 |
| 4 | **Blocker 2**：retry 路由幂等（窗口去重 + 前端 disable + 409） | S | routes/agent.ts | review T3 |
| 5 | **Blocker 4**：topicSkills 正则放宽（fail-closed → warn-log + 高置信 reject） | S | topicSkills.ts | review T7 |
| 6 | reclaim approval_deny race + reclaim heartbeat step 改名 | S | runtime/execute.ts | review T1 |
| 7 | mobile types optional + AgentStepKind 补齐 + 详情页 push 不 replace + list `hasMore` | S | mobile types/screens | review T2/T4/T9 |
| 8 | MCP `handshakeTimeoutMs` 删字段 + close() 显式 reject pending + abort listener cleanup | S | mcp/stdioTransport.ts | review T8 |
| 9 | secretBox keyId 版本化（base64 头部 1B versionTag、显式 v0/v1 dispatch、v0 兼容老 sealed）+ `AGENT_KEY_SECRET_PREV` 轮换 | M | secretBox.ts | review 后续议程 |
| 10 | `listForAgent` 二次 validate + DB 历史 skills lazy scan + README/docs 收尾 | M | topicSkills + 文档 | review T7/T9 |
| **11b** | **LLM provider 抽象 - 接口 + 工厂 + DeepSeek 适配**（基于 11a spike 钉的接口） | M | task 1 + 11a | 用户需求 |
| **11c** | **LLM provider 抽象 - ZenMux 适配 + 错误归一化** | M | 11b | 用户需求 |
| **11d** | **LLM provider 抽象 - migration 015 + runLlmClient.ts + planner/replyGen 改造 + 老 run 兼容** | L | 11b + 11c + task 9 | 用户需求 |
| 12 | per-run / per-topic 模型选择 UI + 鉴权（user-key per provider） | M | 11d | 用户需求 |
| 13 | **M1c 高优先级 followups**：urlFetch size cap、docExport 不覆盖用户编辑、idempotency key 加 ownerId、planner LLM 失败 emit notice、orchestrator 死代码清理 | M | task 1 + task 2 + 11d (planner 路径) | M1c review 必修 + 高优 #1-5 |

**预估总工时**：36-46h（M1e reviewer 调整），task 11 拆 4 个 subtask（11a spike 1-1.5h、11b/11c 各 3-4h、11d 5-7h）总计 12-16h，是 M1e 单点 #1 风险，先 spike 验通再展开。

### M1c review followups 已并入 / 推后情况

| review 项 | 处理 |
|----------|------|
| 🔴 `urlFetch` size cap | M1e task 13 |
| 🟡 `docExportMarkdown` 覆盖用户编辑 | M1e task 13 |
| 🟡 `docExportMarkdown` idempotency key 漏 ownerId | M1e task 13 |
| 🟡 planner LLM 失败静默回 echo | M1e task 13（emit notice 走 task 2 通道） |
| 🟡 orchestrator.ts 死代码 `analyzeIntent` | M1e task 13（删 dead code） |
| 🟡 web_search 失败 planner 不识别（system prompt 缺约定） | **M2 推迟**（M2 真工具洪水时一并改 prompt 模板） |
| 🟡 replyGen `collectExportedDocs` 硬编码 | **M2 推迟**（M2 加 docExportFeishu / docExportPdf 时同时改） |
| 🟡 replyGen `summarizeOutput` 摘要丢信息 | **M2 推迟**（同上，按 tool 走分策略） |
| 🟡 parsePlannerJson 尾随逗号 / 多余文字 | **M2 推迟**（节点小、可在 M2 计划里顺手做） |
| 🟡 magiSystemRead 错误吃掉 → output 加 `ok` | **M2 推迟**（属于 MAGI 工具集合统一治理） |

### 不在 M1e 范围（推后到 M2 / 单独里程碑）

- ❌ MCP 切官方 `@modelcontextprotocol/sdk`（M2 + browser-use 时一起换，避免双重大改）
- ❌ 任务面板 cursor 分页（hasMore 字段先留接口；真正需要分页时再做）
- ❌ RN EventSource polyfill（M1d 已确认 polling 够用）
- ❌ 多 agent 协作（spec §1.3 已划除非目标）
- ❌ 多模态（图 / 音频）输入到 agent（ZenMux 支持但 spec 当前 IntentKind 不传图，留 M2/M3）
- ❌ Anthropic / OpenAI 直连（M1e 只覆盖现有 codebase 已有 provider；未来加新 provider = 加个 `LlmChatClient` 实现即可）
- ❌ **spec §13 `tool_call` reservation 模式**（当前用 `tool_call_key` partial unique index 兜，reservation 模式留 M2 真高并发时再上）
- ❌ **跨 run `documents.payload.agentIngestCache` 缓存**（M1c plan §2.2 deferred，M2 真接 magi-content 工作流时落库）
- ❌ **`awaiting_confirm` 状态的 worker 死路径清理**（M1d 引入但暂时没真用户路径，等 task 12 模型选择 UI 上线后看是否需要"用户先确认参数再 run"流程）
- ❌ **cancel signal 在 worker tool handler 内部的一致性审查**（runtime 已 abort `ctx.signal`，但 magi/url 等工具是否真透传到 fetch 没全部 audit，M2 工具洪水时一起 audit）

---

## 1. baseline 准备

```bash
git checkout main
git pull
pkill -f "tsx watch.*行动中止派" 2>/dev/null
git checkout -b feat/agent-runtime-m1e
set -a; source .env; set +a
npm run test -w @xzz/api   # baseline 169 tests
npx tsc --noEmit -p apps/api
npx tsc --noEmit -p apps/mobile
```

确认全部绿后开干。每个 task 一个 commit，subject `feat(agent)` / `fix(agent)` / `refactor(agent)` / `docs(agent)`。

---

## 2. Task 1：拆 `runtime.ts`（refactor，无行为变更）

### 2.1 目标

把 `apps/api/src/lib/agent/runtime.ts`（762 行）拆成：

```
apps/api/src/lib/agent/
├── runtime.ts                # 仅 re-export（保持外部 import 路径不变）
├── runLifecycle.ts           # createAgentRun + softComplete + cancelRun + DEFAULT_BUDGET
├── runExecute.ts             # executeRun 主入口 + reclaim + idempotency gate + approval gate
├── runReply.ts               # buildFinalContent + pickFallbackFinalContent + formatBudgetExhaustedReply
├── runPlanGlue.ts            # buildInitialPlan（生产 vs 测试环境判定 + LLM planner 调用入口）
└── runtimeShared.ts          # 共享常量 / 错误类型 / runControllers Map / withTimeout
```

> ⚠️ **task 1 不再拆 `runApiKey.ts`**：key/llm 解析逻辑会被 task 11d 整体重写为 `runLlmClient.ts`（per-provider 解密 + buildLlmClient），先拆出来再删属于无谓返工。task 1 保留 `resolveEffectiveApiKey` 作为 `runExecute.ts` 内部 private function，task 11d 一并迁出。

### 2.2 步骤

1. **不动测试**，先开新文件按上述拆分搬代码，每个文件互相 import；
2. `runtime.ts` 改成：
   ```ts
   export * from './runLifecycle.js';
   export * from './runExecute.js';
   export { resolveToolCallKey } from './runExecute.js'; // 保持现有测试 import
   ```
3. `npx tsc --noEmit -p apps/api` 必须 clean；
4. `npm run test -w @xzz/api` 必须 169/169 不变（行为零变更是关键约束）。

### 2.3 验收

- `wc -l apps/api/src/lib/agent/run*.ts` 每个文件 ≤ 250 行
- 任何外部 `import ... from './runtime.js'` 都不需要改路径
- 测试全绿

### 2.4 Commit

```
refactor(agent): split runtime.ts into lifecycle/execute/reply/apiKey/planGlue (no behavior change)
```

---

## 3. Task 2：统一"用户可感降级 notice"通道

### 3.1 背景

M1d review 指出多处"静默 fallback" UX 真空：key 解密失败、retry 重复、skill 被 inject reject。需要一个统一渠道让降级**对用户可见**。

### 3.2 设计

- **DB**：复用 `agent_event_logs` 表，加 `kind = 'user_facing_notice'`（不需 migration，kind 是 TEXT）。
- **NoticeCode 联合类型**（**钉死，所有 emit 调用必须用此 enum，便于未来 i18n 和 sentry 分类**）：
  ```ts
  export type NoticeCode =
    // key / 鉴权
    | 'USER_KEY_MISSING'           // user 模式但 sealed=null（旧数据或 AGENT_KEY_SECRET 未配）
    | 'USER_KEY_DECRYPT_FAILED'    // sealed 解密失败（secret 轮换 / 损坏）
    | 'KEY_FALLBACK_TO_SERVER'     // 已退回到 server key
    | 'NO_API_KEY'                 // 既无 user 也无 server key
    // retry / 幂等
    | 'RETRY_DEDUPED'              // 10s 窗口内已 retry
    // LLM 失败
    | 'PLANNER_LLM_FALLBACK'       // LLM 规划失败回退 echo
    | 'REPLY_LLM_FALLBACK'         // LLM 终稿失败回退模板
    // skill / 注入防御
    | 'SKILL_WARN_KEYWORD'         // 关键词命中 low-severity pattern，已 warn-log 但保留
    | 'SKILL_DROPPED'              // listForAgent 二次过滤 drop（high-severity）
    // 工具 / docExport
    | 'DOC_EXPORT_VERSIONED'       // 用户改过原文档，agent 写到 ${title} v2
    | 'TOOL_PAYLOAD_TOO_LARGE'     // urlFetch 等超 size cap
    // MCP
    | 'MCP_HANDSHAKE_FAILED'
    ;
  ```
- **写入**：新 helper `apps/api/src/lib/agent/notices.ts`：
  ```ts
  export type UserNotice = {
    runId: string;
    severity: 'info' | 'warn' | 'error';
    code: NoticeCode;
    message: string; // 给用户看的中文（不参数化，参数走 context）
    context?: Record<string, unknown>;
  };
  export async function emitNotice(n: UserNotice): Promise<void>;
  export async function listNoticesForRun(runId: string, limit?: number): Promise<UserNotice[]>;
  ```
  - `emitNotice` 内部 `try/catch + console.warn`，DB 失败绝不能阻塞 agent run。
- **API**：`GET /api/agent/runs/:id` 响应里加 `notices: UserNotice[]`（最多 20 条，最近的优先）。
- **SSE**：`/runs/:id/stream` 新增 `event: notice` 事件，data 是单条 UserNotice。
  - **SSE id namespace 钉死**：复用 `agent_event_logs.id`（uuid），前缀 `n:` 区分 step 事件：
    - step 事件 id = `s:${agent_steps.id}`
    - notice 事件 id = `n:${agent_event_logs.id}`
  - `Last-Event-ID` 恢复时按前缀 dispatch：`s:` 走 listStepsAfter，`n:` 走 listNoticesAfter。
  - 两个 stream 共用一个 SSE 连接，按 created_at 顺序穿插。
- **Mobile**：
  - `AgentRunCard` 顶部增加 notice 行（severity=warn 黄底 ⚠️、error 红底 ❗），点击展开 message + context；
  - notice 不影响 step 列表渲染。
  - notice list 渲染按 NoticeCode 显示前缀 emoji（避免每条 message 重复带 ⚠️ 文案）。

### 3.3 测试

- `notices.test.ts`：emit + list round-trip、severity 排序、limit 20。
- 路由测试：notice 出现在 GET /runs/:id 响应。
- SSE 测试：emit 后客户端能收到 `event: notice`。

### 3.4 Commit

```
feat(agent): user-facing notice channel — agent_event_logs.kind='user_facing_notice' + SSE event + mobile banner
```

---

## 4. Task 3：Blocker 1 + 3 —— per-user key 降级 surface + retry 复制 key

### 4.1 修改

**4.1.1** `runApiKey.ts` 的 `resolveEffectiveApiKey`：

```ts
async function resolveEffectiveApiKey(run: AgentRun): Promise<string | undefined> {
  const serverKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (run.apiKeySource !== 'user') return serverKey || undefined;

  const sealed = await store.getUserApiKeyEnc(run.id);
  if (!sealed) {
    // user 模式但没有 sealed key（旧数据 / AGENT_KEY_SECRET 未配时创建）
    await emitNotice({
      runId: run.id, severity: 'warn', code: 'USER_KEY_MISSING',
      message: '你选择了用自己的 DeepSeek key，但服务端未保存（请检查 AGENT_KEY_SECRET 配置）。本次跑用服务端 key。',
    });
    return serverKey || undefined;
  }

  try {
    const { openUserApiKey } = await import('./secretBox.js');
    const key = openUserApiKey(sealed).trim();
    if (key) return key;
  } catch (e) {
    await emitNotice({
      runId: run.id, severity: 'warn', code: 'USER_KEY_DECRYPT_FAILED',
      message: '用户 key 解密失败（可能因为 AGENT_KEY_SECRET 已轮换），本次跑退回服务端 key。请重新填写 key。',
      context: { error: e instanceof Error ? e.message : String(e) },
    });
  }
  return serverKey || undefined;
}
```

**4.1.2** `routes/agent.ts` 的 retry 路由：

```ts
// 取旧 run 的 sealed key + apiKeySource，原样塞给 insertAgentRun
const oldSealed = await store.getUserApiKeyEnc(run.id);
const result = await createAgentRun({ ... });
if (oldSealed) {
  await getPool().query(
    `UPDATE agent_runs SET user_api_key_enc = $1 WHERE id = $2`,
    [oldSealed, result.run.id],
  );
}
```

（更干净的做法：扩 `createAgentRun` 接受 `userApiKeyEncOverride: string | null` 参数，避免事后 UPDATE。先 UPDATE 实现，再 task 1 拆模块时顺手优化。）

### 4.2 测试

- `runtime.userKey.test.ts` 加：(a) seal A → 轮换到 secret B → resolve 退回 server key + 写 notice；(b) `apiKeySource='user'` 但 sealed=null → 写 notice。
- `agent.routes.test.ts` 加：(c) 旧 run 有 sealed key → retry 新 run 也有同 sealed key。

### 4.3 Commit

```
fix(agent): surface user-key decrypt fallback + retry preserves sealed key
```

---

## 5. Task 4：Blocker 2 —— retry 路由幂等

### 5.1 修改

`routes/agent.ts` 的 `/retry`：

```ts
// 窗口去重：同 owner + 同 inputText 在过去 10s 内已经创建过新 run → 拒绝
const recent = await getPool().query(
  `SELECT id FROM agent_runs
   WHERE owner_id = $1 AND input_text = $2
     AND created_at > now() - interval '10 seconds'
     AND id <> $3
   ORDER BY created_at DESC LIMIT 1`,
  [run.ownerId, run.inputText, run.id],
);
if (recent.rows.length > 0) {
  return c.json(
    { ok: false, error: { code: 'AGENT_RETRY_DEDUPED', message: '10s 内已重试过，请稍后', existingRunId: recent.rows[0].id } },
    409,
  );
}
```

mobile 端 `AgentRunCard` retry 按钮在 onPress 期间 disable，避免连点（已部分有这个语义靠 try/catch）。

### 5.2 测试

`agent.routes.test.ts`：
- 第一次 retry 200；
- 第二次（< 10s 内）429/409；
- 11s 后 retry 又 200。

### 5.3 Commit

```
fix(agent): retry route idempotency — 10s window dedupe + mobile button disable
```

---

## 6. Task 5：Blocker 4 —— topicSkills 正则放宽

### 6.1 修改

`topicSkills.ts` 的 `SUSPICIOUS_PATTERNS`：

- **改高置信策略**：每条 pattern 加一个 `severity: 'high' | 'low'` 字段。
  - high = 明显的 jailbreak 标志（如 "you are now DAN / 扮演无审查管理员"）→ 仍然 reject 400；
  - low = 关键词（如 `api[_- ]?key` / `secret`）→ **warn-log + DB 留痕（agent_event_logs.kind='skill_warn'）但不 reject**。
- 删 `/忘[掉记]/` 这种纯关键词模式（误杀率太高）。
- `IGNORE_INSTRUCTIONS_ZH` 收紧成 `/忽略(以上|上面|之前|前面)\s*(指令|要求|系统|提示)/i`，加 "指令/要求/系统/提示" 名词限定。

### 6.2 测试

- 之前的 7 个 bad case 中"role override DAN" / "ignore previous instructions" / "force tool call" 继续 reject；
- 新增 happy case："记住客户的 API key 放 1Password" / "别忘记客户偏好" 应通过（最多 warn）。
- warn case 写入 DB 的断言。

### 6.3 Commit

```
fix(agent): relax topic-skill injection regex — high-conf reject, keyword-only warn-log
```

---

## 7. Task 6：reclaim approval_deny race + step kind 改名

### 7.1 修改

- `runExecute.ts`：把 approval_deny 也算 advancing：
  ```ts
  const dbAdvancing = allStepsForReclaim.filter(
    (s) => s.kind === 'tool_call' || s.kind === 'observe' || s.kind === 'approval_deny',
  ).length;
  ```
  （注释：approval_deny 在 approvalMode='never' 路径会推进 plan 指针）。
- reclaim 写的 step kind 从 `'heartbeat'` 改为 `'reclaim'`（types.ts 加新 kind；mobile AgentStepKind 同步加）。

### 7.2 测试

- `runtime.reclaim.test.ts` 新增 1 case：A 写了 approval_deny 后崩 → B 不重写 deny。
- 老 case 把断言里的 `kind === 'heartbeat' && reclaim` 改成 `kind === 'reclaim'`。

### 7.3 Commit

```
fix(agent): reclaim counts approval_deny as advancing + step kind 'heartbeat'→'reclaim'
```

---

## 8. Task 7：mobile UI 收尾（types optional + step kind + push + hasMore）

合并 review T2/T4/T9 三条 mobile-only 建议：

- `apps/mobile/src/features/agent/types.ts`：`usage?` / `budget?` 改 optional；`AgentStepKind` 补 `'replan' | 'heartbeat' | 'reclaim' | 'cancel' | 'system_error'`（与后端 types.ts 对齐）。
- `BrainAgentTaskDetailScreen.tsx`：`navigation.replace` → `navigation.push`。
- `routes/agent.ts` `GET /runs` 响应加 `hasMore: runs.length === limit`；mobile 列表暂不显示，保留字段。

### Commit

```
chore(agent-mobile): types alignment + detail push + list hasMore
```

---

## 9. Task 8：MCP stdioTransport 清理

- 删 `handshakeTimeoutMs` 字段（dead code）。如果未来真要 handshake timeout 再加。
- `close()` 在 kill 前显式 reject 所有 pending：
  ```ts
  for (const p of this.pending.values()) p.reject(new Error('mcp client closed'));
  this.pending.clear();
  ```
- abort listener settle 时 `signal.removeEventListener('abort', onAbort)`。

### 测试

`stdioTransport.test.ts` 加：
- close 后再 await pending 立刻 reject；
- 同 signal 复用 10 次 callTool，settle 后 listener count 应回到 0（用 `signal.eventListeners('abort').length` 或 spy）。

### Commit

```
chore(mcp): drop dead handshakeTimeoutMs + close() rejects pending + abort listener cleanup
```

---

## 10. Task 9：secretBox keyId 版本化

### 10.1 设计

- **v1 payload 结构**：`base64(versionTag(1B) || iv(12B) || tag(16B) || ct)`，versionTag = `0x01`
- **v0 兼容（M1d 已 seal 的 key 不能丢）**：v0 payload 是 `base64(iv(12B) || tag(16B) || ct)` 无 versionTag
- **dispatch 算法**（`openUserApiKey` 内部）：

  ```ts
  function openUserApiKey(sealed: string): string {
    const buf = Buffer.from(sealed, 'base64');
    if (buf.length < 12 + 16 + 1) throw new Error('sealed payload too short');

    // 决策：v1 payload 至少 30B（1+12+16+1），v0 至少 29B（12+16+1）
    // versionTag 用 0x01..0x7F；如果首字节 ∈ [0x01..0x0F] 视为 versionTag（这范围里没合法 IV 字节碰撞概率约 6%，但 v1 是确定写入，v0 是历史老数据，错误率可控）
    // 更稳的策略：尝试 v1 → 失败 fallback v0（用 try/catch）
    try {
      return openV1(buf);    // 取 buf[0] 当 version，buf[1..12] 当 iv
    } catch (e1) {
      try {
        return openV0(buf);  // 取 buf[0..11] 当 iv（M1d 老格式）
      } catch (e2) {
        throw new Error(`secretBox open failed: v1=${e1.message}, v0=${e2.message}`);
      }
    }
  }
  ```

  - 写入永远走 v1。读取 try v1 → fallback v0。
  - v1 / v0 都各自尝试 `[AGENT_KEY_SECRET, AGENT_KEY_SECRET_PREV]` 两个 secret，2×2 共 4 次尝试，任一成功即返回。
  - 4 次都失败 → 抛 `Error('secretBox open failed: ...')`，caller（task 3 的 `resolveEffectiveApiKey`）catch 后 emit `USER_KEY_DECRYPT_FAILED` notice。

- **rotation 流程**（文档加到 README）：
  1. 把当前 `AGENT_KEY_SECRET` 复制到 `AGENT_KEY_SECRET_PREV`
  2. 生成新 secret 写 `AGENT_KEY_SECRET`
  3. 重启 API；老 sealed key 还能用 PREV 解开；新写入的全走新 SECRET（v1 格式）
  4. 一段时间后（用户都 re-save 过 key），删 `AGENT_KEY_SECRET_PREV`

### 10.2 测试

- `secretBox.test.ts` 加：
  - (a) seal v1 → open v1 round-trip
  - (b) seal with secret A → 移到 PREV → 设新 SECRET → open 仍成功
  - (c) 仅 SECRET 改不到 PREV → open 失败（让 task 3 测试 emit notice）
  - **(d)** v0 兼容：构造 M1d 老格式 sealed（手动 base64(iv||tag||ct) 无 versionTag）→ 新代码 open 成功（dispatch 走 v0 分支）
  - (e) v1 + 新 secret + 老 sealed 是 v0 + 老 secret 在 PREV → open 成功（走 v0×PREV 组合）

### 10.3 Commit

```
feat(agent): secretBox v1 versioning + AGENT_KEY_SECRET_PREV rotation support
```

---

## 11. Task 10：`listForAgent` 二次过滤 + 历史 skills lazy scan + 文档收尾

### 11.1 修改

- `topicSkills.ts.listForAgent`：返回前再跑一次 `validateSkillInput`，**high severity 直接 drop + emitNotice**（不向 LLM 注入 inject content）。这就是 "defense-in-depth"。
- 新增 npm script `npm run lint:topic-skills`（或一次性 migration）：扫历史 `topic_skills`，把含 high-severity pattern 的标 `enabled = false`，并写 admin 警告日志。
- README 更新：
  - 把 M1e 加进 "Agent Runtime" 章节标题
  - SSE 段补 Last-Event-ID 续传描述
  - 加 `AGENT_KEY_SECRET_PREV` 段
  - 加"用户可感降级"小节，介绍 notice 通道
- spec §19 测试矩阵：T5 标注里把"approval_deny race" 列为已覆盖。

### 11.2 Commit

```
feat(agent): defense-in-depth skill filter + historical scan + M1e docs
```

---

## 12. Task 11：LLM provider 抽象（拆 4 个 subtask） ✅ DONE (11a–d)

- 11a 完成（见下节）
- 11b commit `bb05e35` — interface + factory + DeepSeek adapter
- 11c commit `928a487` — ZenMux adapter (OpenAI + Anthropic)
- 11d 完成 — migration 015 + runLlmClient + planner/replyGen 改 LlmChatClient


### 12.0 现状盘点

- `apps/api/src/lib/deepseek.ts.chatCompletionRaw(apiKey, messages, opts)` —— 当前 agent planner / replyGen 唯一调用点；签名 `(apiKey, messages, { temperature, response_format, log })`
- `apps/api/src/lib/zenmux.ts.zenmuxChatFromMessages(apiKey, messages, opts)` —— 签名 `(apiKey, messages, { model, temperature, log })`，**没有 `response_format`**，需用 prompt 引导 JSON
- `apps/api/src/lib/dashscope.ts` —— 只做 TTS/ASR，不在 chat 抽象内
- 现有 `apps/mobile` "我的"页有 DeepSeek/ZenMux/Dashscope 三个 key 录入位

---

### 12.1 Task 11a：SPIKE（已完成 ✅，2026-05-21）

**spike 脚本**：`apps/api/src/scripts/llmSpike.ts`（保留在仓库，未来加 provider 时复用）

**6/7 用例通过**（1 失败为 model 自身问题，不影响接口决策）：

| vendor   | model                              | scenario                | result                  |
|----------|------------------------------------|-------------------------|-------------------------|
| deepseek | deepseek-v4-pro (reasoning)        | hello (maxTokens=256)   | ✅ "ok"                 |
| zenmux   | moonshotai/kimi-k2.6               | hello (temp=1 forced)   | ❌ "ZenMux 没有返回内容" |
| zenmux   | anthropic/claude-sonnet-4.6        | hello                   | ✅ "ok"                 |
| deepseek | deepseek-v4-pro (reasoning)        | json-prompt (mt=512)    | ✅ `{"answer":"ok"}`    |
| zenmux   | moonshotai/kimi-k2.6               | json-prompt (temp=1)    | ✅ `{"answer":"ok"}`    |
| zenmux   | anthropic/claude-sonnet-4.6        | json-prompt             | ✅ `{"answer":"ok"}`    |
| deepseek | deepseek-chat (raw fetch + signal) | abort 200ms             | ✅ AbortError @ 203ms   |

#### Spike 决策（钉死，task 11b/11c/11d 必须按此实现）

1. **JSON 输出 → 不引入 `responseFormat` 字段，全靠 prompt 引导**
   - DeepSeek `chatCompletionRaw` 当前 wrapper **没暴露 `response_format`**，prompt 严格要求即可（v4-pro reasoning 也 OK）
   - ZenMux 也没暴露
   - 结论：`LlmChatOptions` **不加 `responseFormat` 字段**，全靠 system prompt + `parsePlannerJson` 兼容裸 JSON / fence。M2 真碰到强 strict 场景再加。
   - 影响：plan §12.2.1 接口要**删掉 `responseFormat` 字段**。

2. **modelId 命名 → provider 原生 id 透传，无 vendor 第三字段**
   - DeepSeek：`'deepseek-v4-pro'` / `'deepseek-v4-flash'` / `'deepseek-chat'`（server 自动 alias 到 flash）/ `'deepseek-reasoner'`
   - ZenMux：`'anthropic/claude-sonnet-4.6'` / `'moonshotai/kimi-k2.6'` / `'openai/gpt-5.5'` / `'deepseek/deepseek-v4-pro'`（注意 ZenMux 内部 DeepSeek 与直连 DeepSeek 是两条路径，不要混）
   - 结论：`providerId='zenmux'` + `modelId='anthropic/claude-sonnet-4.6'` 已足够；ZenMux 内部 vendor 路由由现有 `zenmuxChatModelMeta` 兜。**不引入 `vendor` 第三字段。**

3. **AbortSignal → 升级为必做项（不是 optional）**
   - raw fetch + AbortController 实测 ~200ms 内中断 ✅
   - 但当前两个 wrapper（`chatCompletionRaw` / `zenmuxChatFromMessages`）**都不接 `signal`**
   - 结论：task 11b（DeepSeek adapter）和 task 11c（ZenMux adapter）**必须扩底层 wrapper 签名 + plumb 到 fetch**。否则 runtime 已有的 `ctx.signal` 形同虚设，cancel 路径在 LLM 调用期间不生效。
   - 影响：plan §12.2.1 `LlmChatOptions.signal` 改成 **required（非可选）**。

#### Spike 隐藏陷阱（task 11b/11c 实现时必须处理）

- **陷阱 #1**：`DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro'` 是 reasoning model。reasoning tokens 计入 `max_tokens`。短 prompt（hello）也要 ≥ 256 tokens，否则 content 为空。**DeepSeek adapter `maxTokens` 默认值要从 wrapper 当前的 2048 提到 4096**，并在文档里注明 reasoning model 的额外预算。
- **陷阱 #2**：ZenMux Kimi K2.6 偶发"空返回"（spike 第二轮 hello 翻车）。**ZenMux adapter 要把"content 为空"映射成 `LlmProviderError(kind='unknown')`**（当前 wrapper 已 throw 'ZenMux 没有返回内容'），caller 走 fallback。
- **陷阱 #3**：Kimi K2.6 强制 `temperature=1`，传 0/0.3 会被 server 拒绝（`invalid temperature`）。**`DEFAULT_MODEL_FOR_PROVIDER` 表要扩成 `{ modelId, defaultTemperature }`**，让上层 planner 调用 chat 时不传 temperature 走默认。

#### Spike 完成标记

- ✅ `apps/api/src/scripts/llmSpike.ts` checked in
- ✅ 3 个决策点 + 3 个陷阱已写入本节
- ✅ 接口字段调整（去 responseFormat / signal 升为 required / per-model temperature）已传播到 §12.2.1

下一步：进 task 1 拆 `runtime.ts`，再进 task 11b。

### 12.2 Task 11b：接口 + 工厂 + DeepSeek 适配

**12.2.1 接口**（新文件 `apps/api/src/lib/llm/types.ts`，**字段语义钉死 — 已按 spike 结论调整**）：

```ts
export type LlmChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmChatOptions = {
  /** 不传则走 per-model default（Kimi=1、Claude/DeepSeek=0.3） */
  temperature?: number;
  /** 不传则走 per-model default（reasoning model 默认 4096，普通 model 2048） */
  maxTokens?: number;
  log?: LlmRequestLogContext;
  /** spike 决策：必传不可省。cancelRun 路径靠它中断 LLM 调用 */
  signal: AbortSignal;
  // 注：不引入 responseFormat 字段（spike 决策 #1：靠 prompt 引导）
};

export type LlmChatUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

export type LlmChatResult = {
  content: string;
  usage: LlmChatUsage;
  providerId: LlmProviderId;
  modelId: LlmModelId;
};

export type LlmProviderId = 'deepseek' | 'zenmux';

/** 透传给 provider 的 model 字符串。无 vendor 第三字段（spike 决策 #2） */
export type LlmModelId = string;

export type LlmChatClient = {
  providerId: LlmProviderId;
  modelId: LlmModelId;
  chat(messages: LlmChatMessage[], opts: LlmChatOptions): Promise<LlmChatResult>;
};

export class LlmProviderError extends Error {
  constructor(
    public providerId: LlmProviderId,
    public modelId: LlmModelId,
    public kind: 'auth' | 'rate_limit' | 'timeout' | 'bad_request' | 'empty_content' | 'unknown',
    message: string,
    public cause?: unknown,
  ) { super(message); this.name = 'LlmProviderError'; }
}
```

**12.2.2 工厂 + per-model 默认值**（`apps/api/src/lib/llm/factory.ts`）：

```ts
export type LlmClientSpec = { providerId: LlmProviderId; modelId: LlmModelId; apiKey: string };

export function buildLlmClient(spec: LlmClientSpec): LlmChatClient {
  switch (spec.providerId) {
    case 'deepseek': return new DeepSeekLlmClient(spec.apiKey, spec.modelId);
    case 'zenmux':   return new ZenMuxLlmClient(spec.apiKey, spec.modelId);
    default: throw new Error(`unsupported llm provider: ${spec.providerId satisfies never}`);
  }
}

export const DEFAULT_PROVIDER_ID: LlmProviderId =
  (process.env.LLM_DEFAULT_PROVIDER as LlmProviderId | undefined) ?? 'deepseek';

// 注意：default model 同时携带 temperature 默认（spike 陷阱 #3：Kimi 强制 1）
export type ModelProfile = { modelId: string; defaultTemperature: number; defaultMaxTokens: number };

export const DEFAULT_MODEL_FOR_PROVIDER: Record<LlmProviderId, ModelProfile> = {
  deepseek: {
    modelId: process.env.DEEPSEEK_MODEL_PRO ?? 'deepseek-v4-pro',
    defaultTemperature: 0.3,
    defaultMaxTokens: 4096,  // reasoning model 需要更大预算（spike 陷阱 #1）
  },
  zenmux: {
    modelId: process.env.ZENMUX_DEFAULT_MODEL ?? 'anthropic/claude-sonnet-4.6',
    defaultTemperature: 0.3,
    defaultMaxTokens: 2048,
  },
};

// per-modelId override（处理 spike 陷阱 #3 等硬约束）
export const MODEL_OVERRIDES: Record<string, Partial<ModelProfile>> = {
  'moonshotai/kimi-k2.6': { defaultTemperature: 1 },          // server 强制 temperature=1
  'deepseek-v4-pro':      { defaultMaxTokens: 4096 },         // reasoning，需大预算
  'deepseek-reasoner':    { defaultMaxTokens: 8192 },
};

export function resolveModelProfile(providerId: LlmProviderId, modelId: string): ModelProfile {
  const base = DEFAULT_MODEL_FOR_PROVIDER[providerId];
  const override = MODEL_OVERRIDES[modelId] ?? {};
  return { ...base, modelId, ...override };
}
```

**12.2.3 DeepSeek 适配**（`apps/api/src/lib/llm/providers/deepseek.ts`）：薄包 `chatCompletionRaw`，归一化 usage / 错误。

**测试**（task 11b 当 commit 前必须全绿）：
- `llm/factory.test.ts`：buildLlmClient 已知 / 未知 providerId
- `llm/providers/deepseek.test.ts`：mock fetch，验证 chat 返回 LlmChatResult 形态、auth/429/超时错误归一化成 LlmProviderError

**Commit**：
```
feat(llm): chat client interface + factory + DeepSeek adapter
```

### 12.3 Task 11c：ZenMux 适配 + 错误归一化

`apps/api/src/lib/llm/providers/zenmux.ts`：薄包 `zenmuxChatFromMessages`，按 spike 结论处理 `responseFormat='json_object'`（如不支持则在 system prompt 加 "Respond with JSON only"）。

**测试**：`llm/providers/zenmux.test.ts`：mock fetch、auth/429 归一化、`responseFormat='json_object'` 时 prompt 自动加 JSON 指令。

**Commit**：
```
feat(llm): ZenMux adapter with json_object polyfill + error normalization
```

### 12.4 Task 11d：migration + runLlmClient + planner/replyGen 改造

**12.4.1 DB migration**（`apps/api/src/db/migrations/015_agent_run_model.sql`）：

```sql
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS provider_id TEXT NOT NULL DEFAULT 'deepseek';
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model_id    TEXT NOT NULL DEFAULT 'deepseek-chat';
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS user_zenmux_key_enc TEXT;
-- 注意：DEFAULT 'deepseek' / 'deepseek-chat' 解决"老 run 这俩字段 NULL"问题，避免代码里到处 ?? 兜底
-- 注意：user_api_key_enc 沿用 = user 的 DeepSeek key（M1d 老字段不动），ZenMux 走新列
```

**12.4.2 `runLlmClient.ts`**（新文件，取代 task 1 不再拆出的 `runApiKey.ts`）：

```ts
export async function resolveLlmClient(run: AgentRun): Promise<LlmChatClient | null> {
  const providerId = (run.providerId ?? DEFAULT_PROVIDER_ID) as LlmProviderId;
  const modelId = run.modelId ?? DEFAULT_MODEL_FOR_PROVIDER[providerId];
  const apiKey = await resolveEffectiveApiKeyForProvider(run, providerId);
  if (!apiKey) {
    await emitNotice({ runId: run.id, severity: 'error', code: 'NO_API_KEY',
      message: `没有可用的 ${providerId} key（既无用户配置也无服务端 env）`, context: { providerId, modelId } });
    return null;
  }
  return buildLlmClient({ providerId, modelId, apiKey });
}

async function resolveEffectiveApiKeyForProvider(run: AgentRun, providerId: LlmProviderId): Promise<string | undefined> {
  // server fallback env
  const serverKey = providerId === 'deepseek'
    ? process.env.DEEPSEEK_API_KEY?.trim()
    : process.env.ZENMUX_API_KEY?.trim();
  if (run.apiKeySource !== 'user') return serverKey || undefined;

  // user sealed key —— per-provider 字段
  const sealed = providerId === 'deepseek'
    ? await store.getUserApiKeyEnc(run.id)           // M1d 老字段沿用
    : await store.getUserZenmuxKeyEnc(run.id);

  if (!sealed) {
    await emitNotice({ runId: run.id, severity: 'warn', code: 'USER_KEY_MISSING',
      message: `选了 ${providerId} 自带 key 但未保存，本次走服务端 key`, context: { providerId } });
    return serverKey || undefined;
  }

  try { return (await openUserApiKey(sealed)).trim(); }
  catch (e) {
    await emitNotice({ runId: run.id, severity: 'warn', code: 'USER_KEY_DECRYPT_FAILED',
      message: `${providerId} key 解密失败（secret 轮换？），本次走服务端 key`,
      context: { providerId, error: String(e) } });
    return serverKey || undefined;
  }
}
```

**12.4.3 改 planner + replyGen**：

```ts
// planner.ts
export async function generatePlanWithLlm(input: {
  inputText: string; snapshot: AgentContextSnapshot;
  llm: LlmChatClient;   // ← 取代 apiKey: string
  role?: string;
}): Promise<Plan> {
  const result = await input.llm.chat(messages, { temperature: 0.3, responseFormat: 'json_object', log: {...} });
  // ...
}
```

`replyGen.generateFinalReply` 同改。

**12.4.4 改 `runExecute.ts` / `runReply.ts` / `runPlanGlue.ts`**：把 `effectiveKey: string` 替换成 `llm: LlmChatClient | null`，null → fallback（echo / 模板）。

**12.4.5 老 run 兼容**：
- migration 已加 `NOT NULL DEFAULT 'deepseek'`，所有现有 row 落库时自动填默认值
- 代码里彻底**不再 `?? 'deepseek'`**（由 DB 兜，避免双重默认值漂移）

**测试**：
- `runtime.userKey.test.ts` 扩成 `runtime.llmResolve.test.ts`：(a) 老 run（provider_id 经 migration 填 default）能 resolve；(b) zenmux + key 缺失 emit `NO_API_KEY`；(c) per-provider sealed 解密失败 emit `USER_KEY_DECRYPT_FAILED`
- `planner.llm.test.ts` / `replyGen.test.ts`：mock `LlmChatClient` 而非 mock chatCompletionRaw（mock 接口更简单）
- migration smoke：跑 015 后老数据 provider_id 不为 null

**Commit**（task 11d 拆 1 个原子 commit，避免 migration 和代码不同步）：
```
feat(agent): plumb LlmChatClient through planner/replyGen + migration 015 + per-provider key resolve
```

---

## 13. Task 12：模型选择 UI + per-provider 鉴权

### 13.1 mobile 改造

**13.1.1 设置**：在 "Agent 任务" 入口附近加 "默认模型" 设置（或在 BrainHomeKeys 屏后增设 "Agent 默认 provider"）。

写入：用户级 setting `agent.defaultProvider` + `agent.defaultModel`（沿用现有 `apps/mobile/src/store/settings` 或写到 user 后端表，看现有架构）。

**13.1.2 触发时**：`intentExecute` 走 `agent_run` 分支时，前端把 `defaultProvider` / `defaultModel` 通过 header 或 body 传给 `/api/intent/execute`，后端写到新建 run 的 `provider_id` / `model_id` 字段。

**13.1.3 任务面板 / AgentRunCard**：显示当前 run 用的 provider + model（顶部小字"by deepseek / deepseek-chat"），透明化。

**13.1.4 retry 路由**：复用旧 run 的 `provider_id` / `model_id`（沿用 task 3 的"复制旧 run 配置"思路）。

### 13.2 后端 API 改造

- `/api/intent/execute` 接受新 body 字段：
  ```ts
  { agentOptions?: { providerId?: LlmProviderId; modelId?: LlmModelId } }
  ```
  `intentExecute.ts` 在创建 agent_run 时把它们传进 `createAgentRun`
- `createAgentRun` 签名加 `providerId?` / `modelId?`，写入 `agent_runs.provider_id` / `model_id`
- `/api/agent/runs` 列表响应里加 `providerId` / `modelId` 字段（已经在 run 对象上自动序列化）

### 13.3 测试

- `intentExecute.agent.test.ts`：传 `agentOptions.providerId='zenmux'` → 建出 run.provider_id='zenmux'
- mobile 端：基本 UI smoke

### 13.4 Commit

```
feat(agent-mobile): per-run model selection UI + intentExecute agentOptions wiring
```

---

## 14. Task 13：M1c 高优先级 followups ✅ DONE (commit 01b47db)

来自 M1c code review（2026-05-21），含 1 个 🔴 必修 + 4 个 🟡 高优。**全部完成**。

### 14.1 urlFetch HTML size cap（🔴 必修）

`apps/api/src/lib/agent/tools/urlFetch.ts:52-72`

修改：
```ts
const MAX_BYTES = 4 * 1024 * 1024;          // 4MB 上限
const ALLOWED_CT = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

const res = await fetch(input.url, { signal: ctx.signal, headers: { Accept: 'text/html,application/xhtml+xml' }});
const ct = res.headers.get('content-type') ?? '';
if (!ALLOWED_CT.test(ct)) throw new Error(`unsupported content-type: ${ct}`);
const cl = Number(res.headers.get('content-length'));
if (cl && cl > MAX_BYTES) throw new Error(`payload too large: ${cl}`);

// 边读边累计 byteLength，超阈值 abort
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let html = '';
let bytes = 0;
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  bytes += value.byteLength;
  if (bytes > MAX_BYTES) { try { await reader.cancel(); } catch {} throw new Error('payload exceeded MAX_BYTES'); }
  html += decoder.decode(value, { stream: true });
}
html += decoder.decode();
// ... 然后 new JSDOM(html, ...)
```

测试 `tools.urlFetch.test.ts` 新增 3 例：
- content-type 不允许 → throw
- content-length > 4MB → throw（mock fetch 返回 headers + 大 body 不会真的传完）
- 实际累计超阈值 → throw + reader.cancel 被调

### 14.2 docExportMarkdown 不覆盖用户编辑（🟡）

`apps/api/src/lib/agent/tools/docExportMarkdown.ts:60-91`

改造：
- upsert 命中已有 doc 时，先取当前 first-block 的 text；与"agent 上次写入的内容 hash"比对（hash 存在 `documents.payload.agentLastExportHash`）。
- 若不一致（说明用户改过），**不覆盖**，而是创建一个新文档 title 形如 `${input.title} v2`，并 emitNotice 告诉用户。
- 一致则正常覆盖 + 更新 hash。

需要在 `documents.payload` 加 `agentLastExportHash?: string` 字段（已是 JSONB，无 migration 成本）。

### 14.3 docExportMarkdown idempotency key 加 ownerId（🟡）

`apps/api/src/lib/agent/tools/docExportMarkdown.ts:50-53`

```ts
computeIdempotencyKey: (input, ctx) =>
  'doc:' + createHash('sha256').update(`${ctx.ownerId}:${input.title.trim().toLowerCase()}`).digest('hex'),
```

注意 `computeIdempotencyKey` 当前签名只接 `input` 不接 `ctx` —— 看 `toolRegistry.ts` 是否需要扩签名。若不便扩，临时方案：把 ownerId 拼到 toolCallKey 外层（在 `resolveToolCallKey` 里加 `${run.ownerId}:`）。

测试加：同 input、不同 ownerId → idempotency key 应不同。

### 14.4 planner LLM 失败 emit notice + system_error step（🟡）

`apps/api/src/lib/agent/runPlanGlue.ts`（task 1 拆完后的位置）的 `buildInitialPlan` catch 分支：

```ts
try {
  return await generatePlanWithLlm({ inputText: text, snapshot, llm });
} catch (e) {
  await recordStep({ runId: run.id, kind: 'system_error', error: `planner_llm_fallback: ${msg(e)}` });
  await emitNotice({
    runId: run.id, severity: 'warn', code: 'PLANNER_LLM_FALLBACK',
    message: 'AI 规划暂时不可用，已退回到 echo 计划。建议稍后重试或检查 LLM 配置。',
    context: { providerId: llm.providerId, modelId: llm.modelId, error: msg(e) },
  });
  return generatePlanForEcho(text);
}
```

测试 `runtime.research.e2e.test.ts` 或新 fixture：mock llm.chat throw → run 完成后 listNotices(run.id) 应含 `PLANNER_LLM_FALLBACK`。

### 14.5 删 orchestrator 死代码 `analyzeIntent`（🟡）

`apps/api/src/lib/orchestrator.ts:78-83` 的 `top.kind !== 'agent_run'` 守卫在 `analyzeIntent` 函数里，**没有任何 production 调用点**（生产走 `intentAnalyzer.pickAutoExecute`）。

两个动作：
1. 删 `analyzeIntent` 函数 + 它专属的 `__tests__/orchestrator.agent.test.ts`（已无现实意义）；
2. 把 "agent_run 不 autoExecute" 的真守卫加到 `intentAnalyzer.pickAutoExecute` 里（哪怕 `forceChips:true` 兜得住，这里加一道明确守卫做 defense-in-depth）：
   ```ts
   if (candidate.kind === 'agent_run') return false;
   ```

测试 `intentAnalyzer.test.ts` 新增 1 case：agent_run 即使 confidence=1.0 也不会 autoExecute。

### 14.6 Commit

```
fix(agent): M1c review followups — urlFetch size cap, docExport safety, planner fallback notice, orchestrator dead code
```

---

## 15. 合并 & tag

```bash
git checkout main
git merge --no-ff feat/agent-runtime-m1e -m "Merge M1e: tech-debt cleanup + LLM provider abstraction + M1c followups"
git tag v0.m1e
```

验收清单：
- ✅ 4 个 M1d review blocker 全修
- ✅ M1c review 1 必修 + 4 高优全修
- ✅ runtime.ts 拆完（每文件 ≤ 250 行）
- ✅ LLM provider 抽象就绪：DeepSeek + ZenMux 都能跑 agent，用户可在 UI 选 provider
- ✅ 169 → ~215 tests 全绿（每 task 至少 +1 case）
- ✅ `tsc -p apps/{api,mobile}` clean
- ✅ README / spec / `.env.example` 一致

---

## 16. 风险与 fallback

- **Task 1（拆 runtime.ts）是最大风险**：如果拆完测试挂，回退方式 = `git checkout main -- apps/api/src/lib/agent/runtime.ts` 再 rebase，必要时 task 1 单独拉一个 PR 让 reviewer 先 sign-off。
- **Task 2（notice 通道）**：DB 写入失败时绝对不能阻塞 agent run，所有 `emitNotice` 必须 try/catch + console.warn。
- **Task 9（secretBox 版本化）**：要兼容老的"无 version 头部" sealed key —— 检测 base64 长度若是旧格式（无版本字节），按 v0 解码。否则会把 M1d 已 seal 的 key 全部解不开。
- **Task 11（provider 抽象）**：旧 run 的 `provider_id` / `model_id` 是 NULL，必须显式 fallback 到 `DEEPSEEK_MODEL_PRO`，否则 reclaim / list 会瞎报错。
- **Task 12（UI 模型选择）**：rebuild mobile bundle 时，老 client 没传 `agentOptions` → 后端按默认 deepseek 走，向后兼容。

---

## 17. 与后续里程碑的衔接

| 里程碑 | 主题 | 依赖 M1e 的什么 |
|--------|------|---------------|
| **M2** | 真工具洪水：pdf_reader / wikipedia / youtube_transcript / docExportFeishu / docExportPdf / mapsPlaces / jsRender；同时收 M1c review 推迟的 5 项（web_search planner 约定、replyGen tags、summarizeOutput 分策略、parsePlannerJson 宽松、magiSystemRead `ok` 字段） | 拆模块后的 runApiKey + notice 通道（feishu 401 时 surface）+ LLM provider 抽象（每个工具可指定首选 model） |
| **M3** | browserUse（Stagehand + Playwright + Docker Chromium） | secretBox 版本化（远端浏览器 session token 也要 seal）+ MCP stdio（可考虑把 browser 包成 MCP server） |
| **B 子项目** | 群聊 agent 并发协调 | runExecute 已收敛，加 `topic_locks` 表 + `acquireTopicLock` hook 即可 |

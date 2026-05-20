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
| 1 | `runtime.ts` 拆 5 个模块（lifecycle/execute/reply/apiKey/planGlue） | L | 现 runtime.ts | review 全局 #1 |
| 2 | 统一"用户可感降级 notice"通道（agent_event_logs.kind='user_facing_notice' + mobile 顶部 toast） | M | 新表列 / hook | review 全局 #5 |
| 3 | **Blocker 1+3**：retry 复制 `user_api_key_enc` + per-user key 解密失败 surface | M | task 2 (notice 通道) | review T6 + T3 |
| 4 | **Blocker 2**：retry 路由幂等（窗口去重 + 前端 disable + 409） | S | routes/agent.ts | review T3 |
| 5 | **Blocker 4**：topicSkills 正则放宽（fail-closed → warn-log + 高置信 reject） | S | topicSkills.ts | review T7 |
| 6 | reclaim approval_deny race + reclaim heartbeat step 改名 | S | runtime/execute.ts | review T1 |
| 7 | mobile types optional + AgentStepKind 补齐 + 详情页 push 不 replace + list `hasMore` | S | mobile types/screens | review T2/T4/T9 |
| 8 | MCP `handshakeTimeoutMs` 删字段 + close() 显式 reject pending + abort listener cleanup | S | mcp/stdioTransport.ts | review T8 |
| 9 | secretBox keyId 版本化（base64 头部 1B versionTag）+ 轮换测试 | M | secretBox.ts | review 后续议程 |
| 10 | `listForAgent` 二次 validate + DB 历史 skills lazy scan + README/docs 收尾 | M | topicSkills + 文档 | review T7/T9 |

**预估总工时**：14-18h，task 8/10 可并到同一天，task 1 单独占半天。

### 不在 M1e 范围（推后到 M2 / 单独里程碑）

- ❌ MCP 切官方 `@modelcontextprotocol/sdk`（M2 + browser-use 时一起换，避免双重大改）
- ❌ 任务面板 cursor 分页（hasMore 字段先留接口；真正需要分页时再做）
- ❌ RN EventSource polyfill（M1d 已确认 polling 够用）
- ❌ 多 agent 协作（spec §1.3 已划除非目标）

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
├── runApiKey.ts              # resolveEffectiveApiKey + secretBox glue (内部用)
├── runPlanGlue.ts            # buildInitialPlan（生产 vs 测试环境判定 + LLM planner 调用）
└── runtimeShared.ts          # 共享常量 / 错误类型 / runControllers Map / withTimeout
```

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
- **写入**：新 helper `apps/api/src/lib/agent/notices.ts`：
  ```ts
  export type UserNotice = {
    runId: string;
    severity: 'info' | 'warn' | 'error';
    code: string;   // 'KEY_DECRYPT_FAILED' | 'KEY_FALLBACK_TO_SERVER' | 'RETRY_DEDUPED' | ...
    message: string; // 给用户看的中文
    context?: Record<string, unknown>;
  };
  export async function emitNotice(n: UserNotice): Promise<void>;
  export async function listNoticesForRun(runId: string): Promise<UserNotice[]>;
  ```
- **API**：`GET /api/agent/runs/:id` 响应里加 `notices: UserNotice[]`（最多 20 条，最近的优先）。
- **SSE**：`/runs/:id/stream` 新增 `event: notice` 事件，data 是单条 UserNotice，带 SSE `id` 以便 Last-Event-ID 续传。
- **Mobile**：
  - `AgentRunCard` 顶部增加 notice 行（severity=warn 黄底 ⚠️、error 红底 ❗），点击展开 message + context；
  - notice 不影响 step 列表渲染。

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

- 加 1 字节 versionTag 到 sealed payload 头部：`base64(versionTag(1B) || iv(12B) || tag(16B) || ct)`
- 当前版本 = `0x01`（SHA-256 派生 + AES-256-GCM）
- `openUserApiKey` 先读 versionTag，按 version dispatch decode。version > 0x01 → 抛 `UnknownKeyVersion`，让 caller 走 emitNotice。
- 新增 `AGENT_KEY_SECRET_PREV` env：开 1 次 secret rotation 时，先把老 secret 移到 PREV，新 secret 设 SECRET；open 时按顺序尝试 [SECRET, PREV]，成功即返回。**这才是"轮换不丢历史 key"的正解。**

### 10.2 测试

- `secretBox.test.ts` 加：(a) seal v1 → open v1 round-trip；(b) seal with secret A → 移到 PREV → 设新 SECRET → open 仍成功；(c) 仅 SECRET 改不到 PREV → open 失败 → notice 触发（这条放 Task 3 测试里也行）。

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

## 12. 合并 & tag

```bash
git checkout main
git merge --no-ff feat/agent-runtime-m1e -m "Merge M1e: tech-debt cleanup + architectural prep"
git tag v0.m1e
```

验收清单：
- ✅ 4 个 review blocker 全修
- ✅ runtime.ts 拆完（每文件 ≤ 250 行）
- ✅ 169 → ~190 tests 全绿（每 task 至少 +1 case）
- ✅ `tsc -p apps/{api,mobile}` clean
- ✅ README / spec / `.env.example` 一致

---

## 13. 风险与 fallback

- **Task 1（拆 runtime.ts）是最大风险**：如果拆完测试挂，回退方式 = `git checkout main -- apps/api/src/lib/agent/runtime.ts` 再 rebase，必要时 task 1 单独拉一个 PR 让 reviewer 先 sign-off。
- **Task 2（notice 通道）**：DB 写入失败时绝对不能阻塞 agent run，所有 `emitNotice` 必须 try/catch + console.warn。
- **Task 9（secretBox 版本化）**：要兼容老的"无 version 头部" sealed key —— 检测 base64 长度若是旧格式（无版本字节），按 v0 解码。否则会把 M1d 已 seal 的 key 全部解不开。

---

## 14. 与后续里程碑的衔接

| 里程碑 | 主题 | 依赖 M1e 的什么 |
|--------|------|---------------|
| **M2** | 真工具洪水：pdf_reader / wikipedia / youtube_transcript / docExportFeishu / docExportPdf / mapsPlaces / jsRender | 拆模块后的 runApiKey + notice 通道（feishu 401 时 surface） |
| **M3** | browserUse（Stagehand + Playwright + Docker Chromium） | secretBox 版本化（远端浏览器 session token 也要 seal）+ MCP stdio（可考虑把 browser 包成 MCP server） |
| **B 子项目** | 群聊 agent 并发协调 | runExecute 已收敛，加 `topic_locks` 表 + `acquireTopicLock` hook 即可 |

# Agent Runtime M1b-1 Implementation Plan — 群聊 + TopicSkills

> **本 plan 已根据 `m1b-completion.md`（2026-05-20）修订。**
> 关键变更：补 T7/T12/T13 测试 / 共享 fixture / view+stream 群成员放权 / 路径迁 `/agent/skills`（spec §16 对齐）。
> 估时上调至 **8–12h**。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent_run 在**群聊**里也能跑通（写 invokeMessage + placeholderAi、串联 `llm_invoke_jobs`、任意群成员可取消、群成员可读 run + SSE stream），并把 `topic_skills` 表从"已建未用"接入到 `snapshotForAgent`，HTTP 路径与 spec §16 对齐挂在 `/agent/skills` 下。是后续 M1b-2（approval/steer/critique）和 M1b-3（mobile UI）的依赖底座。

**Architecture:** 复用 M1a 已有的 `runtime.ts / store.ts / messageBridge.ts` 框架。新增 `messageBridge.ts` 的群聊路径（`writeGroupPlaceholder` / `finalizeGroupPlaceholder`），同步写 `llm_invoke_jobs` 的 status，让前端既能通过现有 invoke-job 渠道感知 agent 任务，也能通过 SSE 看实时步骤。`topic_skills` 加 CRUD + integration，让 `snapshotForAgent` 真的从 db 读取而非接收外部传入。

**Tech Stack:** 同 M1a（TS / Hono `streamSSE` / pg ^8.20 / Vitest）+ `pg-intelligence.ts` 的 `createLlmJob / updateLlmJob` 接口。

**前置：** 假设 M1a 分支（`feat/agent-runtime-m1a`）已合并到 `main`，或在它之上拉新分支。

**Spec：** `docs/superpowers/specs/2026-05-20-agent-runtime-design.md` §6.2、§8.2-8.5、§7

---

## File Structure

新建：

```
apps/api/src/lib/agent/topicSkills.ts                  # CRUD: list / upsert / delete

apps/api/src/lib/agent/__tests__/_groupFixture.ts      # 共享:ensureUser/ensureGroup/ensureGroupMember
apps/api/src/lib/agent/__tests__/messageBridge.group.test.ts
apps/api/src/lib/agent/__tests__/contextAdapter.group.test.ts
apps/api/src/lib/agent/__tests__/topicSkills.test.ts
apps/api/src/lib/agent/__tests__/runtime.group.test.ts
apps/api/src/lib/agent/__tests__/skillsRoutes.test.ts  # 含跨 topic 隔离 + 403 测试
apps/api/src/routes/__tests__/agent.routes.test.ts     # T12: 非群成员 cancel/view 403
```

**注意：** 不新建 `routes/topicSkills.ts`。Skills 路由直接挂在 `agentRouter` 下（spec §16 路径 `/agent/skills/*`）。

修改：

```
apps/api/src/lib/agent/messageBridge.ts                # 加 group 路径
apps/api/src/lib/agent/runtime.ts                      # createAgentRun/cancelRun/softComplete 支持 group
apps/api/src/lib/agent/contextAdapter.ts               # topicSkills 从 db 读;删除本地 TopicSkill 类型 import 自 topicSkills.ts
apps/api/src/lib/intentExecute.ts                      # 去掉 AGENT_PRIVATE_ONLY_M1A 保护
apps/api/src/lib/intentRules.ts                        # /agent 在群聊也触发
apps/api/src/routes/agent.ts                           # cancel/view/stream 群成员放权 + 挂 /agent/skills CRUD
README.md                                              # 群聊入口 + skills HTTP 说明
```

---

## Pre-Task: Branch + 基线

- [ ] **Step 0.1**：从 M1a 分支拉新分支

```bash
cd /Users/hongpengwang/行动中止派
git checkout feat/agent-runtime-m1a
git pull --ff-only origin main 2>/dev/null || true   # 若已 merge 到 main
git checkout -b feat/agent-runtime-m1b-1
```

- [ ] **Step 0.2**：基线全套通过

```bash
set -a; source .env; set +a
# 杀掉 dev:api 避免和测试争抢(M1a 同样的教训)
pkill -f "tsx watch.*行动中止派" 2>/dev/null; sleep 2
lsof -ti tcp:3922 2>/dev/null && echo "STILL RUNNING — 找父进程杀掉再继续" && exit 1

npm run build -w @xzz/shared
npm run typecheck
npm run test -w @xzz/shared
npm run test -w @xzz/api
```

Expected：全部 PASS（M1a 收尾时 33/33）。

---

## Task 1: messageBridge.ts 加群聊路径

**Files:**
- Modify: `apps/api/src/lib/agent/messageBridge.ts`

### 1.1 探查现有 group message + llm_invoke_jobs 接口

```bash
grep -n "addGroupMessage\|export async function addGroupMessage" apps/api/src/store/pg-social.ts | head -5
grep -n "export async function createLlmJob\|updateLlmJob" apps/api/src/store/pg-intelligence.ts | head -5
```

读完 `addGroupMessage` 的真实签名和返回类型、`createLlmJob` 的入参 + 返回。重点关注：
- group_messages 是否走 payload 存 content（类比 private_chat_messages）
- llm_invoke_jobs 用 `result_message_id` 关联到最终 AI 消息

### 1.2 添加 group 写入函数

在 `apps/api/src/lib/agent/messageBridge.ts` 末尾追加：

```typescript
import * as social from '../../store/pg-social.js';
import * as intel from '../../store/pg-intelligence.js';

export type GroupPlaceholderResult = {
  invokeMessageId: string;
  placeholderAiMessageId: string;
  llmJobId: string;
};

/**
 * 群聊 agent_run 起跑时:
 * 1) 写一条 `invoke` kind 群消息(承载 user 原文 + agentRunId)
 * 2) 写一条 placeholder `ai` 群消息(内容初始为"[Agent 任务进行中…]")
 * 3) 建 llm_invoke_jobs (status='pending')关联两者
 *
 * 真实接口的 kind/payload 字段名按 store/pg-social.ts 真实情况调整.
 */
export async function writeGroupPlaceholder(params: {
  userId: string;
  groupId: string;
  topicId: string;
  inputText: string;
  agentRunId: string;
}): Promise<GroupPlaceholderResult> {
  const invoke = await social.addGroupMessage({
    userId: params.userId,
    groupId: params.groupId,
    topicId: params.topicId,
    kind: 'invoke',
    content: params.inputText,
    payload: { agentRun: { agentRunId: params.agentRunId, role: 'invoker' } },
  });
  if (!invoke) throw new Error('failed to write group invoke message');

  const placeholder = await social.addGroupMessage({
    userId: params.userId,
    groupId: params.groupId,
    topicId: params.topicId,
    kind: 'ai',
    content: '[Agent 任务进行中…]',
    payload: { agentRun: { agentRunId: params.agentRunId, status: 'draft' } },
  });
  if (!placeholder) throw new Error('failed to write group placeholder');

  const job = await intel.createLlmJob({
    ownerId: params.userId,
    invokerUserId: params.userId,
    groupId: params.groupId,
    topicId: params.topicId,
    payload: { agentRunId: params.agentRunId, kind: 'agent' },
  });

  return {
    invokeMessageId: invoke.id,
    placeholderAiMessageId: placeholder.id,
    llmJobId: job.id,
  };
}

/** 群聊任务终态时同时更新 placeholderAi message 和 llm_invoke_jobs */
export async function finalizeGroupPlaceholder(params: {
  ownerId: string;
  llmJobId: string;
  placeholderAiMessageId: string;
  finalContent: string;
  status: 'completed' | 'failed' | 'cancelled' | 'budget_exhausted';
}): Promise<void> {
  // 1) 更新群 placeholder ai 消息
  await getPool().query(
    `UPDATE group_messages
     SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
       'content', $2::text,
       'agentRun', COALESCE(payload->'agentRun', '{}'::jsonb) || jsonb_build_object('status', $3::text)
     )
     WHERE id = $1`,
    [params.placeholderAiMessageId, params.finalContent, params.status],
  );
  // 2) 更新 llm_invoke_jobs status: agent 'cancelled'/'failed'/'budget_exhausted' 都映射到 'failed';'completed' 映射到 'done'
  const jobStatus =
    params.status === 'completed' ? 'done' : 'failed';
  await intel.updateLlmJob(params.ownerId, params.llmJobId, {
    status: jobStatus as never, // 若 LlmJobStatus union 不含 'failed'/'done',按真实枚举改
    resultMessageId: params.placeholderAiMessageId,
  });
}
```

**关键不确定项**：
- `addGroupMessage` 真实签名可能是 `(userId, groupId, topicId, kind, content, payload?)` 而非对象参数。**按真实改**。
- `group_messages` 表是否有 `payload` 列、`content` 列位置 —— grep schema 确认。如果 content 也在 `payload->>'content'`（类比私聊），上面 SQL 改成同步更新 `payload.content`，不要 SET content。
- `LlmJobStatus` union 真实成员：grep `packages/shared/src/...llm*.ts` 看。如果只有 `pending/done/failed`，那 cancelled/budget_exhausted 都映射到 `failed`，没问题。

### 1.3 typecheck（无单独单元测试 — 测试在 Task 5）

```bash
npm run typecheck
git add apps/api/src/lib/agent/messageBridge.ts
git commit -m "feat(agent): add group placeholder + finalize to message bridge"
```

---

## Task 2: runtime.ts 支持 group channel

**Files:**
- Modify: `apps/api/src/lib/agent/runtime.ts`

### 2.1 改造 createAgentRun

打开 `apps/api/src/lib/agent/runtime.ts`，找到 `createAgentRun` 函数。当前只处理私聊。改成两个分支：

替换 `let userMessageId... if (input.channel === 'private' && input.sessionId)` 这段为：

```typescript
  let userMessageId: string | null = null;
  let placeholderMessageId: string | null = null;
  let llmJobId: string | null = null;

  if (input.channel === 'private' && input.sessionId) {
    const bridge = await writePrivatePlaceholder({
      userId: input.ownerId,
      sessionId: input.sessionId,
      inputText: input.inputText,
      agentRunId: run.id,
    });
    userMessageId = bridge.userMessageId;
    placeholderMessageId = bridge.placeholderMessageId;
    await store.updateAgentRun(run.id, {
      resultMessageId: placeholderMessageId,
    });
  } else if (input.channel === 'group' && input.groupId && input.topicId) {
    const bridge = await writeGroupPlaceholder({
      userId: input.ownerId,
      groupId: input.groupId,
      topicId: input.topicId,
      inputText: input.inputText,
      agentRunId: run.id,
    });
    userMessageId = bridge.invokeMessageId;
    placeholderMessageId = bridge.placeholderAiMessageId;
    llmJobId = bridge.llmJobId;
    await store.updateAgentRun(run.id, {
      invokeMessageId: bridge.invokeMessageId,
      resultMessageId: placeholderMessageId,
    });
  }

  return { run, userMessageId, placeholderMessageId, llmJobId };
```

同时把 `CreateAgentRunResult` 类型加一个字段：

```typescript
export type CreateAgentRunResult = {
  run: AgentRun;
  userMessageId: string | null;
  placeholderMessageId: string | null;
  llmJobId: string | null;   // 新增
};
```

确保顶部 import：

```typescript
import {
  writePrivatePlaceholder,
  finalizePrivatePlaceholder,
  writeGroupPlaceholder,
  finalizeGroupPlaceholder,
} from './messageBridge.js';
```

### 2.2 改造 softComplete

找到 `softComplete` 函数。当前只调 `finalizePrivatePlaceholder`。把那段 if 改为：

```typescript
  if (run.resultMessageId) {
    if (run.channel === 'private') {
      await finalizePrivatePlaceholder({
        messageId: run.resultMessageId,
        finalContent,
        status,
      });
    } else if (run.channel === 'group') {
      // 群聊路径需要 llmJobId,我们存在 invokeMessageId 旁边可以再查
      // 简化:把 llmJobId 也存到 agent_runs.payload 中,或通过 group_messages.payload 反查
      // M1b-1 的简化做法:重新查 group_messages 的 payload 拿 llmJobId
      const { rows } = await getPool().query(
        `SELECT payload->'agentRun'->>'llmJobId' AS job_id
         FROM group_messages WHERE id = $1`,
        [run.resultMessageId],
      );
      const llmJobId = rows[0]?.job_id as string | undefined;
      if (llmJobId) {
        await finalizeGroupPlaceholder({
          ownerId: run.ownerId,
          llmJobId,
          placeholderAiMessageId: run.resultMessageId,
          finalContent,
          status,
        });
      }
    }
  }
```

**等等** —— 上面这种"从 group_messages.payload 反查 llmJobId"依赖 Task 1 把 llmJobId 写进 payload。Task 1 的 `writeGroupPlaceholder` 里 placeholder 的 payload 暂时**没塞 llmJobId**，只塞了 `agentRunId / status`。

**修复**：回到 Task 1 的代码，在 placeholder 的 payload 里也加 `llmJobId`：

```typescript
// Task 1 中, placeholder 部分改成:
payload: {
  agentRun: { agentRunId: params.agentRunId, status: 'draft', llmJobId: job.id },
},
```

但 `job` 是在 placeholder 之后创建的（因为 createLlmJob 拿不到 message id 就能建）。OK 那把 createLlmJob 挪到 invoke + placeholder **之前**或者**之后** UPDATE placeholder.payload 写入 llmJobId。**简洁做法**：先 createLlmJob 拿到 jobId，再写 invoke + placeholder（两个 message 的 payload 里都带 jobId）。

把 Task 1 的 writeGroupPlaceholder 调整：

```typescript
export async function writeGroupPlaceholder(params: {...}): Promise<GroupPlaceholderResult> {
  // 先建 llm job (无 message 关联也可以)
  const job = await intel.createLlmJob({
    ownerId: params.userId,
    invokerUserId: params.userId,
    groupId: params.groupId,
    topicId: params.topicId,
    payload: { agentRunId: params.agentRunId, kind: 'agent' },
  });

  const invoke = await social.addGroupMessage({...
    payload: { agentRun: { agentRunId: params.agentRunId, role: 'invoker', llmJobId: job.id } },
  });
  ...
  const placeholder = await social.addGroupMessage({...
    payload: { agentRun: { agentRunId: params.agentRunId, status: 'draft', llmJobId: job.id } },
  });
  ...

  return { invokeMessageId: invoke.id, placeholderAiMessageId: placeholder.id, llmJobId: job.id };
}
```

回到 Task 2 的 softComplete 反查就能拿到 llmJobId。

### 2.3 改造 cancelRun

找到 `cancelRun` 中的 `if (run.resultMessageId && run.channel === 'private')` 块，类似 softComplete 加 group 分支。或者更干净：直接复用 softComplete 的逻辑。

**最简改法**：在 `cancelRun` 里，把那段 finalize private 替换为：

```typescript
  // 复用与 softComplete 相同的 finalize 路径
  if (run.resultMessageId) {
    if (run.channel === 'private') {
      await finalizePrivatePlaceholder({
        messageId: run.resultMessageId,
        finalContent: '[任务已取消]',
        status: 'cancelled',
      });
    } else if (run.channel === 'group') {
      const { rows } = await getPool().query(
        `SELECT payload->'agentRun'->>'llmJobId' AS job_id
         FROM group_messages WHERE id = $1`,
        [run.resultMessageId],
      );
      const llmJobId = rows[0]?.job_id as string | undefined;
      if (llmJobId) {
        await finalizeGroupPlaceholder({
          ownerId: run.ownerId,
          llmJobId,
          placeholderAiMessageId: run.resultMessageId,
          finalContent: '[任务已取消]',
          status: 'cancelled',
        });
      }
    }
  }
```

确保 `import { getPool } from '../../db/client.js';` 在 runtime.ts 顶部（用于 SQL 反查 jobId）。

### 2.4 typecheck + commit

```bash
npm run typecheck
git add apps/api/src/lib/agent/runtime.ts apps/api/src/lib/agent/messageBridge.ts
git commit -m "feat(agent): runtime supports group channel (placeholder + llm_invoke_jobs)"
```

---

## Task 3: 放开 intentExecute + intentRules 的群聊限制

**Files:**
- Modify: `apps/api/src/lib/intentExecute.ts`
- Modify: `apps/api/src/lib/intentRules.ts`

### 3.1 移除 AGENT_PRIVATE_ONLY_M1A

找到 M1a Task 14 加的 agent_run 分支，替换为支持双通道：

```typescript
  if (input.kind === 'agent_run') {
    const { createAgentRun } = await import('./agent/runtime.js');
    if (input.channel === 'private') {
      if (!input.sessionId) {
        return { type: 'skipped', reason: 'AGENT_PRIVATE_REQUIRES_SESSION' };
      }
      const r = await createAgentRun({
        ownerId: input.userId,
        channel: 'private',
        sessionId: input.sessionId,
        inputText: input.text,
        apiKey: input.deepseekApiKey ?? input.apiKey ?? 'fake',
        apiKeySource: input.deepseekApiKey ? 'user' : 'server',
      });
      return {
        type: 'agent',
        runId: r.run.id,
        userMessageId: r.userMessageId,
        placeholderMessageId: r.placeholderMessageId,
      };
    }
    if (input.channel === 'group') {
      if (!input.groupId || !input.topicId) {
        return { type: 'skipped', reason: 'AGENT_GROUP_REQUIRES_GROUP_TOPIC' };
      }
      const r = await createAgentRun({
        ownerId: input.userId,
        channel: 'group',
        groupId: input.groupId,
        topicId: input.topicId,
        inputText: input.text,
        apiKey: input.deepseekApiKey ?? input.apiKey ?? 'fake',
        apiKeySource: input.deepseekApiKey ? 'user' : 'server',
      });
      return {
        type: 'agent',
        runId: r.run.id,
        userMessageId: r.userMessageId,
        placeholderMessageId: r.placeholderMessageId,
      };
    }
    return { type: 'skipped', reason: 'AGENT_UNSUPPORTED_CHANNEL' };
  }
```

注意 `input` 字段（`groupId / topicId`）要确认在 IntentExecuteInput 类型里存在。grep：

```bash
grep -n "groupId\|topicId" apps/api/src/lib/intentExecute.ts | head -10
grep -n "export type IntentExecuteInput\|export interface IntentExecuteInput" packages/shared/src/social.ts apps/api/src/lib/intentExecute.ts 2>/dev/null
```

如果字段不存在，按 IntentExecuteInput 真实类型改名。

### 3.2 intentRules: /agent 在群聊也命中

找到 M1a Task 13 加的 `agent` slash entry。当前 `kind: 'agent_run'` 已经独立于 channel，所以**理论上群聊也命中**。但要看 second candidate `chatKind(ctx.channel)`，确认群聊场景 fallback 是 `chat_group_llm`。

加一条新测试到 `apps/api/src/lib/__tests__/intentRules.agent.test.ts`：

```typescript
it('/agent triggers agent_run in group channel too', () => {
  const r = buildCandidatesFromRules({
    text: '/agent 帮我研究一下',
    channel: 'group',
  });
  expect(r.candidates[0].kind).toBe('agent_run');
  expect(r.matchedRuleIds).toContain('slash_agent');
});
```

跑确认 PASS（应该已经 PASS，因为 slash 命中不区分 channel）：

```bash
npm run test -w @xzz/api -- src/lib/__tests__/intentRules.agent.test.ts
```

### 3.3 commit

```bash
git add apps/api/src/lib/intentExecute.ts apps/api/src/lib/__tests__/intentRules.agent.test.ts
git commit -m "feat(intent): support agent_run in group channel"
```

---

## Task 4: routes/agent.ts cancel + view + stream 放权给群成员（T12）

**Files:**
- Modify: `apps/api/src/routes/agent.ts`

### 4.1 抽 helper `assertCanAccessRun(run, userId): Promise<boolean>`

私聊：`run.ownerId === userId`；群聊：`run.ownerId === userId || isGroupMember(userId, run.groupId)`。三处 handler（`GET /:id`、`GET /:id/stream`、`POST /:id/cancel`）共享调用。**M1b-3 mobile 在群聊里能打开 AgentRunCard 不 403 全靠这个。**

先 grep 找现成 helper：

```bash
grep -rn "isGroupMember\|getGroupMember" apps/api/src/lib apps/api/src/store 2>/dev/null | head
```

在 `routes/agent.ts` 顶部加（如 `isGroupMember` 不存在则内联 SQL）：

```typescript
async function canAccessRun(run: AgentRun, userId: string): Promise<boolean> {
  if (run.ownerId === userId) return true;
  if (run.channel === 'group' && run.groupId) {
    const { rows } = await getPool().query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
      [run.groupId, userId],
    );
    return rows.length > 0;
  }
  return false;
}
```

把 `/runs/:id`、`/runs/:id/stream`、`/runs/:id/cancel` 三个 handler 里的鉴权全部统一为：

```typescript
const run = await store.getAgentRun(id);
if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
if (!(await canAccessRun(run, userId))) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
```

### 4.2 新建 `routes/__tests__/agent.routes.test.ts`（T12）

最少三个 case：
- 群聊 run owner 调 `POST /api/agent/runs/:id/cancel` → 200
- 群聊 run 非 owner **但是成员** 调 cancel → 200
- 群聊 run **非成员** 调 cancel → 403（同样 case 复用到 `GET /:id` 和 `/stream` 上）

测试需起 hono `app` 实例 + 模拟 jwt（参考既有 routes 测试模式，grep `apps/api/src/routes/__tests__` 看现有写法；若不存在 routes 测试基础设施，则用直接调用 handler 的 supertest 方式，或在 e2e 里覆盖）。

**最低保底方案：** 如果 route 测试基础设施缺失，**至少**在 `runtime.group.test.ts` 里加一个 case：非成员调用 `cancelRun(runId, otherUserId)` —— 这不测路由层鉴权，要在 store 层加 `assertCancelAuth` 助记，或直接调用 `canAccessRun` 校验。

### 4.3 typecheck + commit

```bash
npm run typecheck
npm run test -w @xzz/api -- src/routes/__tests__/agent.routes.test.ts
git add apps/api/src/routes/agent.ts apps/api/src/routes/__tests__/agent.routes.test.ts
git commit -m "feat(api): group members can cancel/view/stream agent runs (T12)"
```

---

## Task 5: 共享 group fixture + messageBridge 集成测试（T8）

**Files:**
- Create: `apps/api/src/lib/agent/__tests__/_groupFixture.ts`
- Create: `apps/api/src/lib/agent/__tests__/messageBridge.group.test.ts`

### 5.0 抽 fixture（强制；Tasks 5/6/10 + 路由测试都引用）

```typescript
// _groupFixture.ts
import { randomUUID } from 'crypto';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

export async function ensureUser(displayName: string) {
  return createUser({
    username: displayName + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName,
  });
}

export async function ensureGroup(ownerId: string): Promise<{ groupId: string; topicId: string }> {
  const { createGroup, createTopic, addGroupMember } = await import('../../../store/pg-social.js');
  const group = await createGroup({ ownerId, name: 'tg-' + randomUUID().slice(0, 4) });
  await addGroupMember({ groupId: group.id, userId: ownerId, role: 'owner' });
  const topic = await createTopic({ groupId: group.id, name: 'topic-1', createdByUserId: ownerId });
  return { groupId: group.id, topicId: topic.id };
}

export async function addMember(groupId: string, userId: string, role: 'member' | 'admin' = 'member') {
  const { addGroupMember } = await import('../../../store/pg-social.js');
  await addGroupMember({ groupId, userId, role });
}
```

签名按 store/pg-social.ts 真实接口调（grep 一次）。

### 5.1 写测试

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import {
  writeGroupPlaceholder,
  finalizeGroupPlaceholder,
} from '../messageBridge.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

async function ensureGroup(ownerId: string): Promise<{ groupId: string; topicId: string }> {
  // 真实创建群 + topic 的接口名按 store/pg-social.ts grep 确认
  const { createGroup, createTopic, addGroupMember } = await import('../../../store/pg-social.js');
  const group = await createGroup({ ownerId, name: 'tg-' + randomUUID().slice(0, 4) });
  await addGroupMember({ groupId: group.id, userId: ownerId, role: 'owner' });
  const topic = await createTopic({ groupId: group.id, name: 'topic-1', createdByUserId: ownerId });
  return { groupId: group.id, topicId: topic.id };
}

describe('messageBridge group placeholder', () => {
  beforeAll(async () => await runMigrations());

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    await getPool().query('DELETE FROM llm_invoke_jobs');
  });

  it('writes invoke + placeholderAi + llm job', async () => {
    const u = await ensureUser('mb-g');
    const { groupId, topicId } = await ensureGroup(u.id);
    const r = await writeGroupPlaceholder({
      userId: u.id,
      groupId,
      topicId,
      inputText: '帮我跑三步 echo',
      agentRunId: randomUUID(),
    });

    expect(r.invokeMessageId).toBeDefined();
    expect(r.placeholderAiMessageId).toBeDefined();
    expect(r.llmJobId).toBeDefined();

    // 验证 placeholder.payload 含 agentRun + llmJobId
    const { rows } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`,
      [r.placeholderAiMessageId],
    );
    expect(rows[0].payload?.agentRun?.llmJobId).toBe(r.llmJobId);

    // 验证 llm_invoke_jobs status='pending'
    const { rows: jobRows } = await getPool().query(
      `SELECT status FROM llm_invoke_jobs WHERE id = $1`,
      [r.llmJobId],
    );
    expect(jobRows[0].status).toBe('pending');
  });

  it('finalize sets ai content + llm job done', async () => {
    const u = await ensureUser('mb-fin');
    const { groupId, topicId } = await ensureGroup(u.id);
    const r = await writeGroupPlaceholder({
      userId: u.id, groupId, topicId,
      inputText: 'x', agentRunId: randomUUID(),
    });
    await finalizeGroupPlaceholder({
      ownerId: u.id,
      llmJobId: r.llmJobId,
      placeholderAiMessageId: r.placeholderAiMessageId,
      finalContent: '已完成 3 步 echo',
      status: 'completed',
    });
    const { rows } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`,
      [r.placeholderAiMessageId],
    );
    expect(rows[0].payload?.content).toBe('已完成 3 步 echo');
    expect(rows[0].payload?.agentRun?.status).toBe('completed');

    const { rows: jr } = await getPool().query(
      `SELECT status FROM llm_invoke_jobs WHERE id = $1`,
      [r.llmJobId],
    );
    expect(jr[0].status).toBe('done');
  });

  it('finalize with cancelled maps llm job to failed', async () => {
    const u = await ensureUser('mb-cxl');
    const { groupId, topicId } = await ensureGroup(u.id);
    const r = await writeGroupPlaceholder({
      userId: u.id, groupId, topicId, inputText: 'x',
      agentRunId: randomUUID(),
    });
    await finalizeGroupPlaceholder({
      ownerId: u.id,
      llmJobId: r.llmJobId,
      placeholderAiMessageId: r.placeholderAiMessageId,
      finalContent: '[任务已取消]',
      status: 'cancelled',
    });
    const { rows: jr } = await getPool().query(
      `SELECT status FROM llm_invoke_jobs WHERE id = $1`,
      [r.llmJobId],
    );
    expect(jr[0].status).toBe('failed');
  });
});
```

### 5.2 跑 + commit

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/messageBridge.group.test.ts
git add apps/api/src/lib/agent/__tests__/messageBridge.group.test.ts
git commit -m "test(agent): group message bridge integration tests (T8)"
```

如果 `createGroup / createTopic / addGroupMember` 签名不同，按真实改。如果某些群创建接口太复杂，可以直接 SQL INSERT 跳过 helper：

```typescript
const groupId = randomUUID();
await getPool().query(
  `INSERT INTO groups (id, name, owner_id) VALUES ($1, $2, $3)`,
  [groupId, 'tg-' + groupId.slice(0,4), ownerId],
);
// 同样手写 group_members + topics INSERT
```

---

## Task 6: contextAdapter 群聊路径测试（T7）

**Files:**
- Create: `apps/api/src/lib/agent/__tests__/contextAdapter.group.test.ts`

### 6.0 必须覆盖的 3 个 case（T7 验收）

1. **成员名前缀**：插入 2 条 group_messages（不同 user），调 `snapshotForAgent`，断言 `snap.history` 里每条 content 含发言人 displayName 前缀（参 `contextAdapter.ts` L119-126 实现细节，grep 真实格式 `[xx]` / `xx:` / `<xx>` 等）。
2. **topicSkills 注入**（enabled=true）：system prompt 含 `<topic_skills>` 块 + skill 内容。
3. **topicSkills 不注入**（enabled=false 或 disabled）：system prompt 不含 `<topic_skills>`。

### 6.1 写测试（snapshot 含成员前缀 + topicSkills 标签）

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { snapshotForAgent } from '../contextAdapter.js';
import { ensureUser, ensureGroup, addMember } from './_groupFixture.js';

describe('snapshotForAgent group', () => {
  beforeAll(async () => await runMigrations());

  it('produces system prompt + topicSkills section', async () => {
    const u = await createUser({
      username: 'ctx-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: '张三',
    });
    const { groupId, topicId } = await ensureGroup(u.id);
    const snap = await snapshotForAgent({
      runId: randomUUID(),
      userId: u.id,
      channel: 'group',
      groupId,
      topicId,
      pendingUser: '帮我研究家族信托',
      apiKey: 'fake',
      topicSkills: [
        {
          id: 'sk1', scope: 'topic', ownerId: null, groupId, topicId,
          title: '聊家族财富',
          content: '不讨论投机,聚焦税务和传承',
          enabled: true,
        },
      ],
    });

    expect(snap.source.channel).toBe('group');
    expect(snap.systemPrompt).toContain('topic_skills');
    expect(snap.systemPrompt).toContain('聊家族财富');
    expect(snap.systemPrompt).toContain('不讨论投机');
  });

  it('topicSkills disabled => not included', async () => {
    const u = await ensureUser('李四');
    const { groupId, topicId } = await ensureGroup(u.id);
    const snap = await snapshotForAgent({
      runId: randomUUID(), userId: u.id, channel: 'group', groupId, topicId,
      pendingUser: 'x', apiKey: 'fake',
      topicSkills: [
        { id: 'sk1', scope: 'topic', ownerId: null, groupId, topicId,
          title: 'X', content: 'Y', enabled: false },
      ],
    });
    expect(snap.systemPrompt).not.toContain('topic_skills');
  });

  it('group history carries member displayName prefix (T7 must-have)', async () => {
    const alice = await ensureUser('Alice');
    const bob = await ensureUser('Bob');
    const { groupId, topicId } = await ensureGroup(alice.id);
    await addMember(groupId, bob.id);

    const { addGroupMessage } = await import('../../../store/pg-social.js');
    await addGroupMessage({
      userId: alice.id, groupId, topicId,
      kind: 'user', content: '我先说一句',
    });
    await addGroupMessage({
      userId: bob.id, groupId, topicId,
      kind: 'user', content: '我也插一嘴',
    });

    const snap = await snapshotForAgent({
      runId: randomUUID(),
      userId: alice.id,
      channel: 'group',
      groupId, topicId,
      pendingUser: '继续吗', apiKey: 'fake',
      topicSkills: [],
    });

    // history 中应能看到 'Alice' 与 'Bob' 的 displayName(无论前缀格式具体是 [Alice] 还是 Alice: 还是其他)
    const hasAlice = snap.history.some((m) => String(m.content).includes('Alice'));
    const hasBob = snap.history.some((m) => String(m.content).includes('Bob'));
    expect(hasAlice).toBe(true);
    expect(hasBob).toBe(true);
  });
});
```

### 6.2 commit

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/contextAdapter.group.test.ts
git add apps/api/src/lib/agent/__tests__/contextAdapter.group.test.ts
git commit -m "test(agent): context adapter group path (T7)"
```

---

## Task 7: topic_skills CRUD store

**Files:**
- Create: `apps/api/src/lib/agent/topicSkills.ts`
- Create: `apps/api/src/lib/agent/__tests__/topicSkills.test.ts`

### 7.1 写失败测试

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import * as topicSkills from '../topicSkills.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';

describe('topicSkills CRUD', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM topic_skills');
  });

  it('creates user-scope skill', async () => {
    const u = await ensureUser('ts');
    const s = await topicSkills.upsertSkill({
      scope: 'user',
      ownerId: u.id,
      groupId: null,
      topicId: null,
      title: '我喜欢公正客观',
      content: '回答时少用表情',
      enabled: true,
      updatedByUserId: u.id,
    });
    expect(s.id).toBeDefined();
    expect(s.scope).toBe('user');
  });

  it('listForAgent merges user + group + topic scopes', async () => {
    const u = await ensureUser('ts2');
    const groupId = randomUUID();
    const topicId = randomUUID();
    // user-scope
    await topicSkills.upsertSkill({
      scope: 'user', ownerId: u.id, groupId: null, topicId: null,
      title: 'user-rule', content: 'A', enabled: true, updatedByUserId: u.id,
    });
    // group-scope (绑定 owner = same user, 简化用)
    await topicSkills.upsertSkill({
      scope: 'group', ownerId: u.id, groupId, topicId: null,
      title: 'group-rule', content: 'B', enabled: true, updatedByUserId: u.id,
    });
    // topic-scope
    await topicSkills.upsertSkill({
      scope: 'topic', ownerId: u.id, groupId, topicId,
      title: 'topic-rule', content: 'C', enabled: true, updatedByUserId: u.id,
    });

    const skills = await topicSkills.listForAgent({
      userId: u.id, groupId, topicId,
    });
    const titles = skills.map((s) => s.title);
    expect(titles).toEqual(expect.arrayContaining(['user-rule', 'group-rule', 'topic-rule']));
    // 只返回 enabled
    const allEnabled = skills.every((s) => s.enabled);
    expect(allEnabled).toBe(true);
  });

  it('disabled skill not returned by listForAgent', async () => {
    const u = await ensureUser('ts3');
    await topicSkills.upsertSkill({
      scope: 'user', ownerId: u.id, groupId: null, topicId: null,
      title: 'off', content: 'x', enabled: false, updatedByUserId: u.id,
    });
    const skills = await topicSkills.listForAgent({ userId: u.id });
    expect(skills.length).toBe(0);
  });

  it('delete removes the skill', async () => {
    const u = await ensureUser('ts4');
    const s = await topicSkills.upsertSkill({
      scope: 'user', ownerId: u.id, groupId: null, topicId: null,
      title: 'rm', content: 'x', enabled: true, updatedByUserId: u.id,
    });
    await topicSkills.deleteSkill(s.id, u.id);
    const skills = await topicSkills.listForAgent({ userId: u.id });
    expect(skills.find((x) => x.id === s.id)).toBeUndefined();
  });

  it('T13: topic-scope skills are isolated across topics', async () => {
    const u = await ensureUser('ts-iso');
    const { groupId, topicId: tA } = await ensureGroup(u.id);
    // 给同一个 group 再建一个 topic B
    const { createTopic } = await import('../../../store/pg-social.js');
    const tB = (await createTopic({ groupId, name: 'topic-B', createdByUserId: u.id })).id;
    await topicSkills.upsertSkill({
      scope: 'topic', ownerId: u.id, groupId, topicId: tA,
      title: 'A-only', content: 'A-rule', enabled: true, updatedByUserId: u.id,
    });
    const listB = await topicSkills.listForAgent({ userId: u.id, groupId, topicId: tB });
    expect(listB.find((x) => x.title === 'A-only')).toBeUndefined();
    const listA = await topicSkills.listForAgent({ userId: u.id, groupId, topicId: tA });
    expect(listA.find((x) => x.title === 'A-only')).toBeDefined();
  });
});
```

跑确认 FAIL：
```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/topicSkills.test.ts
```

### 7.2 实现 topicSkills.ts

```typescript
import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';

export type TopicSkillScope = 'topic' | 'user' | 'group';

export type TopicSkill = {
  id: string;
  scope: TopicSkillScope;
  ownerId: string | null;
  groupId: string | null;
  topicId: string | null;
  title: string;
  content: string;
  enabled: boolean;
  updatedByUserId: string;
  updatedAt: Date;
};

function parseRow(row: Record<string, unknown>): TopicSkill {
  return {
    id: row.id as string,
    scope: row.scope as TopicSkillScope,
    ownerId: (row.owner_id as string | null) ?? null,
    groupId: (row.group_id as string | null) ?? null,
    topicId: (row.topic_id as string | null) ?? null,
    title: row.title as string,
    content: row.content as string,
    enabled: row.enabled as boolean,
    updatedByUserId: row.updated_by_user_id as string,
    updatedAt: row.updated_at as Date,
  };
}

const COLS = `id, scope, owner_id, group_id, topic_id, title, content,
  enabled, updated_by_user_id, updated_at`;

export type UpsertSkillInput = {
  id?: string;
  scope: TopicSkillScope;
  ownerId: string | null;
  groupId: string | null;
  topicId: string | null;
  title: string;
  content: string;
  enabled: boolean;
  updatedByUserId: string;
};

export async function upsertSkill(input: UpsertSkillInput): Promise<TopicSkill> {
  const id = input.id ?? randomUUID();
  const { rows } = await getPool().query(
    `INSERT INTO topic_skills (id, scope, owner_id, group_id, topic_id,
       title, content, enabled, updated_by_user_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       enabled = EXCLUDED.enabled,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = now()
     RETURNING ${COLS}`,
    [
      id, input.scope, input.ownerId, input.groupId, input.topicId,
      input.title, input.content, input.enabled, input.updatedByUserId,
    ],
  );
  return parseRow(rows[0]);
}

export async function deleteSkill(id: string, byUserId: string): Promise<void> {
  // M1b 简化:不做精细授权,谁建谁删
  await getPool().query(
    `DELETE FROM topic_skills WHERE id = $1 AND (updated_by_user_id = $2 OR owner_id = $2)`,
    [id, byUserId],
  );
}

/**
 * 列 agent run 应当应用的所有 skills(合并 user-scope + group-scope + topic-scope, enabled=true).
 *
 * scope 含义:
 * - user: 个人偏好,跟随 userId
 * - group: 群规,跟随 groupId
 * - topic: 话题规则,跟随 topicId
 */
export async function listForAgent(params: {
  userId: string;
  groupId?: string;
  topicId?: string;
}): Promise<TopicSkill[]> {
  const conditions: string[] = [`enabled = TRUE`];
  const values: unknown[] = [];
  // user-scope: owner_id = userId
  conditions.push(
    `(scope = 'user' AND owner_id = $${values.push(params.userId)})`,
  );
  // group-scope: group_id = ? (任意 owner)
  if (params.groupId) {
    conditions.push(
      `(scope = 'group' AND group_id = $${values.push(params.groupId)})`,
    );
  }
  // topic-scope: topic_id = ?
  if (params.topicId) {
    conditions.push(
      `(scope = 'topic' AND topic_id = $${values.push(params.topicId)})`,
    );
  }

  const where = `enabled = TRUE AND (${conditions.slice(1).join(' OR ')})`;
  const { rows } = await getPool().query(
    `SELECT ${COLS} FROM topic_skills WHERE ${where} ORDER BY updated_at DESC`,
    values,
  );
  return rows.map(parseRow);
}

export async function getSkill(id: string): Promise<TopicSkill | null> {
  const { rows } = await getPool().query(
    `SELECT ${COLS} FROM topic_skills WHERE id = $1`,
    [id],
  );
  return rows[0] ? parseRow(rows[0]) : null;
}

export async function listOwnSkills(userId: string): Promise<TopicSkill[]> {
  const { rows } = await getPool().query(
    `SELECT ${COLS} FROM topic_skills
     WHERE owner_id = $1 OR updated_by_user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(parseRow);
}
```

### 7.3 跑测试 + commit

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/topicSkills.test.ts
git add apps/api/src/lib/agent/topicSkills.ts apps/api/src/lib/agent/__tests__/topicSkills.test.ts
git commit -m "feat(agent): add topic skills CRUD"
```

---

## Task 8: contextAdapter 真接 topicSkills + 类型消重

**Files:**
- Modify: `apps/api/src/lib/agent/contextAdapter.ts`
- Modify: `apps/api/src/lib/agent/__tests__/contextAdapter.group.test.ts`（补集成测）

### 8.0 删除本地 TopicSkill 类型，统一从 topicSkills.ts import

打开 `contextAdapter.ts`，搜 `type TopicSkill` 或 `interface TopicSkill`。如果有本地定义：
- 删本地定义
- 顶部 `import type { TopicSkill } from './topicSkills.js';`

避免两份相似定义漂移。

### 8.1 改 SnapshotForAgentParams：topicSkills 变可选

打开 contextAdapter.ts，找 `SnapshotForAgentParams`。`topicSkills` 现在是必传外部传入，改为可选 — 默认从 db 读：

```typescript
export type SnapshotForAgentParams = {
  runId: string;
  userId: string;
  channel: 'private' | 'group';
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  pendingUser: string;
  apiKey: string;
  topicSkills?: TopicSkill[];   // 可选;不传则从 db 拉
  dialect?: ReplyDialect;
};
```

在 `snapshotForAgent` 函数体开头加：

```typescript
const skills =
  params.topicSkills ??
  (await (async () => {
    const { listForAgent } = await import('./topicSkills.js');
    return listForAgent({
      userId: params.userId,
      groupId: params.groupId,
      topicId: params.topicId,
    });
  })());
```

然后把所有 `params.topicSkills` 的引用都改成 `skills`。

### 8.2 在 contextAdapter.group.test.ts 加 db-pull 集成测

```typescript
it('snapshotForAgent without topicSkills param reads from db', async () => {
  const u = await ensureUser('db-pull');
  const { groupId, topicId } = await ensureGroup(u.id);
  const ts = await import('../topicSkills.js');
  await ts.upsertSkill({
    scope: 'topic', ownerId: u.id, groupId, topicId,
    title: '从-db-读', content: 'db-content', enabled: true,
    updatedByUserId: u.id,
  });
  const snap = await snapshotForAgent({
    runId: randomUUID(), userId: u.id, channel: 'group', groupId, topicId,
    pendingUser: 'x', apiKey: 'fake',
    // 注意:不传 topicSkills
  });
  expect(snap.systemPrompt).toContain('从-db-读');
});
```

### 8.3 typecheck + commit

```bash
npm run typecheck
npm run test -w @xzz/api -- src/lib/agent/__tests__/contextAdapter.group.test.ts
git add apps/api/src/lib/agent/contextAdapter.ts apps/api/src/lib/agent/__tests__/contextAdapter.group.test.ts
git commit -m "feat(agent): snapshotForAgent reads topicSkills from db; dedupe TopicSkill type"
```

---

## Task 9: 在 agentRouter 下挂 /agent/skills CRUD（spec §16 对齐）

**Files:**
- Modify: `apps/api/src/routes/agent.ts`
- Create: `apps/api/src/lib/agent/__tests__/skillsRoutes.test.ts`

**关键：** 不要新建 `routes/topicSkills.ts`。spec §16 路径是 `/agent/skills`，直接挂在已有 `agentRouter` 下。

### 9.1 路由（追加到 routes/agent.ts 现有路由之后）

```typescript
// 在 routes/agent.ts 顶部已有 import 旁追加:
import * as topicSkills from '../lib/agent/topicSkills.js';

// 在文件末尾 export 之前追加:
agentRouter.get('/skills', async (c) => {
  const userId = c.get('userId')!;
  const own = await topicSkills.listOwnSkills(userId);
  return c.json({ ok: true, data: own, requestId: c.get('requestId') });
});

agentRouter.get('/skills/for-agent', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.query('groupId') || undefined;
  const topicId = c.req.query('topicId') || undefined;
  const skills = await topicSkills.listForAgent({ userId, groupId, topicId });
  return c.json({ ok: true, data: skills, requestId: c.get('requestId') });
});

agentRouter.post('/skills', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    id?: string;
    scope: 'topic' | 'user' | 'group';
    groupId?: string;
    topicId?: string;
    title: string;
    content: string;
    enabled?: boolean;
  }>();
  if (!body.title || !body.content) {
    return jsonError(c, ErrorCodes.BAD_REQUEST, 400);
  }
  // 简单 scope 校验
  if (body.scope === 'group' && !body.groupId) {
    return jsonError(c, ErrorCodes.BAD_REQUEST, 400);
  }
  if (body.scope === 'topic' && (!body.groupId || !body.topicId)) {
    return jsonError(c, ErrorCodes.BAD_REQUEST, 400);
  }
  const ownerId =
    body.scope === 'user' ? userId :
    body.scope === 'group' ? userId :  // 群规也归属个人,M1b 暂不做群级共享
    userId;
  const skill = await topicSkills.upsertSkill({
    id: body.id,
    scope: body.scope,
    ownerId,
    groupId: body.groupId ?? null,
    topicId: body.topicId ?? null,
    title: body.title,
    content: body.content,
    enabled: body.enabled ?? true,
    updatedByUserId: userId,
  });
  return c.json({ ok: true, data: skill, requestId: c.get('requestId') });
});

agentRouter.delete('/skills/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const existing = await topicSkills.getSkill(id);
  if (!existing) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (existing.updatedByUserId !== userId && existing.ownerId !== userId) {
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  }
  await topicSkills.deleteSkill(id, userId);
  return c.json({ ok: true, requestId: c.get('requestId') });
});
```

注意：`ErrorCodes.BAD_REQUEST` 若不存在，grep 现有 code 用最接近的（如 `INVALID_INPUT`）。

### 9.2 不动 index.ts

路由已在 `agentRouter` 下，复用现有 `app.route('/api/agent', agentRouter)` 挂载点。完整 URL：
- `GET    /api/agent/skills`
- `GET    /api/agent/skills/for-agent?groupId=&topicId=`
- `POST   /api/agent/skills`
- `DELETE /api/agent/skills/:id`

### 9.3 skillsRoutes.test.ts（最少 2 case，含跨 topic 隔离 + delete 403）

```typescript
// 同 routes 测试基础设施(若不存在,先 grep apps/api/src/routes/__tests__ 模板)
// case 1: POST /api/agent/skills 创建 topic-scope skill → 200
// case 2: 用户 A 不能 delete 用户 B 的 skill → 403
// case 3: GET /skills/for-agent?topicId=B 不返回 topicId=A 的 skill
```

### 9.4 typecheck + commit

```bash
npm run typecheck
npm run test -w @xzz/api -- src/lib/agent/__tests__/skillsRoutes.test.ts
git add apps/api/src/routes/agent.ts apps/api/src/lib/agent/__tests__/skillsRoutes.test.ts
git commit -m "feat(api): /agent/skills CRUD on agentRouter (spec §16)"
```

---

## Task 10: 端到端 group runtime 测试

**Files:**
- Create: `apps/api/src/lib/agent/__tests__/runtime.group.test.ts`

### 10.1 写测试

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { createAgentRun, executeRun, cancelRun } from '../runtime.js';
import { getAgentRun, listSteps } from '../store.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

async function ensureGroup(ownerId: string) {
  // 同 Task 5 的实现
  /* ... */
}

describe('agent runtime group e2e', () => {
  beforeAll(async () => {
    await runMigrations();
    registerEchoSleep();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    await getPool().query('DELETE FROM llm_invoke_jobs');
  });

  it('completes a 3-step echo in group channel', async () => {
    const u = await ensureUser('ge2e');
    const { groupId, topicId } = await ensureGroup(u.id);
    const { run, llmJobId } = await createAgentRun({
      ownerId: u.id,
      channel: 'group',
      groupId,
      topicId,
      inputText: '跑三步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    expect(run.status).toBe('draft');
    expect(llmJobId).toBeDefined();

    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('completed');
    const steps = await listSteps(run.id);
    expect(steps.filter((s) => s.kind === 'tool_call').length).toBe(3);

    // llm_invoke_jobs 应被 finalize 到 done
    const { rows } = await getPool().query(
      `SELECT status FROM llm_invoke_jobs WHERE id = $1`,
      [llmJobId!],
    );
    expect(rows[0].status).toBe('done');

    // placeholder ai message 应有更新后的 content
    const { rows: pr } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`,
      [after!.resultMessageId!],
    );
    expect(pr[0].payload?.content).toContain('完成 3 步');
  });

  it('group cancel by any member updates job to failed', async () => {
    const owner = await ensureUser('go');
    const other = await ensureUser('go-other');
    const { groupId, topicId } = await ensureGroup(owner.id);
    // 把 other 也加入群
    const { addGroupMember } = await import('../../../store/pg-social.js');
    await addGroupMember({ groupId, userId: other.id, role: 'member' });

    const { run, llmJobId } = await createAgentRun({
      ownerId: owner.id,
      channel: 'group',
      groupId,
      topicId,
      inputText: '跑 5 步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const exec = executeRun(run.id);
    await new Promise((r) => setTimeout(r, 600));
    // other 来取消
    await cancelRun(run.id, other.id);
    await exec;
    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.cancelledByUserId).toBe(other.id);

    const { rows } = await getPool().query(
      `SELECT status FROM llm_invoke_jobs WHERE id = $1`,
      [llmJobId!],
    );
    expect(rows[0].status).toBe('failed');
  });
});
```

### 10.2 跑 + commit

```bash
set -a; source .env; set +a
npm run test -w @xzz/api -- src/lib/agent/__tests__/runtime.group.test.ts
git add apps/api/src/lib/agent/__tests__/runtime.group.test.ts
git commit -m "test(agent): group runtime e2e (cancel by any member)"
```

可能问题：
- 如果 `cancelRun` 内部用了 `ownerId` 校验：M1a 时 `cancelRun(runId, byUserId)` 只把 `byUserId` 存进 `cancelledByUserId`，不校验权限（权限在 route 层）。所以 cancelRun 直接被 `other` 调用应该 OK。
- 如果群聊 placeholderAi 的 content 写入位置（content 列 / payload.content）和你 Task 1 写的不一致，调整 SQL 或 finalize 写法保持一致。

---

## Task 11: 全量验证

```bash
set -a; source .env; set +a
# 确保没有 dev:api 在跑
pkill -f "tsx watch.*行动中止派" 2>/dev/null; sleep 2

npm run build -w @xzz/shared
npm run typecheck
npm run test -w @xzz/shared
npm run test -w @xzz/api
```

Expected：所有测试 PASS。新增 5 个测试文件，应该多出 ~15-20 个测试用例。

---

## Task 12: README + 最终 commit

```markdown
## Agent Runtime M1b-1（群聊 + TopicSkills）

在 M1a 基础上：

- 群聊里也能用 `/agent ...`，会写 invoke message + placeholder ai message + llm_invoke_jobs（前端通过现有 invoke-job 渠道感知）
- 任意群成员都能取消正在跑的 agent_run
- `topic_skills` 表激活：
  - `POST /api/topic-skills` 增/改（按 id upsert）
  - `GET /api/topic-skills` 列自己的
  - `GET /api/topic-skills/for-agent?groupId=&topicId=` 列某 agent run 用到的
  - `DELETE /api/topic-skills/:id`
- `snapshotForAgent` 默认从 db 拉 topic_skills 注入 system prompt

测试：
- `messageBridge.group.test.ts`（T8）
- `contextAdapter.group.test.ts`（T7）
- `topicSkills.test.ts`
- `runtime.group.test.ts`（群 e2e + 跨成员取消）
- `intentRules.agent.test.ts` 加群聊 case
```

```bash
git add README.md
git commit -m "docs: M1b-1 group + topicSkills entry points"
```

---

## 验收清单（对照 Spec §18.2 + §19 + m1b-completion §1）

- [ ] **AC1**（群聊 /agent 跑通）— Tasks 1+2+3+5+10
- [ ] **AC2**（群聊任意成员可 cancel + 非成员 403）— Tasks 4+10
- [ ] **AC5**（topicSkills 注入 system prompt + 跨 topic 隔离）— Tasks 6+7+8+9

测试矩阵：
- [ ] **T7**（Context Adapter 群聊 + 成员名前缀） — Task 6
- [ ] **T8**（Message Bridge 群聊） — Task 5
- [ ] **T12**（Cancel/view 鉴权，非成员 403） — Task 4
- [ ] **T13**（Topic Skills 跨 topic 隔离） — Tasks 7+9

不在本 plan 范围：
- AC3/AC4/AC6 → M1b-2
- AC7（mobile） → M1b-3
- T4 → M1b-2、T11 → M1b-2
- T5（heartbeat reclaim） → M1d hardening
- T16（SSE 断线重连） → M1d hardening

---

## 修订记录

**2026-05-20 v2**（response to review）：
- 加 Task 5.0 共享 fixture `_groupFixture.ts`
- 加 Task 6 成员名前缀断言（T7 must-have）
- 加 Task 7 跨 topic 隔离测试（T13）
- 加 Task 8.0 删除 contextAdapter 本地 TopicSkill 类型
- 加 Task 8.2 db-pull 集成测
- 改 Task 4 cancel/view/stream 三 handler 统一 `canAccessRun`（含 T12 测试）
- **路径变更**：`/api/topic-skills/*` → `/api/agent/skills/*`（spec §16 对齐）
- 估时 6h → **8–12h**

---

## Self-Review

**Spec 覆盖**：M1b-1 范围内的 AC1/AC2/AC5 + T7/T8 都有任务对应。

**Placeholder 扫描**：所有 step 含具体代码 / SQL / 命令。`ensureGroup` helper 在 Tasks 5/6/10 都引用，提示实现者复用（避免 DRY 违反，可以抽到 `__tests__/_groupFixture.ts`，留作 implementer 自决）。

**类型一致性**：
- `CreateAgentRunResult` 新增 `llmJobId` 字段，runtime / intentExecute / topic_skills 路由都不会消费它，只是回传给 createAgentRun 调用者（避免 intentExecute 失败）
- `TopicSkill` 在 `topicSkills.ts` 和 `contextAdapter.ts` 各定义一次（contextAdapter 的是从前期 M1a 留下来的，建议 implementer 删掉 contextAdapter 的本地定义，改 import 自 topicSkills.ts）

---

Plan complete and saved to `docs/superpowers/plans/2026-05-20-agent-runtime-m1b-1.md`.

下一份 plan：M1b-2（approval flow + steer API + critique）。等本 plan 实现完且 review 通过后再写。

# Agent Runtime M6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v0.m6 closeout —— long-poll 替换 polling、artifact ref 真跳转、JSONB null-clear 修补、AgentRunCard 模型名去重、`youtube_transcript` 工具。

**Architecture:** 增量 long-poll（hold 20–30s 随机 jitter + 15s heartbeat）替换 1.5s polling，零新增依赖；artifact ref 三种 kind 各自跳到合适目标（diagram → scroll-to-step、document → 文档屏 highlight、magi_card → Alert）；统一 JSONB null-clear helper；`youtube-transcript` npm 包做工具。

**Tech Stack:** TypeScript / Hono / pg / Vitest（apps/api）；Expo / React Native（apps/mobile）。新增 npm 依赖：`youtube-transcript`（apps/api）。

**Spec:** `docs/superpowers/specs/2026-05-23-agent-runtime-m6-design.md`

---

## 测试命令统一约定

后端测试需要 DB 连接：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run <test file>
```

Mobile 编译：`cd apps/mobile && npx tsc --noEmit`

---

## T0：分支 + baseline

**Files:** none

- [ ] **Step 1: 拉新分支 + 后端全量测试**

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git checkout main && git pull --ff-only
git checkout -b feat/agent-runtime-m6
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：全绿，~451 tests（M5 baseline）。`runtime.group.test.ts` 偶尔 FK race flaky → 单文件重跑确认。

- [ ] **Step 2: Mobile 编译**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

---

# Part A：T1 增量 long-poll

## T1a：Backend long-poll 路由

**Files:**
- Modify: `apps/api/src/routes/agent.ts`（加新 handler，约 L160 附近，位于 `/runs/:id/stream` 之后）
- Create: `apps/api/src/routes/__tests__/agent.longpoll.test.ts`

### Step 1：写失败测试

- [ ] 在 `apps/api/src/routes/__tests__/agent.longpoll.test.ts` 创建：

```typescript
/**
 * M6 T1a：long-poll 路由测试。
 *
 * 测试约定（对齐 agent.routes.test.ts）：
 *  - 用 makeApp() 拼装 Hono router（不引整个 app.ts）
 *  - 用 tokenFor() 签 JWT，加 Authorization: Bearer header
 *  - 路由从 /api/agent/* 开始
 *
 * 覆盖：
 *   1. after=N 已有新 step → 立即 batch 返回（不 hold）
 *   2. run 已 terminal → 立即 batch 返回（hasMore=false）
 *   3. hold 期间 recordStep → 立即 batch 返回（recordStep 自己会 emit hook）
 *   4. 无新 step → hold；用 ?_holdMs=500 加快测试 → idle 返回
 *   5. jitter 数值落 [20000, 30000] 且有方差
 *   6. 403 / 404 权限
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';
import { runMigrations } from '../../db/migrate.js';
import * as store from '../../lib/agent/store.js';
import { recordStep } from '../../lib/agent/stepRecorder.js';
import { agentRouter } from '../agent.js';
import { signAccessToken } from '../../lib/auth.js';
import { DEFAULT_BUDGET } from '../../lib/agent/types.js';
import { ensureUser } from '../../lib/agent/__tests__/_groupFixture.js';
import type { AppVariables } from '../../types.js';

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID());
    await next();
  });
  app.route('/api/agent', agentRouter);
  return app;
}

async function tokenFor(u: { id: string; username: string; displayName: string }) {
  const { accessToken } = await signAccessToken({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    createdAt: new Date().toISOString(),
  });
  return accessToken;
}

async function makeRun(prefix: string) {
  const owner = await ensureUser(prefix);
  const run = await store.insertAgentRun({
    ownerId: owner.id,
    channel: 'private',
    sessionId: null,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'running',
    inputText: 'x',
    budget: DEFAULT_BUDGET,
    apiKeySource: 'server',
    apiKeyOwnerId: null,
  });
  return { owner, run };
}

async function readNdjson(resp: Response): Promise<unknown[]> {
  const text = await resp.text();
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe('GET /api/agent/runs/:id/long-poll', { timeout: 40000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('after=-1 when steps exist → immediate batch, no hold', async () => {
    const { owner, run } = await makeRun('lp-immediate');
    await recordStep({ runId: run.id, kind: 'plan', output: { goal: 'x' } });
    const token = await tokenFor(owner);
    const app = makeApp();
    const t0 = Date.now();
    const resp = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/long-poll?after=-1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const elapsed = Date.now() - t0;
    expect(resp.status).toBe(200);
    expect(elapsed).toBeLessThan(1000);
    const lines = (await readNdjson(resp)) as Array<{ type: string; [k: string]: any }>;
    const batch = lines.find((l) => l.type === 'batch');
    expect(batch).toBeDefined();
    expect(batch!.steps.length).toBe(1);
    expect(batch!.steps[0].kind).toBe('plan');
  });

  it('terminal run → immediate batch with hasMore=false', async () => {
    const { owner, run } = await makeRun('lp-terminal');
    await store.updateAgentRun(run.id, { status: 'completed' });
    const token = await tokenFor(owner);
    const app = makeApp();
    const resp = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/long-poll?after=-1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(resp.status).toBe(200);
    const lines = (await readNdjson(resp)) as Array<{ type: string; [k: string]: any }>;
    const batch = lines.find((l) => l.type === 'batch');
    expect(batch!.run.status).toBe('completed');
    expect(batch!.hasMore).toBe(false);
  });

  it('hold mode: step emitted mid-hold → batch returned immediately', async () => {
    const { owner, run } = await makeRun('lp-hold');
    const token = await tokenFor(owner);
    const app = makeApp();
    const promise = app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/long-poll?after=-1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    // 给路由 100ms 建立 hold + subscribe
    await new Promise((r) => setTimeout(r, 100));
    // recordStep 自身会 emit step.recorded hook 事件 → long-poll handler settle 返回
    await recordStep({ runId: run.id, kind: 'plan', output: { goal: 'mid' } });
    const resp = await promise;
    expect(resp.status).toBe(200);
    const lines = (await readNdjson(resp)) as Array<{ type: string; [k: string]: any }>;
    const batch = lines.find((l) => l.type === 'batch');
    expect(batch!.steps.length).toBe(1);
    expect(batch!.steps[0].output).toEqual({ goal: 'mid' });
  });

  it('no new step → hold ~500ms (override) → emits idle', async () => {
    const { owner, run } = await makeRun('lp-idle');
    const token = await tokenFor(owner);
    const app = makeApp();
    const t0 = Date.now();
    const resp = await app.fetch(
      new Request(
        `http://test/api/agent/runs/${run.id}/long-poll?after=-1&_holdMs=500`,
        { headers: { authorization: `Bearer ${token}` } },
      ),
    );
    const elapsed = Date.now() - t0;
    expect(resp.status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(2500);
    const lines = (await readNdjson(resp)) as Array<{ type: string; [k: string]: any }>;
    const idle = lines.find((l) => l.type === 'idle');
    expect(idle).toBeDefined();
    expect(idle!.lastIdx).toBe(-1);
  });

  it('jitter samples fall in [20000, 30000] with variance', async () => {
    const { computeHoldMs } = await import('../../lib/agent/longPollJitter.js');
    const samples = Array.from({ length: 100 }, () => computeHoldMs());
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThanOrEqual(20000);
    expect(max).toBeLessThanOrEqual(30000);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance =
      samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length;
    expect(variance).toBeGreaterThan(100000); // ~10s window 的方差应远 > 0
  });

  it('non-owner → 403', async () => {
    const { run } = await makeRun('lp-owner');
    const other = await ensureUser('lp-other');
    const token = await tokenFor(other);
    const app = makeApp();
    const resp = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/long-poll?after=-1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(resp.status).toBe(403);
  });

  it('unknown run → 404', async () => {
    const u = await ensureUser('lp-404');
    const token = await tokenFor(u);
    const app = makeApp();
    const resp = await app.fetch(
      new Request(
        `http://test/api/agent/runs/00000000-0000-0000-0000-000000000000/long-poll`,
        { headers: { authorization: `Bearer ${token}` } },
      ),
    );
    expect(resp.status).toBe(404);
  });
});
```

- [ ] **Step 2：跑测试确认 FAIL**

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/routes/__tests__/agent.longpoll.test.ts
```

Expected：FAIL（路由不存在 / `longPollJitter` 模块不存在）。

### Step 3：实现 jitter 辅助模块

- [ ] 创建 `apps/api/src/lib/agent/longPollJitter.ts`：

```typescript
/**
 * M6 T1a：long-poll hold 时长 jitter。
 *
 * 25s 中心 ± 20%：均匀分布 [20000, 30000] ms。
 *
 * 设计要点（防 thundering herd）：
 *   - 每次 hold 独立 random，避免多客户端同频
 *   - 上界 30000 < Nginx/ALB 默认 60s，留余量
 *   - 下界 20000 远高于平均 step 推进（避免空响应抖动太频繁）
 */
const HOLD_CENTER_MS = 25000;
const HOLD_JITTER_FRACTION = 0.2;

export function computeHoldMs(): number {
  const jitter = 1 + (Math.random() * 2 - 1) * HOLD_JITTER_FRACTION;
  return Math.round(HOLD_CENTER_MS * jitter);
}

/** 测试用：NODE_ENV=test 时 ?_holdMs=N 可覆盖。 */
export function resolveHoldMs(override?: string | undefined): number {
  if (process.env.NODE_ENV === 'test' && override) {
    const n = Number(override);
    if (Number.isFinite(n) && n >= 100 && n <= 30000) return n;
  }
  return computeHoldMs();
}
```

### Step 4：实现 long-poll 路由

- [ ] 在 `apps/api/src/routes/agent.ts` `/runs/:id/stream` 之后新增 handler。先看现有 import：

```typescript
import { agentHookBus, type AgentHookEvent } from '../lib/agent/hooks.js';
import { resolveHoldMs } from '../lib/agent/longPollJitter.js';
```

`hooks.ts` 已 export `agentHookBus`；如未 export `AgentHookEvent`，先在 `hooks.ts` 末尾加 `export type { AgentHookEvent };`（仅 type，不影响 runtime）。

- [ ] 添加 handler（紧跟 `/runs/:id/stream` handler 之后）：

```typescript
/**
 * M6 T1a：增量 long-poll —— 替代 mobile 1.5s 全量轮询。
 *
 * 行为：
 *   1. 立刻 SELECT idx > after 的 step；有 → 立即 batch 返回 + close
 *   2. 无 → 进入 hold 模式：
 *      - 启 heartbeat 定时器，每 15s emit { type:'heartbeat' }
 *      - subscribe agentHookBus；收到 step.recorded(runId == id) → 立刻 batch + close
 *      - 启 idle timer (jitter 20-30s) → emit { type:'idle' } + close
 *   3. run 已 terminal → 直接 batch（含最新 run + hasMore=false）+ close
 *
 * 响应格式：application/x-ndjson（每行一个 JSON）。
 * Heartbeat 防中间反向代理因 idle 切断连接。
 */
const HEARTBEAT_MS = 15000;

agentRouter.get('/runs/:id/long-poll', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);

  const afterRaw = c.req.query('after');
  const after = afterRaw !== undefined ? Number(afterRaw) : -1;
  const holdMs = resolveHoldMs(c.req.query('_holdMs'));

  return c.body(
    new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const write = (obj: unknown) => {
          try {
            controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
          } catch {
            // controller 已关；ignore
          }
        };
        const close = () => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        // Step 1：立刻查新 step
        async function emitBatchAndClose() {
          const latest = await store.getAgentRun(id);
          if (!latest) {
            write({ type: 'idle', lastIdx: after, run: null });
            close();
            return;
          }
          const steps = await store.listSteps(id);
          const newSteps = steps.filter((s) => s.idx > after);
          const notices = await listNoticesForRun(id, { limit: 20 });
          write({
            type: 'batch',
            run: latest,
            steps: newSteps,
            notices,
            hasMore: false,
          });
          close();
        }

        // Terminal 直接走 batch
        const terminalSet = ['completed', 'failed', 'cancelled', 'budget_exhausted'];
        if (terminalSet.includes(run.status)) {
          await emitBatchAndClose();
          return;
        }

        // 立刻查有无新 step
        const existing = await store.listSteps(id);
        const newExisting = existing.filter((s) => s.idx > after);
        if (newExisting.length > 0) {
          await emitBatchAndClose();
          return;
        }

        // Step 2：hold 模式
        let settled = false;
        const settle = (cb: () => Promise<void>) => {
          if (settled) return;
          settled = true;
          clearInterval(hbTimer);
          clearTimeout(idleTimer);
          unsubscribe();
          void cb();
        };

        const unsubscribe = agentHookBus.onEvent((event: AgentHookEvent) => {
          if (event.type === 'step.recorded' && event.runId === id) {
            settle(emitBatchAndClose);
          } else if (
            (event.type === 'run.completed' ||
              event.type === 'run.failed' ||
              event.type === 'run.cancelled' ||
              event.type === 'run.budget_exhausted') &&
            event.run.id === id
          ) {
            settle(emitBatchAndClose);
          }
        });

        const hbTimer = setInterval(() => {
          if (settled) return;
          write({ type: 'heartbeat', ts: Date.now() });
        }, HEARTBEAT_MS);

        const idleTimer = setTimeout(() => {
          settle(async () => {
            const latest = await store.getAgentRun(id);
            write({ type: 'idle', lastIdx: after, run: latest });
            close();
          });
        }, holdMs);
      },
      cancel() {
        // 客户端断连：cleanup 在 settle 里已经处理；这里 noop
      },
    }),
    200,
    { 'content-type': 'application/x-ndjson' },
  );
});
```

> 注意：`hooks.ts` 的 `agentHookBus.onEvent` 返回 unsubscribe 函数，与上面 `unsubscribe` 变量对齐。如果实际签名不同，read `hooks.ts` 确认（spec 已查实）。

### Step 5：跑测试确认 PASS

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/routes/__tests__/agent.longpoll.test.ts
```

Expected：7/7 PASS。`stepRecorder.ts.recordStep` 已确认自动 emit `step.recorded` 到 `agentHookBus`（spec 已查实），测试里调用 `recordStep` 就够，无需手动 emit。

### Step 6：全量回归

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：所有 case PASS（基线 ~451 + 新增 7 = ~458）。

### Step 7：Commit

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git add apps/api/src/routes/agent.ts \
        apps/api/src/lib/agent/longPollJitter.ts \
        apps/api/src/routes/__tests__/agent.longpoll.test.ts \
        apps/api/src/lib/agent/hooks.ts
git commit -m "feat(agent/m6 t1a): GET /runs/:id/long-poll —— ndjson + jitter 20-30s + 15s heartbeat"
```

---

## T1b：Mobile useAgentRunPoll 切到 long-poll

**Files:**
- Modify: `apps/mobile/src/features/agent/hooks/useAgentRunPoll.ts`
- Modify: `apps/mobile/src/features/agent/agentApi.ts`（加 `longPollAgentRun` fetch helper）

### Step 1：在 agentApi.ts 加 long-poll 客户端

- [ ] Read `apps/mobile/src/features/agent/agentApi.ts` 找到现有 fetchAgentRun 实现位置和 baseUrl helper（应该用 `api` 单例）。

- [ ] 加：

```typescript
/**
 * M6 T1b：long-poll 单次拉取。
 *
 * 服务端会 hold 最多 30s（jitter 20-30s）；期间用 ndjson 流式发送 heartbeat。
 * 客户端 35s timeout 是为了网络丢包兜底（server max 30s + 5s 余量）。
 *
 * 返回：解析后的最终 batch / idle 结果。heartbeat 行被忽略。
 */
export type LongPollBatch = {
  type: 'batch' | 'idle';
  run: AgentRun | null;
  steps: AgentStep[];
  notices?: AgentNotice[];
  lastIdx?: number;
  hasMore?: boolean;
};

export async function longPollAgentRun(
  runId: string,
  after: number,
  signal: AbortSignal,
): Promise<LongPollBatch> {
  const url = `${api.baseUrl}/api/agent/runs/${runId}/long-poll?after=${after}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/x-ndjson',
      ...(await api.authHeaders()),
    },
    signal,
  });
  if (!resp.ok) {
    throw new Error(`long-poll failed: ${resp.status}`);
  }
  if (!resp.body) {
    throw new Error('long-poll: no response body');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let lastBatch: LongPollBatch | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'heartbeat') continue;
        if (msg.type === 'batch' || msg.type === 'idle') {
          lastBatch = msg;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  if (!lastBatch) throw new Error('long-poll: stream ended without batch/idle');
  return lastBatch;
}
```

> 如果 `api` 单例没有 `baseUrl` / `authHeaders()` 方法，看 `apps/mobile/src/lib/api.ts` 现有 fetch 拼装方式照搬。可能是直接拼 `${api.endpoint}/api/agent/...` + `fetchWithAuth`。Read 后调整。

### Step 2：重写 useAgentRunPoll

- [ ] 替换整个文件内容：

```typescript
import { useEffect, useState } from 'react';
import { fetchAgentRun, longPollAgentRun } from '../agentApi';
import type { AgentNotice, AgentRun, AgentStep } from '../types';

const CLIENT_TIMEOUT_MS = 35000;        // server max 30s + 5s 余量
const ERROR_BACKOFF_MS = 1000;
const TERMINAL_STATUSES: AgentRun['status'][] = [
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
];

/**
 * M6 T1b：增量 long-poll 替代 1.5s polling。
 *
 * 行为：
 *   1. mount 时全量 GET /runs/:id 一次拉初始状态（避免错过历史 step）
 *   2. 之后循环：long-poll(after=lastIdx) → 累加 steps → 立刻重连
 *   3. terminal 状态 → break loop
 *
 * 上层 alias 仍叫 useAgentRunSubscription（在 AgentRunCard import），无需改 caller。
 */
export function useAgentRunPoll(runId: string | null) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [notices, setNotices] = useState<AgentNotice[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setSteps([]);
      setNotices([]);
      setConnected(false);
      return;
    }
    let cancelled = false;
    let activeCtl: AbortController | null = null;
    let knownSteps: AgentStep[] = [];
    let lastIdx = -1;

    function mergeSteps(incoming: AgentStep[]) {
      if (incoming.length === 0) return knownSteps;
      const byId = new Map(knownSteps.map((s) => [s.id, s]));
      for (const s of incoming) byId.set(s.id, s);
      const merged = Array.from(byId.values()).sort((a, b) => a.idx - b.idx);
      knownSteps = merged;
      return merged;
    }

    async function bootstrap() {
      try {
        const { run: r0, steps: s0, notices: n0 } = await fetchAgentRun(runId!);
        if (cancelled) return;
        setRun(r0);
        setNotices(n0 ?? []);
        knownSteps = s0;
        setSteps(s0);
        lastIdx = s0.length > 0 ? Math.max(...s0.map((s) => s.idx)) : -1;
        if (TERMINAL_STATUSES.includes(r0.status)) {
          setConnected(false);
          cancelled = true;
        }
      } catch {
        // 失败由后续 loop 重试
      }
    }

    async function loop() {
      setConnected(true);
      await bootstrap();
      while (!cancelled) {
        const ctl = new AbortController();
        activeCtl = ctl;
        const timeoutId = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);
        try {
          const batch = await longPollAgentRun(runId!, lastIdx, ctl.signal);
          if (cancelled) break;
          if (batch.run) setRun(batch.run);
          if (batch.notices) setNotices(batch.notices);
          if (batch.steps && batch.steps.length > 0) {
            const merged = mergeSteps(batch.steps);
            setSteps(merged);
            lastIdx = Math.max(...batch.steps.map((s) => s.idx));
          }
          if (batch.run && TERMINAL_STATUSES.includes(batch.run.status)) break;
        } catch {
          if (cancelled) break;
          await new Promise((r) => setTimeout(r, ERROR_BACKOFF_MS));
        } finally {
          clearTimeout(timeoutId);
          activeCtl = null;
        }
      }
      if (!cancelled) setConnected(false);
    }

    void loop();
    return () => {
      cancelled = true;
      activeCtl?.abort();
    };
  }, [runId]);

  return { run, steps, notices, connected };
}
```

### Step 3：Mobile 编译

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

> 如果 RN 的 ReadableStream `getReader()` 不可用（旧 RN 版本），fallback 见 spec §3.5 末尾：把 server response 改成一次性 JSON（去掉 heartbeat），mobile 走 `await resp.json()`。本项目 Expo 是最新，应该 OK；若发现问题再回退。

### Step 4：Commit

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git add apps/mobile/src/features/agent/hooks/useAgentRunPoll.ts \
        apps/mobile/src/features/agent/agentApi.ts
git commit -m "feat(agent/m6 t1b): mobile useAgentRunPoll 切到增量 long-poll —— 35s client timeout + 1s 错误退避"
```

---

# Part B：T2 Artifact ref 跳转

## T2：Artifact ref 真跳转

**Files:**
- Modify: `apps/mobile/src/features/agent/AgentRunCard.tsx`（ArtifactBlock）
- Modify: `apps/mobile/src/features/agent/AgentStepList.tsx`（暴露 step 坐标）
- Modify: `apps/mobile/src/screens/SettingsDocumentsScreen.tsx`（highlight）
- Modify: `apps/mobile/src/navigation/types.ts`（SettingsDocuments 路由 param 加 highlightId）

### Step 1：扩展 SettingsDocuments 路由 param

- [ ] Read `apps/mobile/src/navigation/types.ts`，找到 `SettingsDocuments` 项（当前是 `scope: 'visible' | 'hidden'`）：

```typescript
SettingsDocuments: { scope: 'visible' | 'hidden' };
```

改为：

```typescript
SettingsDocuments: { scope: 'visible' | 'hidden'; highlightId?: string };
```

### Step 2：SettingsDocumentsScreen 加 highlight

- [ ] Read `apps/mobile/src/screens/SettingsDocumentsScreen.tsx` 找到 doc list render（应该是 map 渲染 `WeChatListCell`）。

- [ ] 在文件顶部加 `import { useEffect, useState } from 'react';`（如已有就不动）。

- [ ] 在 component 内：

```typescript
const { scope, highlightId } = route.params;
const [highlightActive, setHighlightActive] = useState<string | null>(highlightId ?? null);

useEffect(() => {
  if (!highlightId) return;
  setHighlightActive(highlightId);
  const t = setTimeout(() => setHighlightActive(null), 1500);
  return () => clearTimeout(t);
}, [highlightId]);
```

- [ ] 在 doc row render 处，给 `<WeChatListCell>` 包一层 View 加临时 background：

```tsx
<View
  key={doc.id}
  style={{
    backgroundColor: highlightActive === doc.id ? '#fff5b3' : 'transparent',
    borderRadius: 8,
  }}
>
  <WeChatListCell ... />
</View>
```

具体 wrapper 位置看现有 JSX 结构（可能已有 `<WeChatGroupedSection>` 包裹，加在 section 内的最外层 View 上即可）。

### Step 3：AgentStepList 暴露 step y 坐标

AgentStepList 用 ScrollView（已确认）。需要让上层能 scroll-to 指定 stepId。

- [ ] 改 `AgentStepList.tsx` props：

```typescript
type Props = {
  steps: AgentStep[];
  run?: AgentRun;
  resumeRun?: (runId: string, userInput: string) => Promise<void>;
  onRefresh?: () => void;
  /** M6 T2：每个 step render 完时回调，让上层记录 y 坐标用于 scroll-to-step。 */
  onStepLayout?: (stepId: string, y: number) => void;
};
```

- [ ] 在每个 step 的最外层 View 加 `onLayout`：

```tsx
<View
  key={step.id}
  onLayout={(e) => onStepLayout?.(step.id, e.nativeEvent.layout.y)}
  style={{ ... existing ... }}
>
  ...
</View>
```

> 注意：onLayout 的 y 是相对于 ScrollView contentSize 的偏移，scroll-to 需要的就是这个。

### Step 4：AgentRunCard ArtifactBlock 加跳转 + 模型名去重

- [ ] 改 `AgentRunCard.tsx`：

顶部 imports 加：
```typescript
import { useNavigation } from '@react-navigation/native';
import { navigateBrainTab } from '../../lib/navigateBrain';
```

`ArtifactBlock` props 加 `onJumpToStep`：

```typescript
function ArtifactBlock({
  artifact,
  onJumpToStep,
}: {
  artifact: RunArtifact;
  onJumpToStep?: (stepId: string) => void;
}) {
  const navigation = useNavigation<any>();
  // ... existing code ...
```

ref tap 处替换：

```typescript
onPress={() => {
  if (ref.kind === 'url') {
    Linking.openURL(ref.id).catch(() => {});
  } else if (ref.kind === 'diagram') {
    if (onJumpToStep) {
      onJumpToStep(ref.id);
    } else {
      Alert.alert('提示', '请进入任务详情页查看图表');
    }
  } else if (ref.kind === 'document') {
    navigateBrainTab(navigation, 'SettingsDocuments', {
      scope: 'visible',
      highlightId: ref.id,
    });
  } else if (ref.kind === 'magi_card') {
    Alert.alert('MAGI 卡片', `${ref.label ?? ref.id}\nID: ${ref.id}`);
  }
}}
```

`ArtifactBlock` footer 去掉 modelName 行（保留 producedAt + 复制按钮）：

```tsx
<View
  style={{
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: '#c8dcc8',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  }}
>
  <TouchableOpacity
    onPress={async () => {
      await Clipboard.setStringAsync(artifact.finalContent);
    }}
  >
    <Text style={{ fontSize: 12, color: '#0a6' }}>复制全文</Text>
  </TouchableOpacity>
  <Text style={{ fontSize: 12, opacity: 0.45 }}>·</Text>
  <Text style={{ fontSize: 12, opacity: 0.45 }}>产出于 {producedAt}</Text>
</View>
```

把 `const modelName = ...` 行也删掉（不再使用）。

### Step 5：AgentRunCard 接 ScrollView + 传 onJumpToStep

AgentRunCard 顶部 wrapper 当前用 `<View>`。要 scroll，需要：

- [ ] 顶部 import：
```typescript
import { ScrollView } from 'react-native';
import { useRef } from 'react';
```

- [ ] 在 `AgentRunCard` 函数内：

```typescript
const scrollRef = useRef<ScrollView>(null);
const stepYRef = useRef<Map<string, number>>(new Map());

const handleJumpToStep = (stepId: string) => {
  const y = stepYRef.current.get(stepId);
  if (y == null) {
    Alert.alert('提示', '未找到对应的图表步骤');
    return;
  }
  scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
};
```

- [ ] 把当前的最外层 `<View>` 替换为 `<ScrollView ref={scrollRef}>`，并把 contentContainerStyle 写在 ScrollView 上：

> 注意：AgentRunCard 当前嵌在父 ScrollView 内（BrainAgentTaskDetailScreen / ChatScreen）。嵌套 ScrollView 在 RN 会有警告但功能正常。**简化路径**：保持外层 View 不变，给 AgentStepList 直接传 `onJumpToStep` —— 由 AgentStepList 内部用 `findNodeHandle + UIManager.measure`。
>
> **采用简化路径**：

把 step y 记录改成在 AgentRunCard 计算后传 onJump callback：

```tsx
<AgentStepList
  steps={steps}
  run={run}
  resumeRun={resumeAgentRun}
  onStepLayout={(id, y) => stepYRef.current.set(id, y)}
/>
```

然后 ArtifactBlock 调用 onJumpToStep 时，AgentRunCard 把内部父屏的 ScrollView 滚动委托给父屏 —— 这又复杂了。

**最终决策**：M6 范围内，diagram scroll-to-step 改为**软实现**：

- AgentStepList 给每个 diagram step 加一个 `id={`step-${stepId}`}` 视觉 anchor（无 scroll）
- ArtifactBlock 点 diagram → `Alert.alert('图表', `${label ?? id}`)` 提示用户在下方 step 列表查找
- 留 followup：M7 把 BrainAgentTaskDetailScreen 改用 FlatList，再实现真 scroll

更新 ArtifactBlock 的 diagram 分支：

```typescript
} else if (ref.kind === 'diagram') {
  Alert.alert(
    '图表',
    `${ref.label ?? '未命名图表'}\n请在下方步骤列表中查找 id: ${ref.id}`,
  );
}
```

> **删除 Step 3 和 Step 5 的 AgentStepList 改动**（onStepLayout 不需要）。

### Step 6：传 onJumpToStep（保留接口）

- [ ] 即便简化实现不需要 scroll，仍把 `onJumpToStep` 作为可选 prop 留给将来：

```tsx
<ArtifactBlock artifact={run.artifact} onJumpToStep={undefined} />
```

实际 M6 不传；接口预留供 M7 升级。

### Step 7：Mobile 编译

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

### Step 8：手测清单（写进 commit message）

- 完成一个 doc_export_markdown run → 终态点 document ref → 跳 `SettingsDocuments` 屏 → 目标 doc 1.5s 高亮
- 点 url ref → 浏览器打开
- 点 diagram ref → Alert 提示在下方查找
- 点 magi_card ref → Alert 显示 id + label
- 终态卡片"产出于 12:34"后**没有**再出现 ModelName

### Step 9：Commit

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git add apps/mobile/src/features/agent/AgentRunCard.tsx \
        apps/mobile/src/screens/SettingsDocumentsScreen.tsx \
        apps/mobile/src/navigation/types.ts
git commit -m "feat(mobile/m6 t2): artifact ref 跳转 —— document highlight / magi_card Alert / diagram 提示

- document ref → navigateBrainTab SettingsDocuments + 1.5s 高亮
- magi_card ref → Alert 显示 ID + label（无目标屏，M7 评估）
- diagram ref → Alert 提示在 step 列表查找（M7 升级 FlatList 后做真 scroll）
- url ref 保留 Linking.openURL
- ArtifactBlock footer 去掉重复 modelName（header 已显示）"
```

---

# Part C：T3 JSONB null-clear 修补

## T3：jsonbOrNull 统一 helper

**Files:**
- Modify: `apps/api/src/lib/agent/store.ts`
- Create/Modify: `apps/api/src/lib/agent/__tests__/store.jsonbNull.test.ts`

### Step 1：写失败测试

- [ ] 创建 `apps/api/src/lib/agent/__tests__/store.jsonbNull.test.ts`：

```typescript
/**
 * M6 T3：updateAgentRun 把 JSONB 字段设为 null 时，DB 应是 SQL NULL（不是字符串 "null"）。
 *
 * 历史 bug：M5 review 发现 summary / plan / todos / usage / userApiKeysEnc 几个 JSONB 字段
 * 都用 `JSON.stringify(value)` 写入；当 value === null 时变成字符串 "null"，
 * `WHERE summary IS NULL` 不命中。artifact 已在 M5A 修；本测试守住其余字段。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { ensureUser } from './_groupFixture.js';

async function makeRun(prefix: string) {
  const { id: ownerId } = await ensureUser(prefix);
  return store.insertAgentRun({
    ownerId,
    channel: 'private',
    sessionId: null,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'running',
    inputText: 'x',
    budget: DEFAULT_BUDGET,
    apiKeySource: 'server',
    apiKeyOwnerId: null,
  });
}

async function isNullInDb(runId: string, column: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT ${column} IS NULL AS is_null FROM agent_runs WHERE id = $1`,
    [runId],
  );
  return rows[0]?.is_null === true;
}

describe('store JSONB null-clear writes SQL NULL', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('summary: null → SQL NULL', async () => {
    const run = await makeRun('jn-summary');
    await store.updateAgentRun(run.id, {
      summary: { stepCount: 3, toolCount: 1, toolBreakdown: {}, refCount: 0 },
    });
    await store.updateAgentRun(run.id, { summary: null });
    expect(await isNullInDb(run.id, 'summary')).toBe(true);
  });

  it('plan: null → SQL NULL', async () => {
    const run = await makeRun('jn-plan');
    await store.updateAgentRun(run.id, {
      plan: { goal: 'x', steps: [] },
    });
    await store.updateAgentRun(run.id, { plan: null });
    expect(await isNullInDb(run.id, 'plan')).toBe(true);
  });

  it('artifact: null → SQL NULL (regression M5A)', async () => {
    const run = await makeRun('jn-artifact');
    await store.updateAgentRun(run.id, {
      artifact: {
        finalContent: 'x',
        refs: [],
        model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        producedAt: '2026-05-23T00:00:00Z',
      },
    });
    await store.updateAgentRun(run.id, { artifact: null });
    expect(await isNullInDb(run.id, 'artifact')).toBe(true);
  });

  it('non-null write still works (regression)', async () => {
    const run = await makeRun('jn-roundtrip');
    const summary = { stepCount: 5, toolCount: 2, toolBreakdown: { foo: 2 }, refCount: 1 };
    const updated = await store.updateAgentRun(run.id, { summary });
    expect(updated?.summary).toEqual(summary);
  });
});
```

- [ ] 跑测试确认 FAIL：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/store.jsonbNull.test.ts
```

Expected：`summary` / `plan` 两个 FAIL，`artifact` PASS，`roundtrip` PASS。

### Step 2：抽 jsonbOrNull helper + 统一应用

- [ ] 在 `apps/api/src/lib/agent/store.ts` `parseRun` 之后、`updateAgentRun` 之前加 helper：

```typescript
/**
 * M6 T3：JSONB 字段写入 helper。
 * undefined → 不更新；null → SQL NULL；其他 → JSON.stringify。
 *
 * 历史 bug：M5 review 发现 summary 等字段把 null 写成字符串 "null"，
 * IS NULL 判断不命中。artifact 在 M5A 已修；本 helper 统一所有 JSONB 字段。
 */
function jsonbOrNull<T>(v: T | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return JSON.stringify(v);
}
```

- [ ] 替换 `updateAgentRun` 的 `map` 里所有 JSONB 字段（约 L295–L330）：

```typescript
  const map: Record<string, [string, unknown]> = {
    status: ['status', patch.status],
    plan: ['plan', jsonbOrNull(patch.plan)],
    todos: ['todos', jsonbOrNull(patch.todos)],
    usage: ['usage', jsonbOrNull(patch.usage)],
    sandboxId: ['sandbox_id', patch.sandboxId],
    userApiKeysEnc: ['user_api_keys_enc', jsonbOrNull(patch.userApiKeysEnc)],
    pendingUserPrompt: ['pending_user_prompt', patch.pendingUserPrompt],
    pendingUserStepIdx: ['pending_user_step_idx', patch.pendingUserStepIdx],
    pendingUserInputExpiresAt: ['pending_user_input_expires_at', patch.pendingUserInputExpiresAt],
    summary: ['summary', jsonbOrNull(patch.summary)],
    artifact: ['artifact', jsonbOrNull(patch.artifact)],
    resultMessageId: ['result_message_id', patch.resultMessageId],
    invokeMessageId: ['invoke_message_id', patch.invokeMessageId],
    lastHeartbeatAt: ['last_heartbeat_at', patch.lastHeartbeatAt],
    awaitingApprovalUntil: ['awaiting_approval_until', patch.awaitingApprovalUntil],
    awaitingApprovalStepIdx: ['awaiting_approval_step_idx', patch.awaitingApprovalStepIdx],
    pendingApprovalToolName: ['pending_approval_tool_name', patch.pendingApprovalToolName],
    cancelledByUserId: ['cancelled_by_user_id', patch.cancelledByUserId],
    cancelReason: ['cancel_reason', patch.cancelReason],
    startedAt: ['started_at', patch.startedAt],
    endedAt: ['ended_at', patch.endedAt],
  };
```

> 注意：原 `'in' patch` 风格已经隐含在 `patch.XXX === undefined` 判断里（看现有 L351–L358 的 loop）；helper 返回 `undefined` 即跳过写入，行为等价。

### Step 3：跑测试确认 PASS

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/store.jsonbNull.test.ts
```

Expected：4/4 PASS。

### Step 4：全量回归

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：全绿。

### Step 5：Commit

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git add apps/api/src/lib/agent/store.ts \
        apps/api/src/lib/agent/__tests__/store.jsonbNull.test.ts
git commit -m "fix(agent/m6 t3): jsonbOrNull helper 统一处理 JSONB null-clear → SQL NULL

历史 bug：summary / plan / todos / usage / userApiKeysEnc 几个 JSONB 字段
写 null 时变成字符串 \"null\"，WHERE IS NULL 不命中。artifact 在 M5A 已修，
此处统一所有字段（artifact 实现作为正确范式抽 helper）。

新增 4 个 case：summary/plan/artifact 三字段的 null → IS NULL；
roundtrip 非 null 写入回归。"
```

---

# Part D：T4 youtube_transcript

## T4：youtube_transcript 工具

**Files:**
- Create: `apps/api/src/lib/agent/tools/youtubeTranscript.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.youtubeTranscript.test.ts`
- Modify: `apps/api/src/lib/agent/registerAgentTools.ts`
- Modify: `apps/api/package.json`（加 `youtube-transcript` 依赖）
- Modify: `apps/api/src/lib/agent/planner.ts`（PLANNER_INSTRUCTION）

### Step 1：装依赖

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung/apps/api && npm install youtube-transcript@^1.2.1
```

Expected：success（包大小约 50KB，无 native）。如果 `^1.2.1` 不存在，用 `npm view youtube-transcript versions --json | tail -5` 看可用版本再选 latest。

### Step 2：写失败测试

- [ ] 创建 `apps/api/src/lib/agent/__tests__/tools.youtubeTranscript.test.ts`：

```typescript
/**
 * M6 T4：youtube_transcript 工具单测。Mock youtube-transcript npm 包。
 *
 * 注意 ToolDef.handler 签名：`(input, ctx) => Promise<O>`（两个位置参数）
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: vi.fn(),
  },
}));

import { YoutubeTranscript } from 'youtube-transcript';
import { youtubeTranscriptTool } from '../tools/youtubeTranscript.js';
import type { ToolCtx } from '../toolRegistry.js';

const originalFetch = global.fetch;

function makeCtx(): ToolCtx {
  return {
    runId: 'r1',
    stepId: 's1',
    ownerId: 'u1',
    channel: 'private',
    signal: new AbortController().signal,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => '<html><title>Test Video Title - YouTube</title></html>',
  } as Response);
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('youtube_transcript tool', () => {
  it('parses watch URL → videoId, fetches transcript, returns concatenated text', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue([
      { text: 'Hello', offset: 0, duration: 2000 },
      { text: 'world', offset: 2000, duration: 2000 },
    ]);
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.videoId).toBe('dQw4w9WgXcQ');
    expect(result.transcript).toBe('Hello world');
    expect(result.chunks).toHaveLength(2);
    expect(result.title).toBe('Test Video Title');
    expect(result.truncated).toBe(false);
  });

  it('parses short URL (youtu.be/<id>)', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue([
      { text: 'a', offset: 0, duration: 100 },
    ]);
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://youtu.be/abc123XYZ_-' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.videoId).toBe('abc123XYZ_-');
  });

  it('accepts bare video id', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue([
      { text: 'a', offset: 0, duration: 100 },
    ]);
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.videoId).toBe('dQw4w9WgXcQ');
  });

  it('invalid URL → ok:false reason:invalid_url', async () => {
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'not-a-url' },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_url');
  });

  it('YoutubeTranscript.fetchTranscript throws → ok:false reason:fetch_failed', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockRejectedValue(
      new Error('no transcript available'),
    );
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('fetch_failed');
    expect(result.videoId).toBe('dQw4w9WgXcQ');
  });

  it('transcript > 30000 chars → truncated:true and text length === 30000', async () => {
    const chunks = Array.from({ length: 1000 }, (_, i) => ({
      text: 'a'.repeat(50),
      offset: i * 100,
      duration: 100,
    }));
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue(chunks);
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.transcript.length).toBe(30000);
  });

  it('title fetch fails → fallback title=videoId, transcript still returned', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue([
      { text: 'a', offset: 0, duration: 100 },
    ]);
    (global.fetch as any).mockRejectedValue(new Error('network'));
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.title).toBe('dQw4w9WgXcQ');
    expect(result.transcript).toBe('a');
  });
});
```

- [ ] 跑测试确认 FAIL：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/tools.youtubeTranscript.test.ts
```

Expected：FAIL（模块不存在）。

### Step 3：实现 youtubeTranscript.ts

- [ ] 创建 `apps/api/src/lib/agent/tools/youtubeTranscript.ts`：

```typescript
/**
 * M6 T4：YouTube 视频字幕工具。
 *
 * 选型理由：
 *   - `youtube-transcript` npm 包：无 API key、无 OAuth、纯 client 解析（~50KB）
 *   - 缺点：依赖 YouTube 内部 timedtext 接口，可能某天失效 → soft-fail（ok:false）让 planner replan
 *
 * 不在 M6 范围：
 *   - B 站 transcript（不同 API、有反爬）
 *   - YouTube 视频元信息（仅在标题失败时降级用 videoId）
 *
 * ToolDef 风格对齐 wikipedia.ts：导出 `youtubeTranscriptTool: ToolDef<I,O>` + register helper。
 */
import { YoutubeTranscript } from 'youtube-transcript';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type YoutubeTranscriptInput = {
  url: string;
  lang?: 'zh-CN' | 'en' | 'auto';
};

type YoutubeTranscriptChunk = {
  text: string;
  offset: number;
  duration: number;
};

type YoutubeTranscriptOutput =
  | {
      ok: true;
      videoId: string;
      title: string;
      transcript: string;
      chunks: YoutubeTranscriptChunk[];
      lang: string;
      truncated: boolean;
    }
  | {
      ok: false;
      reason: 'invalid_url' | 'fetch_failed' | 'no_transcript';
      videoId?: string;
    };

const MAX_TRANSCRIPT_CHARS = 30000;
const TITLE_FETCH_TIMEOUT_MS = 3000;
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (VIDEO_ID_RE.test(s)) return s;

  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '');
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && VIDEO_ID_RE.test(v)) return v;
      const shorts = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shorts) return shorts[1];
      const embed = u.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embed) return embed[1];
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchVideoTitle(videoId: string, parentSignal: AbortSignal): Promise<string> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  parentSignal.addEventListener('abort', onAbort);
  const t = setTimeout(() => ctl.abort(), TITLE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) return videoId;
    const html = await resp.text();
    const m = html.match(/<title>([^<]+)<\/title>/);
    if (!m) return videoId;
    return m[1].replace(/\s*-\s*YouTube\s*$/, '').trim() || videoId;
  } catch {
    return videoId;
  } finally {
    clearTimeout(t);
    parentSignal.removeEventListener('abort', onAbort);
  }
}

export const youtubeTranscriptTool: ToolDef<YoutubeTranscriptInput, YoutubeTranscriptOutput> = {
  name: 'youtube_transcript',
  description:
    'Fetch transcript/captions of a YouTube video by URL or video ID. Returns concatenated text + per-chunk timing. Use this when the user shares a YouTube link and you need video content. Soft-fails on no captions or API errors.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'YouTube watch URL, short URL (youtu.be/...), shorts URL, or 11-char video ID.',
      },
      lang: {
        type: 'string',
        enum: ['zh-CN', 'en', 'auto'],
        description: 'Preferred caption language. Defaults to auto.',
      },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  computeIdempotencyKey: (input) => `yt:${input.lang ?? 'auto'}:${extractVideoId(input.url) ?? input.url}`,
  replyMeta: {
    summaryKind: 'text',
    failureHint:
      'YouTube transcript 失败一般是视频无字幕、被锁区或 API 临时不可用；可改用 fetch_url 抓视频描述页。',
    extractRef: (output) => {
      const o = output as YoutubeTranscriptOutput;
      if (!o?.ok) return null;
      return {
        kind: 'url' as const,
        id: `https://www.youtube.com/watch?v=${o.videoId}`,
        label: `YouTube: ${o.title}`,
      };
    },
  },
  async handler(input, ctx) {
    const videoId = extractVideoId(input.url);
    if (!videoId) {
      return { ok: false, reason: 'invalid_url' };
    }
    const lang = input.lang && input.lang !== 'auto' ? input.lang : undefined;

    let chunks: Awaited<ReturnType<typeof YoutubeTranscript.fetchTranscript>>;
    try {
      chunks = await YoutubeTranscript.fetchTranscript(videoId, lang ? { lang } : undefined);
    } catch {
      return { ok: false, reason: 'fetch_failed', videoId };
    }
    if (!chunks || chunks.length === 0) {
      return { ok: false, reason: 'no_transcript', videoId };
    }

    const fullText = chunks.map((c) => c.text).join(' ');
    const truncated = fullText.length > MAX_TRANSCRIPT_CHARS;
    const transcript = truncated ? fullText.slice(0, MAX_TRANSCRIPT_CHARS) : fullText;

    const title = await fetchVideoTitle(videoId, ctx.signal);

    return {
      ok: true,
      videoId,
      title,
      transcript,
      chunks: chunks.map((c) => ({
        offset: (c as { offset?: number; start?: number }).offset ?? (c as { start?: number }).start ?? 0,
        duration: c.duration,
        text: c.text,
      })),
      lang: lang ?? 'auto',
      truncated,
    };
  },
};

export function registerYoutubeTranscript(): void {
  if (!toolRegistry.get(youtubeTranscriptTool.name)) {
    toolRegistry.register(youtubeTranscriptTool);
  }
}
```

> 字段名 `offset` vs `start`：`youtube-transcript` 1.x 返回 `offset`（毫秒），旧文档常写 `start`；上面用兼容写法 `(c.offset ?? c.start)` 兜住版本差异。

### Step 4：注册

- [ ] 改 `apps/api/src/lib/agent/registerAgentTools.ts`：

```typescript
import { registerYoutubeTranscript } from './tools/youtubeTranscript.js';

export function registerAgentTools(): void {
  // ... existing ...
  registerDeepResearch();
  registerYoutubeTranscript();  // ← 加在末尾
}
```

### Step 5：跑测试确认 PASS

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/tools.youtubeTranscript.test.ts
```

Expected：7/7 PASS。

### Step 6：planner 引导

- [ ] Read `apps/api/src/lib/agent/planner.ts` 找 `PLANNER_INSTRUCTION` 常量（通常是个长 string）。

- [ ] 在工具说明列表里加一行（位置：跟在 fetch_url 描述附近）：

```
- `youtube_transcript({url})`：YouTube 视频字幕。当用户分享 youtube.com / youtu.be 链接需要视频内容时用，比 fetch_url 拿到的网页 HTML 信息量更高。
```

具体语言（中/英）和措辞匹配现有 PLANNER_INSTRUCTION 风格。

### Step 7：全量回归

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：全绿。Mobile 编译：

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

### Step 8：Commit

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git add apps/api/package.json apps/api/package-lock.json \
        apps/api/src/lib/agent/tools/youtubeTranscript.ts \
        apps/api/src/lib/agent/registerAgentTools.ts \
        apps/api/src/lib/agent/__tests__/tools.youtubeTranscript.test.ts \
        apps/api/src/lib/agent/planner.ts
git commit -m "feat(agent/m6 t4): youtube_transcript 工具（youtube-transcript npm 包 + 30k 截断 + soft-fail）

- url 解析：watch / youtu.be / shorts / embed / 裸 videoId
- transcript > 30000 char 截断 + truncated:true
- title 单独 fetch <title> + 3s timeout；失败降级用 videoId
- 任何 transcript 失败 → ok:false 让 planner replan（不抛 throw）
- registerAgentTools + PLANNER_INSTRUCTION 同步"
```

---

# Part E：T9 收尾

## T9：全量 review + merge + tag

**Files:** none

### Step 1：全量后端测试

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：全绿。基线 ~451 + 新增（T1a 7 + T3 4 + T4 7 = 18） ≈ 469。

### Step 2：Mobile 编译

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

### Step 3：dispatch code-reviewer subagent

用 superpowers:code-reviewer 跑一遍 diff 5b80a6c..HEAD（其实 main..HEAD 就够，M6 起点是 main HEAD）。

Prompt 要点：

> 这是 M6 implementation（long-poll + artifact ref 跳转 + JSONB null 修补 + youtube_transcript）。重点 review：
> (a) long-poll 路由的 ReadableStream cleanup 是否完整（client 断连 / settled 多次 / heartbeat timer leak）；
> (b) mobile useAgentRunPoll 重写后是否能正确恢复（bootstrap + lastIdx 推进 + AbortController 释放）；
> (c) jsonbOrNull 是否覆盖所有 JSONB 字段（无遗漏导致回归）；
> (d) youtube_transcript URL parse 边界（恶意输入 / SSRF 风险？）；
> (e) AgentRunCard ArtifactBlock 改动是否破坏其他 path。
> 列出所有 critical / important 问题。

### Step 4：修任何 critical/important 后再继续

### Step 5：Merge main + tag

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git checkout main && git pull --ff-only
git merge --no-ff feat/agent-runtime-m6 -m "M6: long-poll + artifact ref 跳转 + JSONB null 修补 + youtube_transcript (v0.m6)"
git tag v0.m6
```

不要 push，等用户决定。

---

## 失败回滚

- **T1a/T1b**：路由 + hook 改动独立，revert 即可；mobile 回到 polling
- **T2**：纯 mobile，revert 即可
- **T3**：jsonbOrNull 是 refactor，revert 立即恢复旧行为
- **T4**：remove `registerYoutubeTranscript()` 一行 + uninstall npm 包

---

## 估时

- T0：0.1 天
- T1a：0.3 天
- T1b：0.3 天
- T2：0.4 天
- T3：0.2 天
- T4：0.5 天
- T9：0.2 天

**合计 2 天**。Part A（T1a + T1b）必须先做（其他独立）；Part B/C/D 可并行。

---

## Self-Review Checklist

**Spec coverage**：

| Spec 要求 | 实现 task |
|---|---|
| §3 long-poll backend with jitter + heartbeat | T1a |
| §3 mobile useAgentRunPoll 切到 long-poll | T1b |
| §4 artifact ref 跳转（4 种 kind） | T2 |
| §5 Fix A jsonbOrNull 统一 | T3 |
| §5 Fix B AgentRunCard 模型名去重 | T2（顺带，跟 ArtifactBlock 一起改） |
| §6 youtube_transcript | T4 |
| §9 验收 1（实时性 <200ms）| T1b（手测） |
| §9 验收 2（jitter 落 [20000,30000]）| T1a t5 |
| §9 验收 3（heartbeat）| T1a 测试通过即间接验证（实现有 setInterval）；手测进一步确认 |

**No placeholders 扫描**：每个 step 都有完整代码 / 完整命令 / 完整测试。

**类型一致性**：
- `LongPollBatch` 在 T1b agentApi.ts 和 useAgentRunPoll.ts 引用一致
- `jsonbOrNull` 仅在 store.ts 内部使用，签名 `<T>(v: T | null | undefined): string | null | undefined`
- `extractVideoId` 在 youtubeTranscript.ts 内部 helper
- 所有 commit message 标 M6 t<N> 前缀，方便后续 review filter

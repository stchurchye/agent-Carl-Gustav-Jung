import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getPool } from '../db/client.js';
import * as store from '../lib/agent/store.js';
import { cancelRun, createAgentRun, resumeAgentRun } from '../lib/agent/runtime.js';
import { TERMINAL_RUN_STATUSES, type AgentRun, type AgentRunStatus } from '../lib/agent/types.js';
import * as topicSkills from '../lib/agent/topicSkills.js';
import {
  emitNotice,
  listNoticesAfter,
  listNoticesForRun,
} from '../lib/agent/notices.js';
import { agentHookBus } from '../lib/agent/hooks.js';
import type { AgentHookEvent } from '../lib/agent/hooks.js';
import { resolveHoldMs } from '../lib/agent/longPollJitter.js';

export const agentRouter = new Hono<{ Variables: AppVariables }>();

agentRouter.use('*', requireAuth);

/**
 * S2：给客户端的 run 序列化 —— 剥掉 `contextCheckpoint`（内部 compaction 状态，
 * 随 run 累积增大，客户端不消费；避免每次轮询下发数 KB 冗余 + 不泄漏内部状态）。
 */
export function runForClient(
  run: AgentRun | null,
): Omit<AgentRun, 'contextCheckpoint'> | null {
  if (!run) return null;
  const { contextCheckpoint: _omit, ...rest } = run;
  return rest;
}

/**
 * 私聊：仅 owner 可访问。群聊：owner 或群成员可访问（任意成员可看/取消，对齐 spec §8.5 + AC2）。
 * Exported for unit tests (T12).
 */
export async function canAccessRun(run: AgentRun, userId: string): Promise<boolean> {
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

/**
 * M7 T6d：群聊 ask_user resume 权限。比 canAccessRun 更严：
 *   - 私聊：仅 owner
 *   - 群聊 owner：永远可答（隐式最高权限）
 *   - 群聊其他人：必须先是群成员，再满足任一：是 askUserTargetUserId，或 openedForAll 已生效
 *   - 非群成员：永远不可答（即便 target 被误设为非成员，也兜底拒绝）
 */
export async function canAnswerAskUser(run: AgentRun, userId: string): Promise<boolean> {
  if (run.channel !== 'group') return userId === run.ownerId;
  if (userId === run.ownerId) return true;
  // 严格：先 enforce 群成员身份，再看 target / openedForAll。
  const { rows } = await getPool().query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
    [run.groupId, userId],
  );
  if (rows.length === 0) return false;
  if (run.askUserTargetUserId && userId === run.askUserTargetUserId) return true;
  // openedForAllAt 由 worker 在 30s 后置为 NOW()，一旦非空即代表已开放。
  // 不和 JS new Date() 比大小 —— DB 时钟与进程时钟有偏移（实测 OrbStack PG 快 ~20ms）。
  if (run.askUserOpenedForAllAt) return true;
  return false;
}

/**
 * M1d Task 4：任务面板列表。按 owner=me 或 me 是 run.groupId 群成员过滤。
 * 可选 ?status= 过滤、?limit= 控量（默认 50，最大 100）。
 */
agentRouter.get('/runs', async (c) => {
  const userId = c.get('userId')!;
  const status = c.req.query('status');
  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Number(limitRaw) : 50;
  const runs = await store.listAgentRunsForUser(userId, {
    status: (status as AgentRunStatus) || undefined,
    limit,
  });
  // M1e task 7：列表 API 暴露 hasMore（runs.length === limit 即可能还有下一页）。
  // mobile 列表暂不渲染 load-more，但字段先备好，避免后续 schema 改动需要兼容老客户端。
  const hasMore = runs.length === limit;
  return c.json({
    ok: true,
    data: { runs: runs.map(runForClient), hasMore },
    requestId: c.get('requestId'),
  });
});

agentRouter.get('/runs/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const steps = await store.listSteps(id);
  // M1e task 2：附带 user-facing notice 列表（最新 20 条），UI 顶部 banner 展示
  const notices = await listNoticesForRun(id, { limit: 20 });
  return c.json({
    ok: true,
    data: { run: runForClient(run), steps, notices },
    requestId: c.get('requestId'),
  });
});

agentRouter.get('/runs/:id/stream', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);

  // M1d T16 + M1e task 2：SSE 断线重连，事件 id 走两个命名空间：
  //   step 事件   id = `s:${agent_steps.idx}`
  //   notice 事件 id = `n:${agent_event_logs.id}`
  // Last-Event-ID 重连时按前缀 dispatch。向后兼容：若收到裸数字（M1d 老客户端），
  // 按 step idx 处理；notice 全部从 0 重发（数量上限 20，可接受）。
  const lastEventHeader = c.req.header('last-event-id');
  const afterQuery = c.req.query('after');
  const resumeRaw = lastEventHeader ?? afterQuery ?? '';
  let resumeStepIdx = -1;
  let resumeNoticeId: string | null = null;
  if (resumeRaw.startsWith('s:')) {
    const n = Number(resumeRaw.slice(2));
    if (!Number.isNaN(n)) resumeStepIdx = n;
  } else if (resumeRaw.startsWith('n:')) {
    resumeNoticeId = resumeRaw.slice(2) || null;
  } else if (resumeRaw && !Number.isNaN(Number(resumeRaw))) {
    // M1d 老客户端：裸数字 = step idx
    resumeStepIdx = Number(resumeRaw);
  }

  return streamSSE(c, async (stream) => {
    let lastStepIdx = resumeStepIdx;
    let lastNoticeId: string | null = resumeNoticeId;
    let lastStatus = run.status;
    let alive = true;
    stream.onAbort(() => {
      alive = false;
    });

    while (alive) {
      const current = await store.getAgentRun(id);
      if (!current) break;
      const steps = await store.listSteps(id);
      const newSteps = steps.filter((s) => s.idx > lastStepIdx);
      for (const s of newSteps) {
        await stream.writeSSE({
          event: 'step',
          id: `s:${s.idx}`,
          data: JSON.stringify(s),
        });
        lastStepIdx = s.idx;
      }
      const newNotices = await listNoticesAfter(id, lastNoticeId);
      for (const n of newNotices) {
        await stream.writeSSE({
          event: 'notice',
          id: `n:${n.id}`,
          data: JSON.stringify(n),
        });
        lastNoticeId = n.id;
      }
      if (current.status !== lastStatus) {
        await stream.writeSSE({
          event: 'status',
          data: JSON.stringify({ status: current.status, runId: id }),
        });
        lastStatus = current.status;
      }
      const terminal =
        current.status === 'completed' ||
        current.status === 'failed' ||
        current.status === 'cancelled' ||
        current.status === 'budget_exhausted';
      if (terminal) {
        await stream.writeSSE({
          event: 'end',
          data: JSON.stringify({ runId: id, finalStatus: current.status }),
        });
        break;
      }
      await new Promise<void>((r) => setTimeout(r, 1_000));
    }
  });
});

/**
 * M6 T1a：增量 long-poll —— 替代 mobile 1.5s 全量轮询。
 *
 * 行为：
 *   1. 立刻 SELECT idx > after 的 step；有 → 立即 batch 返回 + close
 *   2. 无 → 进入 hold 模式：
 *      - subscribe agentHookBus；收到 step.recorded 或 run terminal → 立刻 batch + close
 *      - 启 idle timer (jitter 20-30s) → emit { type:'idle' } + close
 *      - 收集 { type:'heartbeat' } 行（每 15s 一次），随最终响应一起发出
 *   3. run 已 terminal → 直接 batch（含最新 run + hasMore=false）+ close
 *
 * 响应格式：application/x-ndjson（每行一个 JSON）。
 *
 * ⚠️  heartbeat 实现为"批量模式"：行在 hold 结束后随 batch/idle 一并发出，
 *   而非在 hold 期间逐行流式推送（流式需 ReadableStream，会破坏 Hono 测试同步等待）。
 *   hold 时长 20-30s < 典型 Nginx/ALB 60s idle timeout，代理切断风险低；
 *   如未来部署环境 idle timeout < 20s，须切换为 ReadableStream 实现。
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
  let after = -1;
  if (afterRaw !== undefined) {
    const n = Number(afterRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return jsonError(c, ErrorCodes.VALIDATION, 400);
    }
    after = n;
  }
  const holdMs = resolveHoldMs(c.req.query('_holdMs'));

  const toNdjsonResponse = (lines: unknown[]) => {
    const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    return c.body(body, 200, { 'content-type': 'application/x-ndjson' });
  };

  async function buildBatchLine(): Promise<unknown> {
    const latest = await store.getAgentRun(id);
    const steps = await store.listSteps(id);
    const newSteps = steps.filter((s) => s.idx > after);
    const notices = await listNoticesForRun(id, { limit: 20 });
    return { type: 'batch', run: runForClient(latest), steps: newSteps, notices, hasMore: false };
  }

  // Terminal → immediate batch
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    return toNdjsonResponse([await buildBatchLine()]);
  }

  // Immediate steps check
  const existing = await store.listSteps(id);
  const newExisting = existing.filter((s) => s.idx > after);
  if (newExisting.length > 0) {
    return toNdjsonResponse([await buildBatchLine()]);
  }

  // Hold mode: await event or timeout so app.fetch() also waits
  type HoldReason = 'step' | 'run' | 'idle';
  const holdLines: unknown[] = [];

  const reason = await new Promise<HoldReason>((resolve) => {
    let settled = false;
    let hbTimer: ReturnType<typeof setInterval>;
    let idleTimer: ReturnType<typeof setTimeout>;
    let unsubscribeRef: (() => void) | null = null;

    const settle = (r: HoldReason) => {
      if (settled) return;
      settled = true;
      clearInterval(hbTimer);
      clearTimeout(idleTimer);
      unsubscribeRef?.();
      resolve(r);
    };

    unsubscribeRef = agentHookBus.onEvent((event: AgentHookEvent) => {
      if (event.type === 'step.recorded' && event.runId === id) {
        settle('step');
      } else if (
        (event.type === 'run.completed' ||
          event.type === 'run.failed' ||
          event.type === 'run.cancelled' ||
          event.type === 'run.budget_exhausted') &&
        event.run.id === id
      ) {
        settle('run');
      } else if (
        // M7 T8：状态-only 变化也立即出 batch（出队 / ask_user 升级 / 追问入队 / 状态切换）。
        (event.type === 'run.status_changed' && event.run.id === id) ||
        (event.type === 'run.dequeued' && event.run.id === id) ||
        (event.type === 'ask_user.opened_for_all' && event.runId === id) ||
        (event.type === 'run.merged_input_appended' && event.runId === id)
      ) {
        settle('run');
      }
    });

    hbTimer = setInterval(() => {
      if (!settled) holdLines.push({ type: 'heartbeat', ts: Date.now() });
    }, HEARTBEAT_MS);

    idleTimer = setTimeout(() => settle('idle'), holdMs);
  });

  if (reason === 'idle') {
    const latest = await store.getAgentRun(id);
    holdLines.push({ type: 'idle', lastIdx: after, run: runForClient(latest) });
  } else {
    holdLines.push(await buildBatchLine());
  }
  return toNdjsonResponse(holdLines);
});

agentRouter.post('/runs/:id/cancel', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  await cancelRun(id, userId);
  return c.json({ ok: true, requestId: c.get('requestId') });
});

/**
 * M3 Task 3：用户回答 ask_user 问题，把 run 从 awaiting_user_input 恢复到 running。
 * - 403：非 owner（私聊 run 仅 owner 可 resume）
 * - 404：run 不存在
 * - 409：run 状态不是 awaiting_user_input
 * - 400：userInput 为空
 */
agentRouter.post('/runs/:id/resume', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  // M7 T6d：resume 用更严的 canAnswerAskUser（群聊 owner-lock / openedForAll / 成员校验）。
  if (!(await canAnswerAskUser(run, userId))) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  if (run.status !== 'awaiting_user_input') return jsonError(c, ErrorCodes.VALIDATION, 409);

  let body: { userInput?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // ignore parse errors, treat as empty body
  }
  const userInput = (body.userInput ?? '').trim();
  if (!userInput) return jsonError(c, ErrorCodes.VALIDATION, 400);

  try {
    const result = await resumeAgentRun({ runId: id, userInput });
    return c.json({ ok: true, data: { run: runForClient(result.run) }, requestId: c.get('requestId') });
  } catch {
    return jsonError(c, ErrorCodes.VALIDATION, 409);
  }
});

/**
 * M1d Task 3 + M1e Task 3/4：把一个终态 run 重跑——克隆 inputText / channel / budget /
 * sealed user key，创建一个新的 run（不复用旧 run id、不接续 step），返回新 runId。
 *
 * - 只允许 terminal 状态调用；非 terminal 状态返回 409。
 * - M1e blocker 1+3：复制旧 run 的 user_api_key_enc（如有），避免新 run 走 server key
 *   而旧 run 是 user key 的语义漂移。
 * - M1e blocker 2 (task 4)：10s 窗口去重，同 (ownerId, inputText) 已 retry 过则 409。
 */
agentRouter.post('/runs/:id/retry', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const isTerminal =
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'budget_exhausted';
  if (!isTerminal) return jsonError(c, ErrorCodes.VALIDATION, 409);

  // M1e Task 4：10s 窗口去重——如果过去 10s 内已经为同 (ownerId, inputText) 创建过另一个
  // run（excluding 旧 run 本身），返回 409 + 现有的 runId。前端依然 disable retry 按钮做
  // optimistic 防连点；这是后端最终防线（多设备 / 网络重试也兜得住）。
  const dedup = await getPool().query(
    `SELECT id FROM agent_runs
      WHERE owner_id = $1 AND md5(input_text) = md5($2) AND input_text = $2
        AND created_at > now() - interval '10 seconds'
        AND id <> $3
      ORDER BY created_at DESC LIMIT 1`,
    [run.ownerId, run.inputText, run.id],
  );
  if (dedup.rows.length > 0) {
    const existingRunId = dedup.rows[0].id as string;
    await emitNotice({
      runId: existingRunId,
      severity: 'info',
      code: 'RETRY_DEDUPED',
      message: '10 秒内已发起过同一任务的重试，已忽略本次。',
      context: { triggeredFromRunId: run.id },
    });
    return c.json(
      {
        ok: false,
        error: {
          code: 'AGENT_RETRY_DEDUPED',
          message: '10 秒内已重试过，请稍后再试。',
          existingRunId,
        },
        requestId: c.get('requestId'),
      },
      409,
    );
  }

  const result = await createAgentRun({
    ownerId: run.ownerId,
    channel: run.channel,
    sessionId: run.sessionId ?? undefined,
    groupId: run.groupId ?? undefined,
    topicId: run.topicId ?? undefined,
    inputText: run.inputText,
    apiKey: '',
    apiKeySource: run.apiKeySource,
    budget: run.budget,
    // M1e Task 11d / Task 12: retry 复用旧 run 的 provider+model 选型
    providerId: run.providerId,
    modelId: run.modelId,
  });

  // M1e blocker 1 + Task 11d：复制旧 run 的 sealed user keys（不止 DeepSeek，
  // 还有 ZenMux）。M1d 只做了 DeepSeek，会让 retry 的 zenmux run 静默降级到 server key。
  if (run.apiKeySource === 'user') {
    const oldDsSealed = await store.getUserApiKeyEnc(run.id);
    const oldZmSealed = await store.getUserZenmuxKeyEnc(run.id);
    if (oldDsSealed || oldZmSealed) {
      await getPool().query(
        `UPDATE agent_runs
            SET user_api_key_enc        = COALESCE($1, user_api_key_enc),
                user_zenmux_key_enc     = COALESCE($2, user_zenmux_key_enc)
          WHERE id = $3`,
        [oldDsSealed, oldZmSealed, result.run.id],
      );
    }
  }

  return c.json({
    ok: true,
    data: {
      runId: result.run.id,
      placeholderMessageId: result.placeholderMessageId,
      userMessageId: result.userMessageId,
    },
    requestId: c.get('requestId'),
  });
});

// --------- Approval / Steer (M1b-2) ---------

agentRouter.post('/runs/:id/approve', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const { approveRun } = await import('../lib/agent/approval.js');
  const ok = await approveRun(id, userId);
  return c.json({ ok, requestId: c.get('requestId') });
});

agentRouter.post('/runs/:id/deny', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const { denyRun } = await import('../lib/agent/approval.js');
  const ok = await denyRun(id, userId, body.reason);
  return c.json({ ok, requestId: c.get('requestId') });
});

agentRouter.post('/runs/:id/steer', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const body = await c.req
    .json<{ instruction?: string }>()
    .catch(() => ({}) as { instruction?: string });
  const instruction = body.instruction?.trim();
  if (!instruction) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const { steerRun } = await import('../lib/agent/steer.js');
  const res = await steerRun({
    runId: id,
    byUserId: userId,
    instruction,
  });
  return c.json({
    ok: res.accepted,
    reason: res.reason,
    requestId: c.get('requestId'),
  });
});

// --------- Topic skills CRUD (M1b-1) ---------

async function canManageGroupSkill(
  userId: string,
  groupId: string | null,
): Promise<boolean> {
  if (!groupId) return true;
  const { rows } = await getPool().query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
    [groupId, userId],
  );
  return rows.length > 0;
}

agentRouter.get('/skills', async (c) => {
  const userId = c.get('userId')!;
  const skills = await topicSkills.listOwnSkills(userId);
  return c.json({ ok: true, data: { skills }, requestId: c.get('requestId') });
});

agentRouter.post('/skills', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  const scope = body.scope as 'user' | 'group' | 'topic';
  const title = (body.title as string | undefined)?.trim();
  const content = (body.content as string | undefined)?.trim();
  if (!scope || !['user', 'group', 'topic'].includes(scope)) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (!title || !content) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  const groupId = (body.groupId as string | null) ?? null;
  const topicId = (body.topicId as string | null) ?? null;
  if ((scope === 'group' || scope === 'topic') && !groupId) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (scope === 'topic' && !topicId) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (!(await canManageGroupSkill(userId, groupId))) {
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  }
  try {
    const skill = await topicSkills.upsertSkill({
      id: body.id,
      scope,
      ownerId: scope === 'user' ? userId : userId,
      groupId,
      topicId,
      title,
      content,
      enabled: body.enabled !== false,
      updatedByUserId: userId,
    });
    return c.json({ ok: true, data: { skill }, requestId: c.get('requestId') });
  } catch (e) {
    if (e instanceof topicSkills.SkillValidationError) {
      return c.json(
        {
          ok: false,
          error: { code: ErrorCodes.VALIDATION, message: e.message },
          requestId: c.get('requestId'),
        },
        400,
      );
    }
    throw e;
  }
});

agentRouter.patch('/skills/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const existing = await topicSkills.getSkill(id);
  if (!existing) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canManageGroupSkill(userId, existing.groupId))) {
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  try {
    const skill = await topicSkills.upsertSkill({
      id,
      scope: existing.scope,
      ownerId: existing.ownerId,
      groupId: existing.groupId,
      topicId: existing.topicId,
      title: (body.title as string | undefined)?.trim() || existing.title,
      content: (body.content as string | undefined)?.trim() || existing.content,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : existing.enabled,
      updatedByUserId: userId,
      // 保留来源:否则 upsert ON CONFLICT 会把 auto_distilled 的 source/source_run_id 抹成 null
      // → 启用建议技能后从评审屏消失 + 破坏 hasDistilledSkillForRun 幂等(crash 重蒸馏)。
      source: existing.source,
      sourceRunId: existing.sourceRunId,
    });
    return c.json({ ok: true, data: { skill }, requestId: c.get('requestId') });
  } catch (e) {
    if (e instanceof topicSkills.SkillValidationError) {
      return c.json(
        {
          ok: false,
          error: { code: ErrorCodes.VALIDATION, message: e.message },
          requestId: c.get('requestId'),
        },
        400,
      );
    }
    throw e;
  }
});

agentRouter.delete('/skills/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const existing = await topicSkills.getSkill(id);
  if (!existing) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canManageGroupSkill(userId, existing.groupId))) {
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  }
  await topicSkills.deleteSkill(id, userId);
  return c.json({ ok: true, requestId: c.get('requestId') });
});

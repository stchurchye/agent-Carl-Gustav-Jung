/**
 * 深度测试 S7 控制面驱动器(throwaway)—— ask_user / approval / steer 三种暂停-续跑闭环。
 * 用法: set -a; . repo/.env; DSK=<key> node src/scripts/deep-test-s7-driver.mjs
 * 产物: /tmp/deep-test-S7.json(与 dialogue 驱动器同构:turns[] 含 steps/reply/status + controlAction)
 */
import { SignJWT } from 'jose';
import pg from 'pg';

const API = 'http://127.0.0.1:3922';
const USER = '3aebc885-7200-43cc-a409-a02f58a46b71';
const SESSION = '3ac88960-d10c-42cb-81ba-94d882af7e0f';
const DSK = process.env.DSK || '';
const MODEL = process.env.DS_MODEL || 'deepseek-chat';

const FLOWS = [
  { key: 'ask_user', text: '帮我分析一下。', resume: '就从焦虑和原生家庭这两个角度,分析我最近总是回避社交。' },
  // 用 URL 归档触发 magi_content_ingest(approvalMode='ask')的审批门;个人事实话术走 auto 记忆工具不会 gate。
  { key: 'approval_approve', text: '帮我把这个页面归档进我的知识库:https://en.wikipedia.org/wiki/Shadow_(psychology)', action: 'approve' },
  { key: 'approval_deny', text: '把这个链接存进我的长期知识库:https://en.wikipedia.org/wiki/Synchronicity', action: 'deny', reason: '我再想想,先别存' },
  { key: 'steer', text: '详细讲讲荣格的个体化(individuation)过程,分阶段展开,越细越好。', steer: '换个方向——别讲个体化了,重点改讲共时性(synchronicity)和它的科学争议。' },
];

const secret = new TextEncoder().encode(process.env.JWT_SECRET.trim());
const jwt = () => new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
  .setIssuer('xzz-api').setAudience('xzz-mobile').setSubject(USER).setExpirationTime('2h').sign(secret);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = ['completed', 'failed', 'cancelled', 'budget_exhausted'];

async function status(runId) {
  const r = await pool.query('select status, usage from agent_runs where id=$1', [runId]);
  return r.rows[0];
}
async function steps(runId) {
  const r = await pool.query(
    'select idx, kind, tool_name, input, output, tokens, duration_ms, error, created_at from agent_steps where run_id=$1 order by idx', [runId]);
  return r.rows;
}
async function finalReply(runId) {
  // 终稿:按 payload.agentRun.agentRunId 锁定本 run 自己的 assistant 消息 + status!=draft(已 finalize)。
  // 绕开按 created_at DESC 抓到 cancel placeholder(#1)/ask_user 反问(#2)/半成品(#5)的竞态。
  const r = await pool.query(
    "select payload->>'content' c from private_chat_messages where session_id=$1 and payload->'agentRun'->>'agentRunId'=$2 and coalesce(payload->'agentRun'->>'status','draft') <> 'draft' limit 1",
    [SESSION, runId]);
  return r.rows[0]?.c ?? null;
}
async function post(path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-ZenMux-Api-Key': DSK },
    body: JSON.stringify(body),
  });
  return { code: res.status, json: await res.json().catch(() => ({})) };
}

// returnOnAwaiting=true:「等预期门」——命中任何 awaiting 即返回,调用方判断是否预期(检测握手门)。
// 默认 false:「等终态」——只在终态返回,放行 awaiting,让 60s 自动 approve(low-cost)/deny→replan 跑到
//   终态被捕获(awaitingApprovalUntil=now+60s,在 48×4s=192s 预算内)。否则会抢在自动解除前 cancel,丢真终态。
async function pollUntil(runId, returnOnAwaiting = false) {
  for (let i = 0; i < 48; i++) {
    const st = await status(runId);
    if (!st) { await sleep(3000); continue; }
    if (TERMINAL.includes(st.status)) return st;
    if (returnOnAwaiting && st.status.startsWith('awaiting_')) return st;
    await sleep(4000);
  }
  return await status(runId);
}

async function driveFlow(token, idx, flow) {
  const ex = await post('/api/intent/execute', token, {
    text: flow.text, kind: 'agent_run', channel: 'private', sessionId: SESSION,
    agentOptions: { providerId: 'deepseek', modelId: MODEL },
  });
  const runId = ex.json?.data?.runId;
  if (!runId) return { idx, text: flow.text, controlAction: flow.key, error: `no runId ${JSON.stringify(ex.json).slice(0,150)}` };

  let note = '';
  if (flow.key === 'ask_user') {
    const st = await pollUntil(runId, true); // 等预期门:命中 awaiting 即返回
    if (st?.status === 'awaiting_user_input') {
      note = `→ 命中 awaiting_user_input,resume「${flow.resume.slice(0,20)}…」`;
      await post(`/api/agent/runs/${runId}/resume`, token, { userInput: flow.resume });
      await pollUntil(runId);
    } else note = `→ 未触发 ask_user(直接 ${st?.status});agent 没反问`;
  } else if (flow.key.startsWith('approval')) {
    const st = await pollUntil(runId, true); // 等预期门:命中 awaiting 即返回
    if (st?.status === 'awaiting_approval') {
      if (flow.action === 'approve') { note = '→ 命中 awaiting_approval,approve'; await post(`/api/agent/runs/${runId}/approve`, token, {}); }
      else { note = `→ 命中 awaiting_approval,deny(reason)`; await post(`/api/agent/runs/${runId}/deny`, token, { reason: flow.reason }); }
      await pollUntil(runId);
    } else note = `→ 未触发 approval(直接 ${st?.status});agent 没选审批门工具`;
  } else if (flow.key === 'steer') {
    // 等 run 进入「已有 plan」状态(running/replanning/awaiting_*)再插话:planning/queued/pending 期无 plan,
    // steer 会被拒 no_plan(steer.ts:39)。awaiting_* 也已有 plan、可 steer,故一并 break(否则白等满 30s)。
    let st = null;
    for (let i = 0; i < 20; i++) {
      st = await status(runId);
      if (!st) { await sleep(1500); continue; }
      if (TERMINAL.includes(st.status)) break;
      if (st.status === 'running' || st.status === 'replanning' || st.status.startsWith('awaiting_')) break;
      await sleep(1500);
    }
    if (st && !TERMINAL.includes(st.status)) {
      // #4:steer 即使 HTTP 200 也可能 ok:false(run 已终态/无 plan)→ 看 json.ok(=res.accepted),别误报成功
      let r = await post(`/api/agent/runs/${runId}/steer`, token, { instruction: flow.steer });
      let accepted = r.code === 200 && r.json?.ok === true;
      // 窄竞态:replan 重 pickup 瞬间 status=running 但 plan 暂 null → no_plan。等 plan 落定重试一次(也兜慢 planning)。
      if (!accepted && r.json?.reason === 'no_plan') {
        await sleep(3000);
        const st2 = await status(runId);
        if (st2 && !TERMINAL.includes(st2.status)) {
          r = await post(`/api/agent/runs/${runId}/steer`, token, { instruction: flow.steer });
          accepted = r.code === 200 && r.json?.ok === true;
        }
      }
      note = `→ ${st.status} 时 steer [HTTP ${r.code} accepted=${accepted}${r.json?.reason ? ' reason=' + r.json.reason : ''}]`;
    } else note = `→ steer 来不及(run 已 ${st?.status})`;
    await pollUntil(runId);
  }
  // #3 兜底:任何分支收尾后若仍挂 awaiting_*(意外暂停 / 没命中预期门)→ cancel 释放,避免挂死 + 污染后续轮
  const pre = await status(runId);
  if (pre && pre.status?.startsWith('awaiting_')) {
    await post(`/api/agent/runs/${runId}/cancel`, token, {});
    note += ` [意外 ${pre.status}→已 cancel 释放]`;
    await pollUntil(runId);
  }
  const st = await status(runId);
  const sts = await steps(runId);
  const reply = await finalReply(runId); // #1/#2/#5:按 runId 取已 finalize 的本 run 终稿
  process.stderr.write(`  ${flow.key}: ${st?.status} | ${sts.length} steps ${note}\n`);
  return { idx, text: `[${flow.key}] ${flow.text}  ${note}`, controlAction: flow.key, runId, status: st?.status, usage: st?.usage, steps: sts, reply };
}

(async () => {
  const token = await jwt();
  process.stderr.write(`=== S7 控制面(${FLOWS.length} 流程, model=${MODEL}) ===\n`);
  const turns = [];
  for (let i = 0; i < FLOWS.length; i++) { turns.push(await driveFlow(token, i + 1, FLOWS[i])); await sleep(3000); }
  const out = { scenario: 'S7', title: '控制面:ask_user / approval / steer 暂停-续跑闭环', model: MODEL, ranAt: new Date().toISOString(), turns };
  (await import('fs')).writeFileSync('/tmp/deep-test-S7.json', JSON.stringify(out, null, 2));
  process.stderr.write('\n写入 /tmp/deep-test-S7.json\n');
  await pool.end();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

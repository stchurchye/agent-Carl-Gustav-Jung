/**
 * 深度 agent 测试驱动器(throwaway)—— 真 DeepSeek 自主跑,逐轮捕获全内部逻辑链。
 * 用法:set -a; . repo/.env; set +a;  DSK=<deepseek-key> SCENARIO=S1 node deep-test-driver.mjs
 * 产物:/tmp/deep-test-<SCENARIO>.json(逐轮:user 话术 + run 元 + agent_steps 全链 + 终稿 reply)
 */
import { SignJWT } from 'jose';
import pg from 'pg';

const API = 'http://127.0.0.1:3922';
const USER = '3aebc885-7200-43cc-a409-a02f58a46b71';
const SESSION = '3ac88960-d10c-42cb-81ba-94d882af7e0f';
const DSK = process.env.DSK || '';
const SCEN = process.env.SCENARIO || 'S1';
const MODEL = process.env.DS_MODEL || 'deepseek-chat';

const SCENARIOS = {
  S1: {
    title: '荣格理论深挖(阴影/原型/个体化/共时性)',
    turns: [
      '请深入讲讲荣格说的「阴影」(shadow):它和弗洛伊德的潜意识有什么本质区别?',
      '阴影整合具体分哪几个阶段?和单纯"压抑"有什么不同?',
      '有人说阴影就是弗洛伊德的潜意识,你怎么从理论上区分二者?',
      '有哪些实证研究支持原型(archetype)理论?给我具体出处。',
      '集体无意识这个概念是怎么提出来的?历史脉络讲讲。',
      '共时性(synchronicity)和因果关系到底怎么区分?它算科学概念吗?',
      '我总在深夜暴食,从荣格视角这算我的阴影吗?',
      '结合我开头问的阴影整合目标,我这个暴食的阴影具体该怎么整合?',
      '你前面讲的整合阶段,学界有没有反对或质疑的声音?',
      '给我一个本周可执行的、基于个体化的第一步。',
    ],
  },
  S5: {
    title: '记忆与矛盾(改口 + 长程回指 + 时序失效)',
    turns: [
      '我是 INFP,最在意阴影和自我成长,记一下。',
      '换个话题,最近读了本讲北欧旅行的书,你觉得旅行对心理状态有啥影响?',
      '再聊点别的,这周天气忽冷忽热,人会更容易情绪低落吗?',
      '说回心理学,内倾情感(Fi)主导的人,做决定时的典型卡点是什么?',
      '其实……我重新想了下,我可能更像 INFJ,不是 INFP。',
      '按我的人格类型,主导功能怎么影响我的决策方式?',
      '我前面到底说自己是什么类型?',
      '我说过我喜欢外向社交吗?',
    ],
  },
};

const secret = new TextEncoder().encode(process.env.JWT_SECRET.trim());
async function jwt() {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
    .setIssuer('xzz-api').setAudience('xzz-mobile').setSubject(USER)
    .setExpirationTime('2h').sign(secret);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runStatus(runId) {
  const r = await pool.query('select status, usage, model_id, created_at, ended_at from agent_runs where id=$1', [runId]);
  return r.rows[0];
}
async function steps(runId) {
  const r = await pool.query(
    "select idx, kind, tool_name, input, output, tokens, duration_ms, error, created_at from agent_steps where run_id=$1 order by idx",
    [runId],
  );
  return r.rows;
}
async function finalReply(runId) {
  // 终稿:按 payload.agentRun.agentRunId 锁定「本 run 自己的」assistant 消息(原地 update 的 placeholder),
  // 且要求 agentRun.status != 'draft'(已 finalize)。绕开按 created_at DESC 抓到 placeholder/反问/半成品的竞态(#1/#5)。
  const r = await pool.query(
    "select payload->>'content' as content from private_chat_messages where session_id=$1 and payload->'agentRun'->>'agentRunId'=$2 and coalesce(payload->'agentRun'->>'status','draft') <> 'draft' limit 1",
    [SESSION, runId],
  );
  return r.rows[0]?.content ?? null;
}

const TERMINAL = ['completed', 'failed', 'cancelled', 'budget_exhausted'];

async function driveTurn(token, idx, text) {
  const res = await fetch(`${API}/api/intent/execute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-ZenMux-Api-Key': DSK },
    body: JSON.stringify({
      text, kind: 'agent_run', channel: 'private', sessionId: SESSION,
      agentOptions: { providerId: 'deepseek', modelId: MODEL },
    }),
  });
  const j = await res.json();
  const runId = j?.data?.runId;
  if (!runId) return { idx, text, error: `no runId: ${JSON.stringify(j).slice(0, 200)}` };

  // 轮询到终态(最长 ~4 分钟)。放行 awaiting:对话轮本不该挂,但若意外撞低成本 approval 门,
  // 60s 后自动 approve→继续跑到终态会被捕获(而非提前 break 成半成品);真卡住(user_input 24h)则耗尽预算后由下方兜底 cancel。
  let st;
  for (let i = 0; i < 48; i++) {
    st = await runStatus(runId);
    if (st && TERMINAL.includes(st.status)) break;
    await sleep(5000);
  }
  // #3:轮询耗尽仍挂 awaiting_*(真卡住,如 user_input)→ cancel 释放,避免 run 挂死 + 污染后续轮(session 锁 / 合并窗)
  if (st && st.status?.startsWith('awaiting_')) {
    await fetch(`${API}/api/agent/runs/${runId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-ZenMux-Api-Key': DSK },
      body: '{}',
    }).catch(() => {});
    for (let i = 0; i < 12 && st && !TERMINAL.includes(st.status); i++) { await sleep(3000); st = await runStatus(runId); }
  }
  const sts = await steps(runId);
  const reply = await finalReply(runId);
  process.stderr.write(`  turn ${idx}: ${st?.status} | ${sts.length} steps | ${st?.usage?.tokens}tok ¥${st?.usage?.costCny} | ${st?.usage?.elapsedSeconds}s\n`);
  return {
    idx, text, runId, status: st?.status, usage: st?.usage, modelId: st?.model_id,
    steps: sts, reply,
  };
}

(async () => {
  const scen = SCENARIOS[SCEN];
  if (!scen) { console.error('unknown scenario', SCEN); process.exit(1); }
  const token = await jwt();
  process.stderr.write(`=== ${SCEN}: ${scen.title} (${scen.turns.length} 轮, model=${MODEL}) ===\n`);
  const turns = [];
  for (let i = 0; i < scen.turns.length; i++) {
    turns.push(await driveTurn(token, i + 1, scen.turns[i]));
    await sleep(3000); // 轮间留蒸馏/记忆时间
  }
  const out = { scenario: SCEN, title: scen.title, model: MODEL, ranAt: new Date().toISOString(), turns };
  const path = `/tmp/deep-test-${SCEN}.json`;
  (await import('fs')).writeFileSync(path, JSON.stringify(out, null, 2));
  process.stderr.write(`\n写入 ${path}\n`);
  await pool.end();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

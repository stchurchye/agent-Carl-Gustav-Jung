/**
 * M1e Task 11a SPIKE — 验证 DeepSeek + ZenMux 两端真接口的 3 个决策点
 *   1) response_format（JSON 输出）在两端是否支持
 *   2) modelId 命名规则
 *   3) signal/AbortController 透传可行性
 *
 * 运行：  cd apps/api && npx tsx src/scripts/llmSpike.ts
 * 前置：  .env 内 DEEPSEEK_API_KEY + ZENMUX_API_KEY 都已配置
 *
 * 完成后请把"决策记录"段贴回 plan §12.2 task 11b 头部。
 */
import { chatCompletionRaw } from '../lib/deepseek.js';
import { zenmuxChatFromMessages } from '../lib/zenmux.js';

type SpikeResult = {
  vendor: string;
  modelId: string;
  scenario: string;
  ok: boolean;
  ms: number;
  preview: string;
  error?: string;
};

const results: SpikeResult[] = [];

const STEP_TIMEOUT_MS = 30_000;

async function record(
  vendor: string,
  modelId: string,
  scenario: string,
  fn: () => Promise<string | { content: string }>,
) {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`step timeout > ${STEP_TIMEOUT_MS}ms`)), STEP_TIMEOUT_MS),
      ),
    ]);
    const content = typeof r === 'string' ? r : r.content;
    results.push({
      vendor,
      modelId,
      scenario,
      ok: true,
      ms: Date.now() - t0,
      preview: content.slice(0, 200),
    });
    console.log(`  ✅ ${vendor} ${modelId} ${scenario} ${Date.now() - t0}ms`);
  } catch (e) {
    results.push({
      vendor,
      modelId,
      scenario,
      ok: false,
      ms: Date.now() - t0,
      preview: '',
      error: e instanceof Error ? e.message : String(e),
    });
    console.log(`  ❌ ${vendor} ${modelId} ${scenario} ${Date.now() - t0}ms — ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim();
  const zmKey = process.env.ZENMUX_API_KEY?.trim();
  if (!dsKey) throw new Error('DEEPSEEK_API_KEY missing');
  if (!zmKey) throw new Error('ZENMUX_API_KEY missing');

  // ========== 1. Hello world ==========
  const helloMessages = [
    { role: 'user' as const, content: '只回复两个字符：ok' },
  ];

  // 注意：wrapper 默认走 DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro'，是 reasoning model
  // 必须给足 maxTokens（reasoning_tokens + content），否则 content 会空
  await record('deepseek', 'deepseek-v4-pro (reasoning)', 'hello (maxTokens=256)', async () =>
    chatCompletionRaw(dsKey, helloMessages, { temperature: 0, maxTokens: 256 }),
  );

  // kimi 强制 temperature=1（spike 第一轮发现的硬约束）
  await record('zenmux', 'moonshotai/kimi-k2.6', 'hello (temp=1 forced)', async () =>
    zenmuxChatFromMessages(zmKey, 'moonshotai/kimi-k2.6', helloMessages, {
      temperature: 1,
      maxTokens: 32,
    }),
  );

  await record('zenmux', 'anthropic/claude-sonnet-4.6', 'hello', async () =>
    zenmuxChatFromMessages(zmKey, 'anthropic/claude-sonnet-4.6', helloMessages, {
      temperature: 0,
      maxTokens: 32,
    }),
  );

  // ========== 2. JSON output via prompt ==========
  const jsonMessages = [
    {
      role: 'system' as const,
      content: '只输出严格 JSON，不要 markdown 围栏，不要解释。形如：{"answer":"ok"}',
    },
    { role: 'user' as const, content: '回 ok' },
  ];

  await record('deepseek', 'deepseek-v4-pro (reasoning)', 'json-prompt (mt=512)', async () =>
    chatCompletionRaw(dsKey, jsonMessages, { temperature: 0, maxTokens: 512 }),
  );

  await record('zenmux', 'moonshotai/kimi-k2.6', 'json-prompt (temp=1)', async () =>
    zenmuxChatFromMessages(zmKey, 'moonshotai/kimi-k2.6', jsonMessages, {
      temperature: 1,
      maxTokens: 64,
    }),
  );

  await record('zenmux', 'anthropic/claude-sonnet-4.6', 'json-prompt', async () =>
    zenmuxChatFromMessages(zmKey, 'anthropic/claude-sonnet-4.6', jsonMessages, {
      temperature: 0,
      maxTokens: 32,
    }),
  );

  // ========== 3. AbortSignal pass-through ==========
  // 当前 wrapper 不接 signal——这里手写一个会 abort 的 fetch 直连 DeepSeek，验证 fetch 是否真正中断
  {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${dsKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: '写一篇 2000 字关于秋天的散文' }],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });
      results.push({
        vendor: 'deepseek',
        modelId: 'deepseek-chat (raw fetch)',
        scenario: 'abort-200ms',
        ok: false,
        ms: Date.now() - t0,
        preview: `unexpected non-abort completion status=${res.status}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = /abort/i.test(msg) || (e as any)?.name === 'AbortError';
      results.push({
        vendor: 'deepseek',
        modelId: 'deepseek-chat (raw fetch)',
        scenario: 'abort-200ms',
        ok: aborted,
        ms: Date.now() - t0,
        preview: aborted ? `AbortError raised after ${Date.now() - t0}ms` : msg,
        error: aborted ? undefined : msg,
      });
    }
  }

  // ========== 输出汇总 ==========
  console.log('\n=== M1e Task 11a SPIKE Results ===\n');
  for (const r of results) {
    const mark = r.ok ? '✅' : '❌';
    console.log(
      `${mark} ${r.vendor.padEnd(8)} | ${r.modelId.padEnd(40)} | ${r.scenario.padEnd(14)} | ${String(r.ms).padStart(5)}ms`,
    );
    if (r.preview) console.log(`     preview: ${r.preview.replace(/\n/g, '\\n')}`);
    if (r.error) console.log(`     error:   ${r.error}`);
  }
  console.log('\n=== 决策记录（写回 plan task 11b 头部）===');
  console.log('1) JSON 输出策略：见 json-prompt 行，是否两端都吐出合法 JSON');
  console.log('2) modelId 命名：ZenMux 用原生 vendor/model；DeepSeek 直连用 deepseek-chat 等');
  console.log('3) AbortSignal：见 abort-200ms 行，raw fetch 是否能 < 1s 内中断');
}

main().catch((e) => {
  console.error('spike failed', e);
  process.exit(1);
});

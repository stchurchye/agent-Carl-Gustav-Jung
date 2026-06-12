/** 活体验证(需真 key:DSK=sk-... 或 .env 的 DEEPSEEK_API_KEY):真 DeepSeek 跑 planner,验证双语检索指引产出中英两路查询。用法: DSK=<key> npx tsx src/scripts/probe-bilingual-planner.mts */
import { readFileSync } from 'node:fs';
// 仓库根 .env(脚本在 apps/api/src/scripts/,上溯 4 层),按 import.meta.url 解析以便任意机器/CI 运行
const env = readFileSync(new URL('../../../../.env', import.meta.url), 'utf8');
for (const line of env.split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }

const { buildLlmClient } = await import('../lib/llm/factory.js');
const { generatePlanWithLlm } = await import('../lib/agent/planner.js');
const { registerWebSearch } = await import('../lib/agent/tools/webSearch.js');
const { registerSearchPapers } = await import('../lib/agent/tools/searchPapers.js');
const { registerWikipedia } = await import('../lib/agent/tools/wikipedia.js');
const { registerFetchUrl } = await import('../lib/agent/tools/fetchUrl.js');

registerWebSearch(); registerSearchPapers(); registerWikipedia(); registerFetchUrl();

const llm = buildLlmClient({
  providerId: 'deepseek',
  modelId: 'deepseek-chat',
  apiKey: (process.env.DSK ?? process.env.DEEPSEEK_API_KEY)!,
});

const plan = await generatePlanWithLlm({
  inputText: '帮我深入研究荣格的共时性概念,有哪些学术依据和实证讨论?',
  snapshot: {
    systemPrompt: '',
    history: [],
    shortSummary: '私聊,无历史',
    usage: { usedTokens: 0, limitTokens: 0, breakdown: {} },
    source: { channel: 'private' },
  } as never,
  llm,
  signal: new AbortController().signal,
});

console.log('intentSummary:', plan.intentSummary);
for (const s of plan.steps) {
  console.log(`  step: ${s.toolName} ←`, JSON.stringify(s.input).slice(0, 120));
}
const queries = plan.steps.map((s) => JSON.stringify(s.input)).join(' ');
const hasZh = /[一-鿿]/.test(queries);
const hasEn = /"(query|title)":"[^"]*[A-Za-z]{4,}/.test(queries);
console.log(`\n双语检索: 中文query=${hasZh} 英文query=${hasEn} → ${hasZh && hasEn ? '✅ 达成' : '❌ 未达成'}`);

# Agent Runtime M2 设计文档 —— 严肃讨论 Agent 的工具生态

- 项目代号：`agent-runtime-m2`
- 日期：2026-05-21
- 状态：设计待用户复核 → writing-plans
- 关联：本文是 M1f 后的下一里程碑。前置是 `2026-05-20-agent-runtime-design.md`（基线）+ `2026-05-21-agent-runtime-m1f-design.md`（hardening 完成态）。

---

## 0. 产品定位重锚

M1a-M1f 把 agent runtime 当"通用写作辅助"在做。M2 起重新明确定位：

> **本 agent 是「心理学/经济学严肃讨论」的研究助手。**

核心使用者画像：用户希望和 agent 讨论行为经济学、认知偏差、社会心理学、宏观/微观经济学等议题，并依赖 agent 拉来**可引用的学术证据**和**可验证的计算/可视化结果**，而不是 LLM 凭直觉胡说。

这个 framing 决定了 M2 工具选型的优先级：
- 🔴 **学术论文检索** > 通用网搜：宁可看 OpenAlex 也别让 LLM 引一篇 medium 博客
- 🔴 **能跑真计量回归的代码沙箱** > 简单计算器：statsmodels / 面板回归是经济学讨论的硬通货
- 🔴 **自我批评/防胡说机制** > 多 tool 数量：心理学/经济学最容易"听上去对其实错"
- 🟡 **结构化数据源**（FRED 经济序列、维基百科条目）> 杂项工具
- 🟡 **概念图/流程图可视化**（mermaid）> 真生成图片

---

## 1. M2 范围

### 1.1 新增工具（8 个）

| # | 工具 | 后端 | 优先级 |
|---|------|------|--------|
| 1 | `run_python` | E2B Firecracker microVM | 🔴 P0 核心 |
| 2 | `search_papers` | OpenAlex 主 + Exa 备 | 🔴 P0 |
| 3 | `critique_last_answer` | LLM 反思（同 provider） | 🔴 P0 |
| 4 | `fetch_url` | Jina Reader (`r.jina.ai`) | 🟡 P1 替换 |
| 5 | `render_diagram` | Mermaid 字符串（mobile 渲染） | 🟡 P1 |
| 6 | `get_economic_series` | FRED + 备用 World Bank | 🟡 P1 |
| 7 | `wikipedia` | Wikipedia REST API | 🟡 P1 |
| 8 | `search_web` | 现有 `web_search` rename | 🟢 0 成本 |

### 1.2 现有工具的处置

| 工具 | M2 决策 |
|------|---------|
| `web_search` (Tavily) | rename 为 `search_web`（LLM-facing 名一致风格：search_*/fetch_*） |
| `url_fetch` (jsdom + readability) | 改名 `fetch_url`，**内部切换为 Jina Reader**（删 jsdom + readability 依赖，减 ~5MB） |
| `magi_system_read` | 保留 |
| `magi_content_ingest` | 保留 |
| `doc_export_markdown` | 保留 |
| `echo_after_sleep` | 保留（fixture/测试用） |

**M2 后 production tool 总数：6 现有（含 echo） + 8 新 - 2 rename 同名 = 12 个**。Planner prompt 中 tool block ~12 个项，token 仍可控。

### 1.3 Cross-cutting 改动

- **5 个新 API key**：E2B / Exa / FRED / Jina / OpenAlex（OpenAlex 无 key 但建议带 User-Agent header）
  - 全部走 M1d 立的 user-key 体系：env 配 server 兜底 + brain settings 可填个人 key 覆盖
- **Mobile mermaid 渲染组件**：新增消息类型 `diagram`，content 是 mermaid string，渲染走 `react-native-svg` + mermaid → SVG 的 web-render 方案
- **E2B sandbox 生命周期管理**：per-run 1 个常驻 sandbox，run 结束 kill
- **新 ReplyRef kind**：`paper`（学术论文）、`diagram`（mermaid 图）
- **新 ToolReplyMeta.summaryKind 值**：`code_output`（render stdout 摘录 + 是否有 stderr）

### 1.4 M2 **不**做（明确推迟）

| 项目 | 推到 | 理由 |
|------|------|------|
| `ask_user` 反问能力 | M3 | 需要新 `awaiting_user_reply` 状态机 + mobile UI；M1f 刚删 awaiting_confirm，此时复杂状态机回归代价高 |
| `deep_research` / subagent 派生 | M3 | 父子 run、预算传播、SSE 多路复用，是架构活 3-5 天 |
| `get_paper_citations` 引用网络 | M3 | OpenAlex 接口能拿到，但 UI 渲染引用关系需要图组件 |
| `youtube_transcript` | M3 / M4 | 非心理学/经济学核心场景；视频字幕类讨论低频 |
| `document_reader` PDF/Word/Excel | M3 / M4 | 用户上传文档 + 解析 = 文件上传链路改动；非 M2 核心 |
| `image_ocr` / `audio_transcribe` | M3 / M4 | 同上 |
| `doc_export_feishu` / `doc_export_pdf` | M3 / M4 | 输出侧后做 |
| MCP 官方 SDK 切换 | M3 / M4 | 跟 browser-use 一起切，避免改两次 |
| browser-use | M4 | Docker + Chromium，是单独里程碑 |
| 中文 native 内容抓取（公众号/B站） | 单独立项 | 反爬战，工程坑深 |

---

## 2. 每个新工具的设计

每个工具按 M1f Task 3 立的「`{ok, ...}` 软约定 + `replyMeta` + cancel signal 三件套」规范实现。下文 inputSchema / outputSchema 用 TypeScript 表达，落地时转 JSONSchema7。

### 2.1 `run_python`（E2B）

**核心能力**：跑任意 Python 代码，拿 stdout/stderr/结果。

```ts
type RunPythonInput = {
  code: string;                    // 必填，Python 源码
  description?: string;            // 可选，agent 说明本次跑这段代码的目的（critique gate 用）
};

type RunPythonOutput = {
  ok: boolean;
  stdout: string;                  // 截断 8KB
  stderr: string;                  // 截断 2KB
  result?: string;                 // 最后一个表达式的值（如有），text repr，截断 4KB
  error?: string;                  // 沙箱级 error（OOM / timeout / 启动失败）
};
```

**实现要点**：
- E2B SDK：`@e2b/code-interpreter`
- Per-run sandbox：首次 `python_run` 调用时 `Sandbox.create()`，sandbox ID 写到 `agent_run` 的某字段（新加 `sandbox_id TEXT NULL`）；同 run 后续调用走 `Sandbox.connect(sandboxId)`；run 结束（completed/failed/cancelled）时 `Sandbox.kill()`
- 超时：`timeoutMs: 30_000`（30s wall clock）
- 内存：默认 1GB（E2B 默认值）
- 取消：`signal: ctx.signal` 传入 SDK；E2B SDK 接收 AbortSignal
- 错误分类：
  - sandbox 启动失败 / OOM / timeout → `{ok: false, error}`
  - Python 内 exception → `{ok: true, stderr: '...traceback...', result: undefined}`（这是"代码有错"不是"工具有错"，让 LLM 看 stderr replan）
  - AbortError 透传
- 输入大小：限制 `code.length < 16KB`（防 LLM 把大 dataset 嵌进代码）

**replyMeta**：
```ts
{
  summaryKind: 'code_output',      // 新 kind：摘 stdout 头 + 是否 stderr
  failureHint: 'Python 代码执行失败：沙箱可能超时(30s)、超内存(1GB)、或代码本身报错。先看 stderr 找 Python exception 原因，改 code 重试；持续失败考虑改用其他工具（如 search_papers 拿现成数据）。',
}
```

**ApprovalMode**：`auto`（沙箱完整隔离，无副作用泄漏；E2B 计费会增加但每次 ~1 美厘可接受）

**Idempotent**：`false`（代码可能依赖网络/时间/随机数）

**SideEffects**：`true`（消耗 E2B compute 时间 = $$）

### 2.2 `search_papers`（OpenAlex 主 + Exa 备）

**核心能力**：学术论文检索。

```ts
type SearchPapersInput = {
  query: string;                   // 必填，自然语言查询（如 "prospect theory empirical evidence"）
  yearFrom?: number;               // 可选，过滤起始年份（默认无限制）
  topK?: number;                   // 1-20，默认 10
};

type Paper = {
  id: string;                      // OpenAlex Work ID（如 W123456789）或 Exa ID
  title: string;
  authors: string[];               // 截首 5 个
  year?: number;
  abstract?: string;               // 截 1000 字符
  doi?: string;
  url: string;                     // 论文 landing page
  citationCount?: number;
  source: 'openalex' | 'exa';     // 告知数据源
};

type SearchPapersOutput = {
  ok: boolean;
  papers: Paper[];
  fallbackUsed?: 'openalex_then_exa';  // 主源失败回退到备源时记录
  error?: string;
};
```

**实现要点**：
- 主源：OpenAlex `GET https://api.openalex.org/works?search={query}&filter=from_publication_date:{yearFrom}-01-01&per-page={topK}`
  - 无 API key，但 header 加 `User-Agent: agent-runtime-m2 (mailto:你的邮箱)` 以走"polite pool"（更快 + 优先级高）
- 备源：Exa `POST https://api.exa.ai/search` with `{ query, type: 'neural', category: 'research paper', numResults: topK }`
  - 需要 `EXA_API_KEY`
- 调用策略：先打 OpenAlex；HTTP 非 2xx 或返 0 条 → 自动 fallback 到 Exa；Exa 也挂 → `{ok: false}`
- `fallbackUsed` 字段告诉 LLM 主源失败（之后可能想改查询关键词）

**replyMeta**：
```ts
{
  summaryKind: 'list',
  extractRef: (out) => {
    const papers = (out as SearchPapersOutput).papers ?? [];
    // 每篇论文一个 ref，让 reply 渲染时能列出来
    // 这里实际返回单个 ref 不够 —— 需扩 extractRef 为 returning array OR
    // 把 multi-ref 摘到 reply 文本里。M2 决策：当前 extractRef 签名只返单个 ref，
    // multi-paper 列表用 summarizeStepOutput 在 reply 里渲染（list kind 已支持）。
    // 故此处 extractRef 保留为 null。
    return null;
  },
  failureHint: 'OpenAlex / Exa 都失败可能是网络或上游故障。可换关键词；如学术词不出结果可改 search_web 走通用搜索。',
}
```

> **注**：`paper` ref kind 在 M2 暂不引入（避免一次 search 返 10 篇时 ref 列表炸）；用 `summaryKind: 'list'` 在 reply 文本里列前 5 篇。如未来要详细 paper card UI，M3 加 `ReplyRef.kind = 'paper'`。

### 2.3 `critique_last_answer`

**核心能力**：让"批评者"角色 LLM 审视最近一步 agent 的输出，找问题。

```ts
type CritiqueLastAnswerInput = {
  targetStepIdx?: number;          // 可选，指定要批评的 step idx；默认取最近的 tool_call/observe step output
  focusAreas?: string[];           // 可选，指定关注角度（如 ['未引用论断', '过度自信', '逻辑跳跃']）
};

type CritiqueLastAnswerOutput = {
  ok: boolean;
  criticisms: Array<{
    severity: 'high' | 'medium' | 'low';
    category: string;              // 'unsupported_claim' | 'overconfident' | 'logical_jump' | 'factual_error' | 'other'
    description: string;
  }>;
  overallAssessment: string;       // 1-2 句总评
  shouldRevise: boolean;           // 严重问题数 ≥ 1 时为 true
  error?: string;
};
```

**实现要点**：
- 复用本 run 的 LLM client（同 provider/model，per-run 锁定）
- 系统 prompt：
  ```
  你是一个严谨的学术 critic。读取另一个 LLM 刚刚给出的回答 / 工具调用 / 推理，找出以下问题：
  - unsupported_claim：声明了什么没有引用支持
  - overconfident：用了"显然/必然/无疑"等过度自信表述
  - logical_jump：A→B 之间缺中间论证
  - factual_error：与已知事实矛盾
  返回严格 JSON。如无问题，criticisms 为空数组、shouldRevise: false。
  ```
- User prompt：拼"被批评的 step output" + "原 plan 的 intentSummary"
- 输出走 `parsePlannerJson` 类似的宽容 JSON 解析（复用 M1f Task 4 的 `extractJsonCandidate`）

**replyMeta**：
```ts
{
  summaryKind: 'silent',           // 批评结果不直接进 final reply（给 planner 用）
  failureHint: 'Critic LLM 调用失败常见原因：LLM 网络故障 / JSON 解析失败。可重试一次；持续失败跳过批评直接出 reply。',
}
```

**Planner 用法**（建议 prompt 中加约定）：
- 在"复杂论断 / 引用学术结论 / 数据驱动声明"后插一步 `critique_last_answer`
- 如 `shouldRevise: true` → planner 在新 plan 里加修正 step

**ApprovalMode**：`auto`（纯 LLM 调用无副作用）

**Idempotent**：`true`（同输入同 step → critic 结果稳定，可缓存）

### 2.4 `fetch_url`（Jina Reader 替代）

**核心能力**：抓任意 URL 的正文（markdown）。

```ts
type FetchUrlInput = {
  url: string;                     // 必填，http(s):// URL
};

type FetchUrlOutput = {
  ok: boolean;
  url: string;
  title: string;                   // Jina 抽取的页面标题
  content: string;                 // markdown 正文，截 24KB
  truncated: boolean;
  error?: string;
};
```

**实现要点**：
- `fetch('https://r.jina.ai/' + encodeURIComponent(url), { headers: { 'X-With-Links-Summary': 'true', ...(jinaKey ? { Authorization: \`Bearer ${jinaKey}\` } : {}) }, signal: ctx.signal })`
- Jina 返回直接是 markdown 文本（无需 readability 后处理）
- 大小限制：response > 1MB 截断
- key 管理：
  - 无 key 走免费 tier（IP-rate-limit ~每秒几个请求；对你单产品并发够）
  - 有 key 走 1M tokens/月免费 quota
- 错误分类：
  - HTTP 非 2xx → `{ok: false, error: 'HTTP {status}'}`
  - 网络错误 → `{ok: false, error: msg}`
  - AbortError 透传

**replyMeta**：（沿用 `url_fetch` 现状，但加 url ref）
```ts
{
  summaryKind: 'text',
  extractRef: (out) => {
    const o = out as FetchUrlOutput;
    if (!o.ok || !o.url) return null;
    return { kind: 'url', id: o.url, label: o.title || o.url };
  },
  failureHint: '该 URL 可能 404 / 超时 / 内容是 PDF/视频等非文本。可跳过此 URL 用其他搜索结果；学术 PDF 改用 search_papers 拿 abstract。',
}
```

### 2.5 `render_diagram`（Mermaid）

**核心能力**：让 agent 生成概念关系图/流程图/因果图，前端渲染。

```ts
type RenderDiagramInput = {
  mermaid: string;                 // 必填，mermaid 源码，<8KB
  title: string;                   // 必填，图的标题（中文 OK）
};

type RenderDiagramOutput = {
  ok: boolean;
  diagramId: string;               // 新生成的 diagram message id
  title: string;
  validationWarnings: string[];    // mermaid 语法警告（如能预检），不致命
  error?: string;
};
```

**实现要点**：
- 后端工具只做：写一条 `messages` 表的新行（type='diagram', content=mermaid, meta={title}），返 diagram message id
- **不**在后端跑 mermaid 渲染（避免装 mermaid-cli + headless browser）
- Mobile 端：装 `react-native-svg` + 集成 mermaid → SVG 的方案（评估 `react-native-mermaid` 或 `mermaid-svg` js 库 + WebView fallback）
- 后端做轻量语法预检：检查首行是否合法 mermaid 关键字（`graph TD` / `flowchart` / `sequenceDiagram` / 等）；不通过给 warning 不致命

**replyMeta**：
```ts
{
  summaryKind: 'silent',           // 不进 final reply 文本
  extractRef: (out) => {
    const o = out as RenderDiagramOutput;
    if (!o.diagramId) return null;
    return { kind: 'diagram', id: o.diagramId, label: o.title };
  },
  failureHint: 'mermaid 渲染失败一般是语法错误。检查 validationWarnings；常见错：标签里有特殊字符（用 [] 引号包），或方向声明缺失（graph TD 开头）。',
}
```

**新 ReplyRef kind: `diagram`**（M2 新引入）。

**ApprovalMode**：`auto`（只是写一条消息，无外部副作用）

### 2.6 `get_economic_series`（FRED）

**核心能力**：从美联储 FRED 数据库拉宏观经济时间序列。

```ts
type GetEconomicSeriesInput = {
  seriesId: string;                // 必填，FRED series ID（如 'UNRATE' 失业率、'CPIAUCSL' CPI、'GDP' GDP）
  startDate?: string;              // YYYY-MM-DD，默认 '2000-01-01'
  endDate?: string;                // YYYY-MM-DD，默认今天
};

type GetEconomicSeriesOutput = {
  ok: boolean;
  seriesId: string;
  title: string;                   // FRED 给的系列标题
  units: string;                   // 单位（如 "Percent"、"Index 1982-84=100"）
  frequency: string;               // 'Monthly' / 'Quarterly' / 'Annual'
  observations: Array<{ date: string; value: number | null }>;  // 截 200 条
  truncated: boolean;
  error?: string;
};
```

**实现要点**：
- `fetch('https://api.stlouisfed.org/fred/series/observations?series_id={seriesId}&observation_start={startDate}&observation_end={endDate}&api_key={key}&file_type=json')`
- 需要 `FRED_API_KEY`（注册免费）
- 也调一次 `/fred/series?series_id={seriesId}` 拿 metadata（title/units/frequency）
- 200 条上限避免一次拉 100 年月度数据塞爆 prompt；多则截尾返 `truncated: true`，让 planner 缩 date range 重试
- 备用方案（明确不在 M2）：World Bank API（如 FRED 失败可 fallback），M2 不实现以省时

**replyMeta**：
```ts
{
  summaryKind: 'text',
  failureHint: 'FRED 失败常见：seriesId 不存在（如把"CPI"当 id，正确是"CPIAUCSL"）/ API key 缺失 / quota。可先 search_web 查 series ID 再调；persistent 失败让用户手动确认。',
}
```

**配合 run_python**：典型用法是 `get_economic_series('UNRATE')` → 拿到 observations → `run_python` 把数据画图 / 跑回归。

### 2.7 `wikipedia`

**核心能力**：维基百科条目查询。

```ts
type WikipediaInput = {
  title: string;                   // 必填，词条标题（如 "Prospect theory"、"行为经济学"）
  lang?: 'en' | 'zh' | 'ja' | string;  // 默认根据 query 自动判断（含中文走 zh）
  section?: 'summary' | 'full';   // 'summary' = 摘要段；'full' = 全文（截 16KB）
};

type WikipediaOutput = {
  ok: boolean;
  title: string;
  lang: string;
  summary: string;                 // 总是有，截 2KB
  fullText?: string;               // section='full' 时返回
  url: string;                     // wiki 条目 URL
  pageId: number;
  error?: string;
};
```

**实现要点**：
- Summary 接口：`https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}`
- Full 接口：`https://{lang}.wikipedia.org/w/api.php?action=parse&page={title}&prop=text&format=json`
- 无 key
- 404 → `{ok: false, error: 'page not found: {title}'}`
- 自动语言判断：title 含 CJK → lang='zh'，否则 'en'

**replyMeta**：
```ts
{
  summaryKind: 'text',
  extractRef: (out) => {
    const o = out as WikipediaOutput;
    if (!o.url) return null;
    return { kind: 'url', id: o.url, label: `Wikipedia: ${o.title}` };
  },
  failureHint: 'Wikipedia 失败可能是词条不存在 / 标题拼写错。可改 search_web 找正确标题再调；中文词条不全时 fallback en lang。',
}
```

### 2.8 `search_web`（rename）

**核心能力**：等同当前 `web_search`（Tavily），仅工具名改为 `search_web` 以与 `search_papers` 保持命名风格一致。

实现：把当前 `web_search` 工具的 `name` 字段从 `'web_search'` 改为 `'search_web'`，其余内部不动。所有 caller（intentExecute / 测试）grep + 替换。

---

## 3. Cross-cutting 改动

### 3.1 E2B Sandbox 生命周期

**问题**：E2B sandbox 启动 1-2s，但 agent run 内可能多次调 `run_python`。每次都新建 sandbox = 浪费 + 状态丢失。

**方案**：per-run 一个常驻 sandbox。

DB 改动：`agent_runs` 表加 `sandbox_id TEXT NULL`（M2 migration `016_agent_run_sandbox.sql`）。

```
run 开始 → sandbox_id = NULL
首次调 run_python → Sandbox.create() → 写 sandbox_id 到 DB → 跑代码
后续调 run_python → 读 DB 拿 sandbox_id → Sandbox.connect(sandboxId) → 跑代码（变量保留）
run 终态（completed/failed/cancelled）→ Sandbox.kill(sandboxId) → 清 DB 字段
```

**崩溃恢复**：worker crash 后 sandbox 不会自动 kill（E2B 默认 5min 闲置回收）。worker pickup 时如果 run 已是终态 → 调 `Sandbox.kill()` 兜底；如未终态 → 走 reclaim 路径继续用旧 sandbox。

**取消**：cancelRun → 标 status='cancelled' → 工具 abort → finally kill sandbox。

**Cost**：sandbox 闲置不计费（E2B 按 active compute time 计费），所以 run 长时间无 python 调用也不烧钱。

### 3.2 5 个新 API key 管理

| Key | 必需？ | 走 user-key 体系？ | 默认 env var |
|-----|--------|---------------------|--------------|
| `E2B_API_KEY` | 必需（无 key 无法 sandbox） | ✅ 双轨 | `E2B_API_KEY` |
| `EXA_API_KEY` | 备源，无 key 跳过备源 | ✅ 双轨 | `EXA_API_KEY` |
| `FRED_API_KEY` | 必需 | ✅ 双轨 | `FRED_API_KEY` |
| `JINA_API_KEY` | 可选（无 key 走 IP-rate-limit 免费 tier） | ✅ 双轨 | `JINA_API_KEY` |
| OpenAlex User-Agent | 推荐 | ❌ 全局 env | `OPENALEX_USER_AGENT="agent-runtime-m2 (mailto:你的邮箱)"` |

**user-key 体系复用**：M1d 已立 `userDeepseekKey` / `userZenmuxKey` 机制。M2 在 `agent_runs` 表加 5 个 `_enc` 列（或重新设计为单个 JSONB `user_api_keys_enc`），存加密后的 user-provided keys。

**架构 ADR**：新加单字段 `user_api_keys_enc JSONB` 容纳所有 user-provided keys（按 service name 索引），未来加 key 不再扩列。

```sql
-- migration 016_agent_run_user_keys.sql
ALTER TABLE agent_runs ADD COLUMN sandbox_id TEXT NULL;
ALTER TABLE agent_runs ADD COLUMN user_api_keys_enc JSONB NOT NULL DEFAULT '{}'::jsonb;
-- 老 user_deepseek_key_enc / user_zenmux_key_enc 列保留兼容；新工具走 user_api_keys_enc
-- M3 可以做迁移合并（数据迁移 + 删老列），M2 不做
```

### 3.3 Mobile mermaid 渲染组件

**新消息类型**：`type='diagram'`，content 是 mermaid string，meta 含 `{title: string}`。

**Mobile 渲染策略**（待 mobile 工程细节，M2 实施时定）：
- **方案 A**：纯 RN —— `react-native-svg` + 引入轻量 mermaid → SVG JS 转换（如 `mermaid-mini`）
- **方案 B**：WebView 嵌官方 mermaid JS（重量级但兼容性最好）
- **方案 C**：后端预渲染 SVG，存 message meta，前端只展示 SVG

**默认选 A**，fallback B。具体在 plan 阶段决定。

**Render warning UX**：mermaid 语法错时给用户看占位 + "agent 生成的图有语法错误" 文案，不让 chat 卡住。

### 3.4 Tool catalog UI

12 个 tool 是 LLM-facing 的；用户在 brain settings 是否需要看到 / 启用/禁用某个工具？

**M2 决策**：**不做用户面工具开关**。所有 12 工具默认全开，由 planner LLM 自选。如未来用户提"我不想 agent 用 Wikipedia"再加 UI。

**理由**：YAGNI；工具开关是 UX 复杂度（弹窗、默认值、按 role 配置等）；当前用户不会主动管。

---

## 4. ADR（关键决策）

| ID | 决策 | 选择 | 拒绝的备选 |
|----|------|------|------------|
| ADR-1 | Code interpreter runtime | E2B Firecracker microVM | Pyodide（statsmodels 不支持，经济学场景 deal-breaker）、Modal（你不跑 GPU 不必要）、Docker 自建（你不想搞 infra） |
| ADR-2 | search_papers 数据源 | OpenAlex 主 + Exa 备 | 单 OpenAlex（去掉 fallback 简化）、单 Exa（付费且偏新闻博客）、Semantic Scholar（rate limit 严，100 req/5min） |
| ADR-3 | critique 实现位置 | 作为独立 tool `critique_last_answer`，planner 自决何时调 | 自动在每步后插（强制 = 烧钱 + 慢）、reply gen 阶段统一一次（来不及 replan） |
| ADR-4 | mermaid 渲染位置 | mobile 端 SVG 渲染 | 后端 headless chrome 渲染（重）、后端 mermaid → PNG（栅格化质量差） |
| ADR-5 | 5 个新 key 存储 | 新加单 `user_api_keys_enc JSONB` 列承载所有 | 每个 key 一个新列（M1d 老路；列爆炸） |
| ADR-6 | ask_user / subagent / 多文档读 / browser-use 是否 M2 | 全推 M3+ | 一锅做 = 4 周里程碑、容易烂尾 |
| ADR-7 | `web_search` 改名 `search_web` | 改，统一 `search_*` 命名 | 不改（保旧名）—— 但和 search_papers 不一致看着乱 |
| ADR-8 | `url_fetch` 改名 + 换内部 | 改名 `fetch_url` + Jina Reader | 仅换内部不改名（一致性差）、双轨保留两个 fetch 工具（LLM 选择困难） |
| ADR-9 | E2B sandbox 生命周期 | per-run 持久 + run 结束 kill | 每 tool call 新建（无状态、慢）、全局共享 sandbox（安全风险） |
| ADR-10 | mermaid diagram 进 ReplyRef | 新引入 `kind: 'diagram'` | 把 diagram 渲染嵌进 reply 文本（不可能，mermaid 是源码不是图） |

---

## 5. 数据流示例（典型场景）

**场景**：用户问"前景理论近 5 年实证支持如何？画一张支持/反对论文数对比图"

```
1. intent → agent_run（status=draft）
2. buildInitialPlan → LLM 生成 plan：
   step 1: search_papers({ query: "prospect theory empirical evidence", yearFrom: 2020, topK: 15 })
   step 2: run_python({ code: "papers = [...嵌入 step 1 结果]; ..." })  // 注：M2 不优化 prompt 膨胀
   step 3: render_diagram({ mermaid: "graph LR; A[支持]-->B[12 篇]; A-->C[反对 3 篇]", title: "前景理论实证统计" })
   step 4: critique_last_answer({ targetStepIdx: 2 })  // 检查"12 篇"这种数字声明
3. executeRun 跑 4 步
4. generateFinalReply → 拼 reply：
   - 文本：「找到 15 篇 2020+ 实证研究，其中...」（含 paper list 摘要）
   - 资源：[diagram] 前景理论实证统计 + [url] 论文链接 × 5
```

**典型失败 → replan 流程**（M1f 闭环验证）：
- step 2 `run_python` 报错（如 papers 数据格式不对，stderr 抛 KeyError）
- runtime 写 step.error
- critique gate（M1f）触发 shouldReplan
- applyReplanningIfNeeded 清 plan
- buildInitialPlan 再触发，previousFailure="step 2 KeyError on 'authors'"
- LLM 看到失败原因 → 新 plan 改用 `len(papers)` 不依赖具体字段

---

## 6. 测试矩阵

| 工具 | 测试用例 |
|------|----------|
| `run_python` | happy path → ok:true + stdout；Python 语法错 → ok:true + stderr 含 SyntaxError；timeout → ok:false + error='timeout'；OOM → ok:false + error='oom'；AbortError 透传；sandbox 跨 step 状态保留（var x = 1 后续 step `print(x)` 输出 1） |
| `search_papers` | OpenAlex happy → ok:true + papers≥1；OpenAlex 5xx → fallback Exa → ok:true + fallbackUsed='openalex_then_exa'；两源都挂 → ok:false |
| `critique_last_answer` | criticisms 非空 → shouldRevise:true；LLM JSON 解析失败 → 走 extractJsonCandidate 兜底；critic LLM 网络错 → ok:false |
| `fetch_url` | Jina 200 → ok:true + content；Jina 404 → ok:false + error 含 'HTTP 404'；超 1MB → truncated:true；AbortError 透传 |
| `render_diagram` | 合法 mermaid → ok:true + diagramId；非法首行 → ok:true + validationWarnings 非空（不致命）；diagram message 真写入 DB |
| `get_economic_series` | UNRATE happy → ok:true + observations≥1；不存在 series → ok:false；observations > 200 → truncated:true |
| `wikipedia` | summary happy → ok:true + summary 非空；不存在条目 → ok:false |
| Cross-cutting | sandbox per-run lifecycle：run end → sandbox kill；user_api_keys_enc 加密 / 解密 roundtrip；mermaid message 类型在 mobile 能渲染（视集成方案） |

回归测试：M1f 现有 310 tests 全部通过；新加估 30-40 tests，目标 M2 end ≥340 tests。

---

## 7. 实施里程碑（拆 6 个 task）

| Task | 内容 | 估时 |
|------|------|------|
| **T1** | E2B 集成 + `run_python` 工具 + sandbox 生命周期管理 + DB migration 016 | 2 天 |
| **T2** | `search_papers`（OpenAlex 主 + Exa 备）+ user-key 体系扩 JSONB | 1.5 天 |
| **T3** | `critique_last_answer` + planner prompt 加 "复杂论断后插 critique" 约定 | 0.5 天 |
| **T4** | `fetch_url`（Jina）+ 删 jsdom/readability 依赖 + `search_web` rename | 1 天 |
| **T5** | `render_diagram`（后端工具 + mobile 端 mermaid 渲染组件 + 新 ReplyRef kind） | 1.5 天 |
| **T6** | `get_economic_series` + `wikipedia` + 4 个新 key 接入 settings UI | 1 天 |
| **T7** | code-reviewer + merge + tag v0.m2 | 0.5 天 |
| **合计** | | **~8 天** |

---

## 8. 验收标准

- [ ] M1f 310 tests 全绿 + M2 新增 30-40 tests 全绿
- [ ] 12 个工具按 M1f 三件套约定实现（`{ok}` schema、replyMeta、cancel signal）
- [ ] E2B sandbox per-run lifecycle 含崩溃恢复测试
- [ ] 5 个新 key 全走 user_api_keys_enc JSONB；brain settings 能填能改
- [ ] mobile 能渲染 mermaid diagram
- [ ] `critique_last_answer` 在 e2e 测试中能真触发 shouldReplan
- [ ] `npm run lint` clean（M1f #5 接入的 lint 规则覆盖新工具的 fetch signal）
- [ ] `tsc --noEmit -p apps/api` + `tsc --noEmit -p apps/mobile` 双 clean

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| E2B 第三方依赖宕机 | run_python 失效 | 工具按 `{ok: false}` 软失败；planner 回退到"基于 LLM 直觉给答案 + 标注"未验证"" |
| Jina Reader 限流（无 key） | fetch_url 失败率高 | M2 上线时同时配 JINA_API_KEY 走免费 1M tokens/月 |
| OpenAlex 无 key 限速 | search_papers 慢 | 加 User-Agent header 走 polite pool；如限速严重 M3 加 EXA_API_KEY 配额迁主 |
| mermaid mobile 渲染兼容性 | diagram 渲染白屏 | 方案 A 失败 fallback 方案 B（WebView 嵌官方 mermaid） |
| `critique_last_answer` 烧 token | run cost 2x | planner prompt 明确"仅在复杂论断后用"；M3 可加用户配置阈值 |
| code interpreter 烧钱失控（恶意 LLM 写死循环） | E2B 单 run 数 $ | 30s wall clock 硬限制；M3 加用户 monthly budget cap |

---

## 10. 与后续里程碑的衔接

| 里程碑 | 内容 |
|--------|------|
| **M3 严肃讨论 v2** | `ask_user` 反问 + `deep_research`/subagent + `get_paper_citations` + critique 自动化（不用 planner 触发） |
| **M4 内容多模态** | `document_reader`（PDF/Word/Excel）+ `image_ocr` + `audio_transcribe` |
| **M5 输出生态** | `doc_export_feishu` + `doc_export_pdf` + browser-use + MCP 切官方 SDK |
| **B 子项目（群聊并发）** | M2 不影响；M3+ 加 `topic_locks` |

---

## 11. 自查（writing-plans skill 要求）

| 检查项 | 状态 |
|--------|------|
| 占位符扫描（TBD/TODO） | ✅ 无 |
| 内部一致性 | ✅ ADR 与各 section 不矛盾 |
| 范围聚焦（单 plan 可实施） | ✅ 6 task / 8 天 / 12 工具，可控 |
| 歧义检查 | ✅ 所有 inputSchema / outputSchema 类型确定 |
| 与 M1f 不冲突 | ✅ 复用 `{ok}` schema / replyMeta / cancel signal / previousFailure / critique-replan loop |
| 命名一致性 | ✅ `search_*` / `fetch_*` / `run_*` / `get_*` / `render_*` / `critique_*` 风格统一 |

---

（本 spec 待用户复核 → 进入 writing-plans 阶段生成实现计划）

# Agent Runtime M2 — Tool Catalog 完整评估

- 日期：2026-05-21
- 状态：tool 选型讨论文档（输入材料，最终结论会更新到 `2026-05-21-agent-runtime-m2-design.md`）
- 产品定位：**心理学/经济学严肃讨论 agent**
- 砍除原则："YouTube 这种" niche / 低 ROI / 与严肃讨论无关的工具一概不做

---

## 1. 评估方法

每个候选工具按 4 个维度评分，给出明确 verdict：

- **做什么**：一句话功能描述
- **推荐 backend**：具体技术选型（不写"看情况"）
- **钱**：月度成本估算
- **M2 verdict**：
  - ✅ **必要** — M2 必做
  - 🟡 **建议** — M2 加上更好，但砍了也能跑
  - 🔴 **M3+** — 架构活 / 复杂度高，本期不做
  - ❌ **不做** — 严肃讨论场景用不上 / 价值不抵成本

---

## 2. 完整 catalog（7 大类 ~35 工具）

### A. Search 类（找信息源）

| 工具 | 做什么 | 推荐 backend | 钱 | M2 verdict |
|------|--------|--------------|------|-----------|
| `search_web` | 通用网搜，时效话题 / 概念入门 / 新闻 | **Tavily**（已有，rename 自 `web_search`） | $30/mo 起，免费 1000/mo | ✅ **必要** |
| `search_papers` | 学术论文检索（理论名 / 人名 / 实证证据） | **OpenAlex 主 + CrossRef 备** | $0 全免费 | ✅ **必要** |
| ~~`search_news`~~ | 新闻专项 | NewsAPI / GDELT | $0-$$ | ❌ Tavily news mode 已涵盖 |
| ~~`search_reddit`~~ | Reddit 讨论 | Reddit API | $0 限流 | ❌ niche，反爬时不时挂 |
| ~~`search_twitter`~~ | Twitter/X | 官方 API | $$$ | ❌ API 变贵 + 反爬 |
| ~~`search_github`~~ | 代码仓库 | GitHub REST API | $0 | ❌ M4 dev 场景再说 |
| ~~`search_scholar`~~ | Google Scholar | 反爬（无官方 API） | — | ❌ 不可靠 |

### B. Read 类（读已知 URL / 文件）

| 工具 | 做什么 | 推荐 backend | 钱 | M2 verdict |
|------|--------|--------------|------|-----------|
| `fetch_url` | 抓任意 URL → markdown | **Jina Reader** (`r.jina.ai/`) — 替换 jsdom+readability | 无 key 限流；带 key 1M tokens/mo 免费 | ✅ **必要**（替换升级） |
| `document_reader` | 读 PDF / Word / Excel URL | **pdf-parse + mammoth + xlsx**（3 库 dispatch） | $0 | 🟡 **建议**（你 4:56 重新问，说明真要） |
| ~~`youtube_transcript`~~ | YouTube 字幕 | youtube-transcript npm | $0 | ❌ **你明说不要** |
| ~~`image_ocr`~~ | 图片文字识别 | Tesseract.js WASM / vision LLM | $0 / $$ | ❌ M3/M4 |
| ~~`audio_transcribe`~~ | 音频转文字 | Whisper API | $0.006/分钟 | ❌ M3/M4 |
| ~~`fetch_url_browser`~~ | 重 JS 渲染页（用 headless chrome） | Browserless / Puppeteer | $$$ infra | ❌ Jina Reader 已经能跑大部分 SPA |

### C. Compute 类（计算 / 分析）

| 工具 | 做什么 | 推荐 backend | 钱 | M2 verdict |
|------|--------|--------------|------|-----------|
| `run_python` | Python 沙箱（计算/画图/回归/统计） | **E2B Firecracker microVM**（完整 PyPI + statsmodels + scipy + pandas + matplotlib） | $10-30/mo 你规模 | ✅ **必要**（核心能力跃迁） |
| ~~`run_js`~~ | JS/TS 沙箱 | Deno --allow-* | — | ❌ Python 涵盖 |
| ~~`run_sql`~~ | SQL 查询 | 嵌入 SQLite / 外接 DB | — | ❌ 你不查 DB |
| ~~`solve_math`~~ | 符号数学 / 微积分 | Wolfram Alpha API | $0 限流 / $$$ | ❌ run_python + sympy 涵盖 |
| ~~`run_r`~~ | R 统计 | rserve / Docker | — | ❌ Python statsmodels 90% 涵盖 R 计量需求 |

### D. 结构化数据源（直接 query，不靠 search 找 URL）

| 工具 | 做什么 | 推荐 backend | 钱 | M2 verdict |
|------|--------|--------------|------|-----------|
| `wikipedia` | 维基条目（标题/摘要/全文） | Wikipedia REST API | $0 | 🟡 **建议**（0.5 天，概念入门） |
| `get_economic_series` | 宏观经济时序（GDP/CPI/失业率） | **FRED 主 + World Bank 备** | $0 + 免费 key | ✅ **必要**（宏观讨论核心） |
| `get_paper_citations` | 一篇论文的引用网 | OpenAlex `/works/{id}/cited_by` | $0 | 🟡 **建议**（0.5 天，与 search_papers 同源） |
| `datetime_now` | 当前时间 / 时区 / 节假日 | 内置（无外部 API） | $0 | 🟡 **建议**（10 分钟活儿，LLM 总错日期） |
| ~~`stock_quote`~~ | 实时股价 | Alpha Vantage / Yahoo Finance | $0 限流 / $$ | ❌ run_python 跑 `yfinance` 涵盖 |
| ~~`weather_query`~~ | 天气 | OpenWeatherMap | 免费 1000/day | ❌ 你不讨论天气 |
| ~~`maps_places`~~ | 地图 / POI | Google Maps / 高德 | $$$ | ❌ 你场景无地理需求 |
| ~~`currency_rate`~~ | 汇率 | exchangerate-api | 免费 | ❌ run_python 涵盖 |
| ~~`crypto_price`~~ | 加密货币 | CoinGecko | 免费 | ❌ 不在场景 |

### E. Visual 输出

| 工具 | 做什么 | 推荐 backend | 钱 | M2 verdict |
|------|--------|--------------|------|-----------|
| `render_diagram` | Mermaid 概念图/流程图/因果图 | mobile 端 mermaid → SVG | $0 | ✅ **必要**（零成本高价值） |
| ~~markdown 表格~~ | 数据表 | M1 markdown 已支持 | — | ✅ **零工具**（run_python 输出 `df.to_markdown()`） |
| ~~`generate_image`~~ | AI 生图 | DALL-E / Imagen / Flux | $0.04-$0.1/张 | ❌ 严肃讨论用不上 |
| ~~`plotly_chart`~~ | 交互式图表 | run_python 输出 Plotly HTML | — | ❌ matplotlib 静态图够 |
| ~~`render_latex`~~ | LaTeX 公式渲染 | KaTeX (mobile) | $0 | 🟡 **建议但 M2 不做** — markdown 支持 `$\LaTeX$` 但 mobile 需要装 KaTeX RN 组件 |

### F. Agent 元能力（meta-tools）

| 工具 | 做什么 | 推荐 backend | 钱 | M2 verdict |
|------|--------|--------------|------|-----------|
| `critique_last_answer` | 批评者 LLM 审视上一步输出 | 同 run 的 LLM provider，换 system prompt | LLM token | ✅ **必要**（防胡说核心） |
| `query_memory` | agent 查自己历史记忆 / persona | 复用 memorySessionSearch | $0 | 🟡 **建议**（M1 memory 已有，agent 自查复用） |
| ~~`ask_user`~~ | 反问用户澄清 | 新 awaiting_user_reply 状态机 + mobile UI | $0 | 🔴 **M3**（M1f 刚删 awaiting_confirm，状态机回归代价高） |
| ~~`deep_research`~~ | 派子 agent 异步深挖 | 父子 run + 预算传播 + SSE 多路复用 | $0 | 🔴 **M3**（3-5 天纯架构） |
| ~~`schedule_followup`~~ | 定时任务 | cron / 自家调度 | $0 | 🔴 **M5+**（与 createAgentRun 解耦） |

### G. 写入 / 副作用（agent 产出落地）

| 工具 | 做什么 | 推荐 backend | 钱 | M2 verdict |
|------|--------|--------------|------|-----------|
| `doc_export_markdown` | 写 app 内文档 | 已有 | $0 | ✅ **已有** |
| `magi_system_read` | 自家知识库读 | 已有 | $0 | ✅ **已有** |
| `magi_content_ingest` | 自家知识库写 | 已有 | $0 | ✅ **已有** |
| ~~`doc_export_feishu`~~ | 同步飞书 | lark-cli SDK | $0 | 🟡 **M4**（你 daily 用飞书但 M2 焦点先论证能力） |
| ~~`doc_export_pdf`~~ | 导出 PDF 给用户下载 | Pandoc / Puppeteer | $0 / 中等 infra | 🟡 **M4** |
| ~~`doc_export_notion`~~ | 同步 Notion | Notion API | $0 | 🔴 OAuth 烦 |
| ~~`email_send`~~ | 发邮件 | Resend / Mailgun | $0-$$ | 🔴 M5+ |
| ~~`calendar_event`~~ | 创建日历事件 | Google Calendar OAuth | $0 | 🔴 M5+ |

---

## 3. M2 最终建议清单（15 个工具）

### 已有，保留（5）
1. `magi_system_read`
2. `magi_content_ingest`
3. `doc_export_markdown`
4. `echo_after_sleep`（fixture）
5. `web_search` → **rename 为 `search_web`**

### M2 新加 — 核心层（5）
6. **`run_python`** (E2B) — 计算/画图/回归
7. **`search_papers`** (OpenAlex 主 + CrossRef 备) — 学术论文
8. **`fetch_url`** (Jina Reader) — 替换 url_fetch
9. **`critique_last_answer`** — 防胡说
10. **`render_diagram`** (Mermaid) — 概念图

### M2 新加 — 建议层（5）
11. **`wikipedia`** — 概念入门
12. **`get_economic_series`** (FRED) — 宏观数据
13. **`get_paper_citations`** (OpenAlex) — 引用网络
14. **`datetime_now`** — 时间感知
15. **`document_reader`** (PDF + Word + Excel) — 用户上传文档讨论

### 估时
- 核心层 5 个：~6 天
- 建议层 5 个：~2.5 天
- Cross-cutting（5 个新 key 接入 user_api_keys_enc + mobile mermaid + sandbox lifecycle + tests）：~2 天
- **合计 ~10-11 天**

如果时间紧，砍**建议层**任 1-2 个最便宜：砍 `datetime_now`（10 分钟）和 `wikipedia`（0.5 天）省时间最少。砍 `document_reader` 省 1 天但你刚说有需求。砍 `get_economic_series` 省 0.5 天但宏观讨论受影响。

---

## 4. 与原 M2 spec（`2026-05-21-agent-runtime-m2-design.md`）的差异

| 改动 | 原因 |
|------|------|
| `search_papers` 后端：Exa → **OpenAlex + CrossRef** | 你说不要 YouTube 这种 niche；Exa 偏新闻博客对学术 native 度不够；OpenAlex 是论文 native |
| 拉回 `document_reader` 进 M2 | 你 4:56 重新问 PDF/Word，说明真有需求 |
| 拉回 `get_paper_citations` 进 M2 | 跟 search_papers 同源，半天活儿不该单独推迟 |
| 加 `datetime_now` | 10 分钟活儿，LLM 算日期硬伤 |
| 加 `query_memory`（M2 建议层，本表 F 类） | 复用 M1 memory，agent 自查很有用 |
| 砍掉 `search_news` / `stock_quote` / `weather` / `maps_places` / `currency_rate` 等 | 严肃讨论场景用不上 |
| 砍 `image_gen` / `plotly_chart` | 严肃讨论场景不需要 |
| 砍 youtube/ocr/whisper | 用户明确说不做 niche |

---

## 5. 待你确认的开放问题

请直接在 chat 里回我（不用回 AskQuestion UI）：

### Q1: 15 件清单接受吗？
- 选项 A：接受，按这个改 spec
- 选项 B：再砍 N 个（你指出来）
- 选项 C：再加 N 个（你指出来）

### Q2: `search_papers` 后端确认
我从你之前选的 Exa 改成了 **OpenAlex + CrossRef**。理由：你说不要 YouTube 类 niche，Exa 偏 AI 搜博客对学术 native 度不够。OpenAlex 是论文 native（2.5亿条 + 全免费 + 引用网络）。CrossRef 兜底 DOI 解析。

- 选项 A：接受 OpenAlex + CrossRef
- 选项 B：坚定 Exa（你之前的选择）
- 选项 C：OpenAlex + Semantic Scholar（S2 有 TLDR 摘要但 rate limit 严）
- 选项 D：三个都接

### Q3: `query_memory` 要不要进 M2？
表 F 里我标了"建议"。让 agent 在对话中查自己历史记忆/persona/topicSkills，半天活儿。

- A：要，M2 加入
- B：不要，M3 再说

### Q4: `document_reader` 三库齐上还是只 PDF？
我当前提议 PDF + Word + Excel 三库 dispatch。

- A：三库齐上（1 天活）
- B：只 PDF（0.5 天）
- C：PDF + Word（0.7 天）

### Q5: M2 时间盒
~10-11 天 vs M1f 的 ~4 天。可不可以接受这个量级？
- A：可接受，按 11 天上
- B：太长，按 8-9 天，建议层砍 2-3 个
- C：分两批：M2a（核心 5 工具 6 天）+ M2b（建议层 5 工具 5 天）

---

## 6. 我对优先级的最终主观推荐（如果你"懒得选，按你说的来"）

按"对严肃讨论的边际价值"排序，前 10 是 M2 必做的甜区：

1. **`run_python`** — 核心能力跃迁（统计/画图/验证）
2. **`search_papers` (OpenAlex+CrossRef)** — 学术证据基础
3. **`critique_last_answer`** — 防胡说，便宜
4. **`fetch_url` (Jina)** — 替换升级，便宜
5. **`render_diagram` (Mermaid)** — 概念可视化，零成本
6. **`get_economic_series` (FRED)** — 宏观讨论硬通货
7. **`wikipedia`** — 概念入门
8. **`document_reader`** — 用户文档讨论
9. **`get_paper_citations`** — 学术追踪
10. **`datetime_now`** — 杂项硬伤修

11-13 是已有 5 个（保留+rename）。
14-15 是建议层剩下的（`query_memory` 等），可砍。

我推荐：**接受 15 件，按这个推 spec + plan**。

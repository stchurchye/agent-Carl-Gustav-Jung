# M2 工具最终清单（供你确认）

日期：2026-05-21  
产品定位：**心理学 / 经济学严肃讨论 agent**

---

## 一、M2 工具清单（15 件）

### 🟢 保留现有工具（5 件，不改或 rename）

| # | 工具名 | 做什么 | 变化 |
|---|--------|--------|------|
| 1 | `magi_system_read` | 查自家 MAGI 知识库 | 不动 |
| 2 | `magi_content_ingest` | 往 MAGI 知识库写内容 | 不动 |
| 3 | `doc_export_markdown` | 把 agent 结果写成 app 内文档 | 不动 |
| 4 | `echo_after_sleep` | 测试 fixture | 不动 |
| 5 | `web_search` → **`search_web`** | 通用网搜（Tavily） | 仅改名 |

---

### 🔴 M2 新加 — 核心层（5 件，不能少）

| # | 工具名 | 做什么 | 用什么 API/库 | 钱 |
|---|--------|--------|--------------|------|
| 6 | **`run_python`** | Python 沙箱：计算 / 画图 / 回归 / statsmodels | **E2B Firecracker microVM**（完整 PyPI） | $10-30/月 |
| 7 | **`search_papers`** | 学术论文检索（理论名 / 人名 / 实证） | **OpenAlex 主 + CrossRef 备**（两个都免费） | $0 |
| 8 | **`fetch_url`** | 抓任意 URL → markdown（替换旧 url_fetch） | **Jina Reader**（`r.jina.ai/` 前缀，删 jsdom） | 无 key 限流；带 key 1M token/月免费 |
| 9 | **`critique_last_answer`** | 批评者 LLM 审视上一步输出，找胡说 | 同 run 的 LLM，换 system prompt | 同 LLM token |
| 10 | **`render_diagram`** | Mermaid 概念图 / 流程图 / 因果图 | mobile 端渲染 mermaid → SVG | $0 |

---

### 🟡 M2 新加 — 建议层（5 件，砍 1-2 个也行）

| # | 工具名 | 做什么 | 用什么 API/库 | 钱 | 如果砍的影响 |
|---|--------|--------|--------------|------|-------------|
| 11 | **`wikipedia`** | 查百科词条（概念定义 / 背景） | Wikipedia REST API | $0 | LLM 靠记忆答，可能不准 |
| 12 | **`get_economic_series`** | 拉 FRED 宏观经济数据（GDP/CPI/失业率等） | FRED API（免费 key） | $0 | 讨论宏观时 LLM 自己拍数字 |
| 13 | **`get_paper_citations`** | 查一篇论文的引用网络 | OpenAlex `/works/{id}` | $0 | 无法追溯引用源 / 评估争议 |
| 14 | **`datetime_now`** | 返回当前时间（LLM 总算错日期） | 内置，无 API | $0 | LLM 算日期/星期出错 |
| 15 | **`document_reader`** | 读 PDF / Word / Excel（URL 或上传）→ 文本 | pdf-parse + mammoth + xlsx（三库 dispatch） | $0 | 用户传 PDF 讨论时撞墙 |

---

## 二、被砍掉的工具（不做原因）

| 工具 | 不做原因 |
|------|----------|
| `youtube_transcript` | 你明确说不要 |
| `image_ocr` / `audio_transcribe` | M3/M4，视频/图/音频场景后做 |
| `search_news` / `search_reddit` / `search_twitter` | 严肃讨论用不上 / 反爬 |
| `stock_quote` / `weather` / `maps_places` / `currency_rate` | `run_python` 跑 yfinance 等库涵盖 / 非场景 |
| `generate_image` / `plotly_chart` | 严肃讨论用不上 |
| `ask_user`（反问） | M3 — 需要新状态机 + mobile UI，M1f 刚删过 awaiting_confirm |
| `deep_research`（子 agent） | M3 — 父子 run 架构，3-5 天单独立项 |
| `doc_export_feishu` / `doc_export_pdf` | M4 |
| `email` / `calendar` | M5+ |

---

## 三、估时

| 分组 | 估时 |
|------|------|
| 保留 5 件（含 rename） | 0.2 天 |
| 核心层 5 件 | ~6 天 |
| 建议层 5 件 | ~2.5 天 |
| Cross-cutting（key 管理、sandbox 生命周期、mobile mermaid 组件、tests） | ~2 天 |
| **合计** | **~10-11 天** |

如果时间紧，砍建议层最便宜的：砍 `datetime_now`（10 分钟）+ `wikipedia`（0.5 天）省约 0.6 天，影响最小。

---

## 四、你需要确认的 5 个问题

回复方式：直接在 chat 里打字，不需要点 UI。

**Q1**：15 件清单接受 / 还要砍哪几个 / 还要加什么？

**Q2**：`search_papers` 后端 —— 你之前发过"学术选 Exa"，我改成了 OpenAlex+CrossRef（都免费，学术 native）。你坚持 Exa 还是接受这个改动？  
（备选：只 OpenAlex / OpenAlex+Exa 双用）

**Q3**：`document_reader` 要 PDF+Word+Excel 三合一，还是只 PDF？

**Q4**：10-11 天能接受吗？还是想拆 M2a（核心层 6 天）+ M2b（建议层 5 天）分两批做？

**Q5**：有没有我漏掉的工具你觉得心理学/经济学讨论必须有？

---

## 五、我自己的推荐（你懒得选就按这个）

- 接受 15 件全上
- search_papers 用 OpenAlex+CrossRef（免费 + 学术 native + 2.5 亿条）
- document_reader 三合一（PDF+Word+Excel）
- 10-11 天整体做，不拆批
- 按这个更新 spec → 进 writing-plans

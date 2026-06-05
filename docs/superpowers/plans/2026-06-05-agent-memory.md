# Agent 长期记忆实施计划(原生核心 / MAGI 情景 双层)

> 来历:`~/.claude/plans/goofy-squishing-noodle.md`(v6→v8-final)经 grill-with-docs 用**真实代码**逐点核对收敛而来。
> 领域术语见仓库根 `CONTEXT.md`(核心个人记忆 / 情景·语义记忆 / 情景蒸馏 / recall_memory / 时序失效 / 质量门 / 职责切分)。
> 完整决策记录(含备选权衡)见 `docs/adr/0001-agent-memory-split-native-core-magi-episodic.md`。

**目标:** 给 agent 加「跨会话记得 + 语义召回 + 会更新」的长期记忆,**不破坏**原生 memory 子系统与 MAGI 现有行为(纯 additive)。

**技术栈:** M1 在 `MAGI-System`(Python/FastAPI/alembic/pytest + pgvector + bge);M2-M3 在 `agent-Carl-Gustav-Jung`(TS/Hono/vitest)。无新依赖。

---

## 1. 八个承重决策(全部经真实代码核对)

| # | 决策 | 要点 | vs plan v8 |
|---|---|---|---|
| 1 | **职责切分(定 C)** | 原生承载**核心个人记忆**(你是谁+稳定偏好,always-on);MAGI 承载**情景/语义记忆**(经历/聊过/学到,按需) | v8 留 B/C 未拍 → **定 C** |
| 2 | **两条独立蒸馏路径** | 原生 `memoryAutoExtract` 原样不动;新增**情景蒸馏**写 MAGI | 更明确,纯 additive |
| 3 | **独立表 + 强制 owner 参** | 专表 `agent_memory_fragment`(`owner_id NOT NULL`);**非** MAGI 研究 domain | **偏离** v8 共享 Fragment 表 |
| 4 | **按需检索** | `recall_memory({query})` 工具,**不** always-on 预取(原生核心已 always-on 保底) | **修正** v8 M2 的 always-on |
| 5 | **MAGI 三个哑端点** | `write`/`search`/`invalidate`,确定性、**无 LLM**;推理全在 agent 侧 | 新明确 |
| 6 | **时序失效自建** | 写入→同 owner 近邻→**agent 侧 LLM 判取代**→旧行 `valid_until=now`;检索取 `valid_until IS NULL` | **否** v8「复用 MAGI contradictions」 |
| 7 | **质量门(防脏)** | `status`(pending/approved/rejected);高置信(≥0.85)自动 approved,低置信 pending;search 只返 approved | 新增(回应 MAGI 不稳/脏数据) |
| 8 | **双写判别线(两轴)** | `关于用户`**且**`稳定常驻` → 原生;其余(含**个人日常事件**)→ MAGI | 精确化 |

### 关键事实纠错(vs plan v6→v8,均已核对)
- ❌→ plan 说原生「无自动巩固」:实际 `consolidateUserMemoriesIfNeeded` 已接在 apply/autoExtract/preCompact **三处**。
- ❌→ plan v7 说要自起 Ollama bge-m3:MAGI 已有 bge + `embed_text_sync`,**不用自起**。
- ❌→ ADR 早稿说「独立表复用 `retrieval.py`(传 table 参)」:`hybrid_retrieve` 有 `_ALLOWED_TABLES={fragments,concepts,thinking_logics}` 白名单,新表会 `raise`。**修正**:复用 `embed_text_sync`(表无关),**自写** ~40 行 owner-scoped 检索。
- ✅→ plan 说「session 检索没暴露给 agent」:属实(`searchSessionMessages` 只接 REST + 设置页)。

---

## 2. 数据结构 — `agent_memory_fragment`(精简 ~12 列)

**刻意不抄 MAGI Fragment 的 40+ 列**(那是学术抽取域专用:school/epistemic_paradigm/claim_scope/council…,对个人记忆过度设计)。

```sql
CREATE TABLE agent_memory_fragment (
  id                BIGSERIAL PRIMARY KEY,
  owner_id          TEXT NOT NULL,                 -- 租户隔离根;每条查询必带
  text              TEXT NOT NULL,                 -- 自由文本 fact(非结构化三元组)
  embedding         vector,                        -- bge;NULLABLE = embed 失败优雅降级
  status            TEXT NOT NULL DEFAULT 'pending',-- pending|approved|rejected;search 只返 approved
  confidence        REAL,                          -- LLM 自评,驱动 status 分流
  valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until       TIMESTAMPTZ,                   -- 时序失效;NULL=当前有效
  source_run_id     TEXT,                          -- provenance:哪个 run 产的
  source_session_id TEXT,
  topic_id          TEXT,                          -- scope
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at  TIMESTAMPTZ,                   -- 给未来 recency/decay 留位
  reviewed_by_user  BOOLEAN NOT NULL DEFAULT false,
  user_note         TEXT
);
CREATE INDEX ON agent_memory_fragment (owner_id);
CREATE INDEX ON agent_memory_fragment (owner_id, status) WHERE valid_until IS NULL;
-- pgvector ANN 索引(ivfflat/hnsw)按 MAGI 现有 Fragment 同款建
```

**砍掉(证据驱动后置):** 实体图/Concept/Edge、sentiment、importance 打分层、reflection insight category、relationship。两个前瞻可空列(`last_accessed_at`+`source_*`)现在加近乎免费,省未来迁移。

---

## 3. 执行计划(跨 repo:M1 先独立落地,再 M2/M3)

### M1 — MAGI 侧(Python,安全 gate,**先做先合**)
建表 + 三个**哑端点**,全程 TDD + `/code-review`。
- **M1a** 迁移:`agent_memory_fragment` 表(上方 schema)。旧 MAGI 表零改动。
- **M1b** `POST /api/agent-memory/write`:入参 `{owner_id, text, confidence, source_*, status?}` → `embed_text_sync(text)`(失败则 embedding=NULL)→ INSERT。**无 Celery、无抽取、无 council**(agent 已蒸馏成品 fact)。
- **M1c** `POST /api/agent-memory/search`:入参 `{owner_id, query, top_k}` → **自写** dense(pgvector)+ sparse(ts_rank)+ RRF,**WHERE `owner_id=:uid AND status='approved' AND valid_until IS NULL AND embedding IS NOT NULL`**。不复用 `hybrid_retrieve`(白名单)。
- **M1d** `POST /api/agent-memory/invalidate`:`{owner_id, id}` → `UPDATE … SET valid_until=now() WHERE id=:id AND owner_id=:uid`。
- **M1e** backfill sweep:给 `embedding IS NULL` 的行补向量(embed 服务恢复后)。
- **验收(pytest,无需 Celery/LLM):** 穷举**多 owner 隔离**(A 写、B search 返空)、status 过滤(pending 不返)、valid_until 过滤、embedding NULL 不进语义检索、`cross_domain` 路径**不**触及本表(研究检索打 `fragments`,物理隔离)。curl 冒烟。

### M2 — agent 侧(TS,接入)
- **M2a** `MemoryProvider` 薄接口:`write` / `search` / `invalidate`(+ 未来 `forget`)。`MagiMemoryProvider` 实现,**fail-open**(MAGI 不可达 → search 返空+提示、write best-effort、本轮不报错)。
- **M2b** **情景蒸馏**路径:复用 `salvageMemoriesBeforeCompact` 的边界触发时机,独立 prompt(**两轴判别线**:抽"非稳定核心"的一切值得记的,排除稳定个人特质)→ 每条打 `confidence` → `provider.write`(高置信 approved / 低置信 pending)。原生 `autoExtract` 不碰。
- **M2c** `recall_memory({query})` agent 工具(打 agent_memory 表,owner 隔离)+ planner prompt 显式描述(对齐 `magi_system_read:planner.ts:230`,与之**不混**)。
- **验收(vitest):** 跨两次 session 的 run,S2 能 `recall_memory` 召回 S1 写的 fact;MAGI 宕时 fail-open 退原生核心。

### M3 — agent 侧(TS,时序失效 = 「会更新」头条)
- 写入新 fact 前:`provider.search` 同 owner 近邻 top-k → **agent 自己的 LLM 判**新 fact 取代哪条旧的 → `provider.write` 新条 + `provider.invalidate` 旧条。`invalidate` 失败 → 新条照写、旧条暂留、下次对账(不阻塞)。
- **验收:** 「改主意」测试——先写「我用 Python」,再写「改用 Rust」→ 旧条 `valid_until` 被置、`recall_memory` 只返新条。
- **→ 停下评估。** 后续证据驱动增量(不前置):升格通道(日常→稳定升原生)、reflection→insight、轻主动召回 + sentiment、复用 MAGI review_queue+Next 做审核面板(`target_type='agent_memory_fragment'`)。

---

## 4. 失败处理矩阵

| 失败点 | 处理 |
|---|---|
| MAGI 整体不可达 | fail-open:recall 返空+提示、write best-effort、**本轮不报错**,退原生核心 |
| 蒸馏 LLM 失败 | 不产 fact,run 继续 |
| `invalidate` 失败 | 新 fact 照写、旧条暂留、下次对账 |
| embed(bge/Ollama)失败 | 写 **NULL embedding** 行(fact 不丢);检索 `WHERE embedding IS NOT NULL` 自动跳过;backfill 补 |
| pending 无人审堆积 | MVP 放着(无 UI、不召回);量大再上审核面板 |

---

## 5. 不可动约束 / 非破坏

- 原生 memory 子系统(`memory_fragments`/`contextAdapter`/`autoExtract`/`consolidate`)**零改动**。
- MAGI 现有表/路由/UI/`retrieval.py`**零改动**(只**新增**表 + 新端点 + 自写检索)。
- 安全 gate:agent_memory **每条**数据路径带 `owner_id` 过滤,穷举测试;漏一处 = 跨用户隐私事故。

## 6. 验证命令
```bash
# M1 (MAGI)
cd /Users/church/claude/MAGI-System && pytest backend/tests -k agent_memory
# M2-M3 (agent)
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

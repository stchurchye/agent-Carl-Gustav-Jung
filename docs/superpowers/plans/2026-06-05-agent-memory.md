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
  embedding         vector(768),                   -- bge-base-zh-v1.5 = 768d(钉死,与 MAGI embed_text_sync 一致);NULLABLE = embed 失败优雅降级(洞 G)
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
  user_note         TEXT,
  search_vector     tsvector                       -- 稀疏检索支撑列(洞 C5);to_tsvector('simple', text),仿 MAGI 迁移 023
);
CREATE INDEX ON agent_memory_fragment (owner_id);
CREATE INDEX ON agent_memory_fragment (owner_id, status) WHERE valid_until IS NULL;
CREATE INDEX ON agent_memory_fragment USING gin (search_vector);   -- 稀疏(洞 C5)
-- pgvector ANN 索引(ivfflat/hnsw)按 MAGI 现有 Fragment 同款建
-- search_vector 自动更新触发器:仿 MAGI 023 的 fragments_search_vector_update()
-- 注:CJK 短 fact 上 'simple' 稀疏价值有限,dense(bge)是主力;若实测 sparse 低收益可退 dense-only。
```

**砍掉(证据驱动后置):** 实体图/Concept/Edge、sentiment、importance 打分层、reflection insight category、relationship。两个前瞻可空列(`last_accessed_at`+`source_*`)现在加近乎免费,省未来迁移。

**跨 repo 契约(洞 G):** `MemoryProvider`(TS)↔ `/api/agent-memory/*`(Python)的 JSON 请求/响应字段是**手维护、易漂移**。M2a 落地时把契约(字段名/类型)写进两侧注释 + 一个**契约测试**(agent 侧打真实/录制的 MAGI 响应,校验解析)。embed 模型一旦在 MAGI 侧更换 → 存量 768d 向量失配,需重 embed(backfill 复用 M1e)。

---

## 3. 执行计划(跨 repo:M1 先独立落地,再 M2/M3)

### M1 — MAGI 侧(Python,安全 gate,**先做先合**)
建表 + 三个**哑端点**,全程 TDD + `/code-review`。

> **⚠️ 跨 repo 协调(MAGI 有活的并行开发)。** `MAGI-System` 是 GitHub PR 工作流(`origin=stchurchye/MAGI-System`,feature 分支 → PR → main),且当前有别的会话在 `experiment/recall-critic-followup` 上改 `config.py`/`reflection.py`。M1 **纯 additive**,与其热文件零重叠,但需守三条:
> 1. **从 `origin/main` 起分支** `feat/agent-memory`(先 `git fetch`;**别**从 experiment 分支、**别**从本地 `main`(已 behind)）。
> 2. **迁移 = `055_agent_memory_fragment`**,`down_revision='054_add_global_id_sync'`(当前最新);落地前后各跑 `alembic heads` 验**单 head**(历史有过分叉 stub,别人若先合迁移则 rebase 重接号)。
> 3. **别碰** `config.py`(agent_memory 不是 domain)/`retrieval.py`(检索自写)/`reflection.py`——这三个是对方在动或会冲突的;M1 只新增 model+router+迁移 + 1 行 router 注册。DB 用自己的 dev 库或先打招呼(新表对现有 domain 检索不可见,运行时不冲突)。
- **M1a** 迁移:`agent_memory_fragment` 表(上方 schema)。旧 MAGI 表零改动。
- **M1b** `POST /api/agent-memory/write`:入参 `{owner_id, text, confidence, source_*, status?}` → `embed_text_sync(text)`(失败则 embedding=NULL)→ INSERT。**无 Celery、无抽取、无 council**(agent 已蒸馏成品 fact)。
- **M1c** `POST /api/agent-memory/search`:入参 `{owner_id, query, top_k}` → **自写** dense(pgvector `embedding`)+ sparse(`search_vector` ts_rank,洞 C5)+ RRF,**WHERE `owner_id=:uid AND status='approved' AND valid_until IS NULL AND embedding IS NOT NULL`**。不复用 `hybrid_retrieve`(白名单)。
  - **返回必带 `id` + provenance**(`source_run_id`/`source_session_id`/`created_at`/`text`)——**M3 的 `invalidate(by-id)` 与 supersession 判定都要这个 id**;且 agent 可据此向用户说明"这条记忆哪来的"。
  - **pgvector + owner 过滤召回(候选,低危):** ANN 索引不按 owner 过滤,先 ANN 再 filter 可能少返。MVP 每用户 fact 量小 → 直接 `WHERE owner_id ORDER BY embedding <-> q`(filter-first 精确)即可,规模上来再上 ivfflat probes 调优。
- **M1d** `POST /api/agent-memory/invalidate`:`{owner_id, id}` → `UPDATE … SET valid_until=now() WHERE id=:id AND owner_id=:uid`。
- **M1e** backfill sweep:给 `embedding IS NULL` 的行补向量(embed 服务恢复后)。**触发 = 独立脚本 / 管理端点 `POST /api/agent-memory/backfill-embeddings`,不引 Celery**(守 M1 无 Celery);幂等、可重复跑(洞 H)。
- **M1f** 服务鉴权(洞 A):三端点 + backfill 全部 `Depends(verify_service_token)`,校验 `Bearer MAGI_SYSTEM_TOKEN`,空/错 token → 401。**这是安全 gate 的第一道,不是可选项。**
- **验收(pytest,无需 Celery/LLM):** 穷举**多 owner 隔离**(A 写、B search 返空)、status 过滤(pending 不返)、valid_until 过滤、embedding NULL 不进语义检索、`cross_domain` 路径**不**触及本表(研究检索打 `fragments`,物理隔离);**鉴权:无 token/错 token → 401**(洞 A)。curl 冒烟。

### M2 — agent 侧(TS,接入)
- **M2a** `MemoryProvider` 薄接口:`write` / `search` / `invalidate`(+ 未来 `forget`)。`MagiMemoryProvider` 实现,**fail-open**(MAGI 不可达 → search 返空+提示、write best-effort、本轮不报错)。
- **M2b** **情景蒸馏**路径:复用 `salvageMemoriesBeforeCompact` 的边界触发时机,独立 prompt(**两轴判别线**:抽"非稳定核心"的一切值得记的,排除稳定个人特质)→ 每条打 `confidence` → `provider.write`(高置信 approved / 低置信 pending)。原生 `autoExtract` 不碰。
  - **⚠️ confidence 校准(洞 E):** LLM 自评置信**校准差、常过度自信**。自动-approve 阈值 **0.85 是待校准参数,非定值**;MVP **起步保守**(阈值取高 / 多数进 pending),上线后看真实"approved 中的脏 fact 率"再放松。别让"自信的错 fact"绕过质量门。
- **M2c** `recall_memory({query})` agent 工具(打 agent_memory 表,owner 隔离)+ planner prompt 显式描述(对齐 `magi_system_read:planner.ts:230`,与之**不混**)。
- **验收(vitest):** 跨两次 session 的 run,S2 能 `recall_memory` 召回 S1 写的 fact;MAGI 宕时 fail-open 退原生核心。

### M3 — agent 侧(TS,时序失效 = 「会更新」头条)
- 写入新 fact 前:`provider.search` 同 owner 近邻 top-k → **agent 自己的 LLM 判**新 fact 与旧的关系 → 分三种处置:
  - **取代(矛盾)** → `provider.write` 新条 + `provider.invalidate` 旧条(置 `valid_until=now`)。
  - **近重复(同义重述,不矛盾,洞 C)** → **跳过写入**,只更新旧条 `last_accessed_at`;防近重复无限累积、防 recall 返冗余 + 表膨胀。
  - **全新** → 直接 write。
- **status × valid_until 交互(洞 D):** M3 的近邻搜**必须覆盖 `pending` + `approved`**(不只 approved),否则新高置信 fact 取代了某条 pending 旧 fact 却没失效它,留下矛盾;被取代的 pending 行直接置 `rejected`。
- `invalidate` 失败 → 新条照写、旧条暂留、下次对账(不阻塞)。
- **验收:** 「改主意」——先写「我用 Python」,再写「改用 Rust」→ 旧条 `valid_until` 被置、`recall_memory` 只返新条;「重述」——重复写近义 fact → 不新增行、`last_accessed_at` 更新(洞 C);「pending 被取代」——pending 旧 fact 被新 fact 取代 → 置 rejected(洞 D)。
- **→ 停下评估。** 后续证据驱动增量(不前置):升格通道(日常→稳定升原生)、reflection→insight、轻主动召回 + sentiment、复用 MAGI review_queue+Next 做审核面板(`target_type='agent_memory_fragment'`)。

---

## 4. 失败处理矩阵

| 失败点 | 处理 |
|---|---|
| MAGI 整体不可达 | fail-open:recall 返空+提示、write best-effort、**本轮不报错**,退原生核心。**写丢弃必须记日志/计数(洞 F)**——否则慢性 MAGI 抖动 = 系统性丢记忆且无感知;计数超阈值告警。outbox 回灌延后。 |
| 蒸馏 LLM 失败 | 不产 fact,run 继续 |
| `invalidate` 失败 | 新 fact 照写、旧条暂留、下次对账 |
| embed(bge/Ollama)失败 | 写 **NULL embedding** 行(fact 不丢);检索 `WHERE embedding IS NOT NULL` 自动跳过;backfill 补 |
| pending 无人审堆积 | MVP 放着(无 UI、不召回);量大再上审核面板 |

---

## 5. 不可动约束 / 非破坏

- 原生 memory 子系统(`memory_fragments`/`contextAdapter`/`autoExtract`/`consolidate`)**零改动**。
- MAGI 现有表/路由/UI/`retrieval.py`**零改动**(只**新增**表 + 新端点 + 自写检索)。
- 安全 gate:agent_memory **每条**数据路径带 `owner_id` 过滤,穷举测试;漏一处 = 跨用户隐私事故。

### 5.1 信任边界(洞 A,设计级,M1 前必须定)
**SQL 层 `owner_id` 过滤只在调用方可信时才成立。** `owner_id` 是 agent 传入的字符串,MAGI **无从独立验证**(agent userId 是 string,MAGI `get_current_user_id` 是 int,两套身份系统解耦)。若 `/api/agent-memory/*` 无服务间鉴权,任何内网调用方传 `owner_id=别人` 即可读走他人全部记忆——SQL 隔离形同虚设。
- **修复(复用现成机制):** `/api/agent-memory/*` **强制校验** `Authorization: Bearer ${MAGI_SYSTEM_TOKEN}`(agent 侧 `integrations/magi.ts:23` 已在发此 token)。MAGI 侧**必须真的拒绝**无效/空 token(现状 `?? ''` 兜底 = 可能没强制,要查实并补)。由 agent 后端(已鉴权终端用户、掌握真实 owner_id)代表用户调用,MAGI 校验 token 后信任其传入的 owner_id。
- **安全测试范围 = SQL WHERE + 鉴权两层:** 除"A 写 B 返空",必测"**无 token / 错 token → 401**"、"有效 token 但越权 owner_id → 仍只返该 owner"。

### 5.2 群聊语境的记忆归属(洞 B,设计级)
M7 群聊 run 没有单一清晰 owner。**铁律:`recall_memory` 与情景蒸馏在群 run 里一律锁 `run-owner` 的 `owner_id`,绝不跨成员**(召回/写入别人记忆 = 隐私事故)。
- **非目标(显式留后):** 群共享知识、关于其他成员的事实——不在本期建模,不写入任何成员的个人记忆。
- **测试:** 群 run 里 A 发起 → recall_memory 只返 A 的记忆;蒸馏出的 fact 只落 A 的 owner_id;B 的记忆永不出现。

## 6. 验证命令
```bash
# M1 (MAGI)
cd /Users/church/claude/MAGI-System && pytest backend/tests -k agent_memory
# M2-M3 (agent)
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

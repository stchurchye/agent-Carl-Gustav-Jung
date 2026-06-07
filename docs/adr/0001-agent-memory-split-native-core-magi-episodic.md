# ADR 0001 — Agent 长期记忆:原生核心 / MAGI 情景 双层,独立表隔离

- 状态:已接受(grilling 定稿,2026-06-05)
- 上游:`/Users/church/.claude/plans/goofy-squishing-noodle.md`(v8-final)经 grill-with-docs 收敛
- 相关术语:见 `CONTEXT.md` 的[核心个人记忆 / 情景·语义记忆 / 情景蒸馏 / recall_memory / 记忆后端职责切分]

## 背景

要给 agent 加"跨会话记得 + 语义召回 + 会更新"的长期记忆。两套现实资产已存在:
1. **本项目原生 memory 子系统**比预期成熟——`memory_fragments`(+versions)always-on 注入(`contextAdapter`)、自动抽取(`memoryAutoExtract`,只抽偏好/项目/习惯这类高信号 core)、**自动巩固已在跑**(`consolidateUserMemoriesIfNeeded` 接在 apply/autoExtract/preCompact 三处)、scope 鉴权天然按 `owner_id` 隔离、压缩前提炼。**唯一硬缺口:大历史语义/向量召回**(零 embedding)。
2. **MAGI-System** 已实现 pgvector + bge(本地、CJK 强)+ hybrid 检索(BM25+dense+RRF)+ 实体/关系 + 时序失效 + 可视化审核 UI。**整个架构按 `domain` 组织**(三研究域 psychology/economics/curveball,各在 `DOMAIN_REGISTRY` 配 prompt/paradigm/seed)。`embed_text_sync` 同步 embed 已存且表无关、可复用;但 `hybrid_retrieve` 的 `table` 参是**写死白名单** `{fragments, concepts, thinking_logics}`(非任意表,新表会 `raise`)。`owner_id` 鉴权框架 0% 启用(单知识库),检索按 `domain` 分区(自由 `String(30)`,非枚举)。

plan v6→v8 的迭代一度倾向"MAGI 当全后端(B),原生退役"。grilling 中用真实代码核对后否掉了 B 的两条前提:原生并非"弱"(巩固/抽取已工作),且 B 要赌 MAGI 多租户改造这个高风险 gate。

## 决策

**五条,构成一套姿态:**

1. **职责切分(否 B、定 C):** 原生承载**核心个人记忆**(你是谁 + top 偏好,always-on,不迁移、不外包);MAGI 承载**情景/语义记忆**(聊过/学到的大历史,按需召回)。两层不重叠。

2. **两条独立蒸馏路径:** 原生 `memoryAutoExtract` **原样不动**(继续只抽 core personal)。新增一条**情景蒸馏**,专抽原生 extractor 现在直接丢弃的领域事实/学到的东西 → 写 MAGI。各自 prompt/阈值,纯 additive。

3. **独立表 + 强制 owner 参(偏离 v8 的"共享 Fragment 表 + NULLABLE owner_id"):** agent 记忆入专用表 `agent_memory_fragment`(`owner_id NOT NULL`),专用查询模块每函数 `owner_id` 必传。研究语料查询打在 `fragments` 表上**物理上返回不了 agent 行**(防污染结构性杜绝);跨用户隔离只需防一张表的查询。**agent 记忆不是 MAGI 的研究 domain**(MAGI 现有三域 psychology/economics/curveball 是 `DOMAIN_REGISTRY` 配置的研究垂直,各带 extraction/council/paradigm);agent 记忆是 per-user 个人记忆,另起表避免蹭研究域机制 + 避免 `cross_domain` 检索把记忆泄进研究结果。

   - **⚠️ 修正(2026-06-05,grilling 中发现):** 早先本条写"`retrieval.py` 传 `table` 名即复用 bge/hybrid"——**错**。`retrieval.py` 有 `_ALLOWED_TABLES = {fragments, concepts, thinking_logics}` 白名单,新表会被 `raise ValueError`。**真实复用边界**:复用 `embed_text_sync`(表无关的同步 embed 函数);**自写** ~40 行 owner-scoped dense(pgvector)+ sparse(ts_rank)+ RRF 检索打在自己表上(把 `owner_id` 焊进查询,隔离最强)。修正后此决策**不变**:物理隔离仍值,且自写检索不贵、零改 MAGI 核心。

4. **按需检索,不 always-on 预取:** 新 agent 工具 `recall_memory({query})` 打 agent_memory 表(owner 隔离)。原生核心记忆已 always-on 保底身份/偏好,故 MAGI 层是刻意召回,热路径零额外开销。与 `magi_system_read`(打研究知识库)不混。

5. **MAGI 三个哑端点,推理全在 agent 侧:** M1 暴露三个**确定性、无 LLM** 端点 —— `write`(`embed_text_sync`+INSERT)/ `search`(owner-scoped,**自写** dense+sparse+RRF 打 `agent_memory_fragment`,非复用 `hybrid_retrieve`)/ `invalidate(by-id)`(置 `valid_until`)。**全部纯 pytest 可验**(无需 Celery、无需 mock LLM)。时序失效的"新 fact 取代哪条旧的"LLM 判定在 **M3(agent/TS)**:先 `search` 近邻 → agent 自己的 LLM 判 → `write` 新条 + `invalidate` 旧条。这保住 M1 的"无 LLM·安全 gate 可隔离验证"性质。跨 repo 顺序:**M1 先在 MAGI 独立落地并合,再回 agent repo 做 M2/M3**。

## 备选与权衡

- **B(MAGI 全后端):** 复用最大,但赌 MAGI 多租户改造(7 表 + 路由 + retrieval WHERE)这个"漏一处=跨用户隐私事故"的 gate,且废弃已工作的原生巩固/抽取逻辑。否。
- **共享 Fragment 表 + owner_id 列(v8 原案):** 最 additive,但跨用户隔离靠"每条 SQL 都记得加 owner WHERE"的纪律,blast radius = 全库。独立表把它收窄到一张表,换来一次建表/迁移成本。取独立表。
- **always-on 预取 MAGI(v8 M2):** 记忆"自动在场"不靠大脑调,但每轮 embed+检索+注入的延迟/成本,且多数轮用不上。原生核心已 always-on 保底,故取按需。

## 后果

- ✅ 防污染、防跨用户均为**结构性**(独立表),M1 安全测试面收窄到 3-4 个新端点 + 一张表。
- ⚠️ **信任边界(对抗 review 洞 A):** SQL `owner_id` 过滤只在调用方可信时成立;`owner_id` 由 agent 传入、MAGI 无从独立验证。`/api/agent-memory/*` **必须强制** `Bearer MAGI_SYSTEM_TOKEN` 服务鉴权(复用 `integrations/magi.ts:23` 现有 token),安全测试覆盖鉴权层而非仅 SQL WHERE。详见 plan §5.1。
- ⚠️ **群聊归属(洞 B):** 群 run 里 `recall_memory`/情景蒸馏一律锁 run-owner,绝不跨成员;群共享知识显式留后。详见 plan §5.2。
- ✅ 原生子系统零改动(满足非破坏约束);MAGI 旧行为零改动(新表 + 新端点)。
- ✅ M1 可独立 pytest/curl 验收,最高风险点(多租户)前置且隔离验证。
- ⚠️ `recall_memory` 有"大脑漏调"风险 → 靠 planner prompt 显式描述缓解(同 `magi_system_read`)。
- 🔄 **时序失效(M3)改为自建,不复用 MAGI contradictions**:核对发现 MAGI 的矛盾检测绑死 `fragments`/`concepts` 表 + review queue,且为"知识库审稿"而非"用户改主意"设计——形状不对。改为在 `agent_memory_fragment` 自建:写入新 fact → 同 owner 语义近邻 → LLM 判取代 → 旧行 `valid_until=now`(不删),检索取 `valid_until IS NULL`。plan v8"M3=近纯复用 MAGI contradictions/resolve"被否。fact 存自由文本(非结构化三元组,不复制 Concept/Edge)。
- ⚠️ 反思→insight、主动召回、情感字段:证据驱动增量,M1-M3 后按需,不前置。

## 补充决策:质量门(防脏数据)

**背景:** MAGI 本身不稳定,其书籍提取产脏 `draft` 数据;核实 `retrieval.py` 当前 `WHERE status IN ('approved','contested','draft','needs_review')` —— **draft 会被检索到**,故脏数据问题对 MAGI 研究侧真实存在。用户提议"分两个库 + 人工确认后落真实库"。

**决策:** 用 `status` 字段(pending/approved/rejected)在**单表** `agent_memory_fragment` 上建模"脏→审→净"生命周期,**不用第二个库**。情景蒸馏:高置信(≥0.85,仿原生 autoExtract 阈值)→ 直接 `approved`;低置信/被 flag → `pending` 等人工审。`search` 端点只返 `status='approved'`。

**理由:** ① MAGI Fragment.status 与原生 memory status 都已是 status-字段模型,一致;② 一行 `WHERE status='approved'` 拿到与两库同样强的"recall 只见净数据"保证,且 search 是单一函数、blast radius 极小(不同于 owner 过滤遍布全库才值得独立表);③ 两表 staging→真库 把生命周期建模成位置,确认=搬行、后续 contested 状态转换尴尬、双 schema 漂移。

**与独立表决策的协同 = 双层防脏:** MAGI 书籍提取的脏数据落 `fragments`(研究域),agent 记忆在 `agent_memory_fragment` + 自己的 search 端点,**物理够不到** → MAGI 研究侧脏数据**结构性**污染不到 agent 记忆;agent 记忆**自身**的蒸馏错误再由 status 质量门拦。

**对"MAGI 不稳定"这一依赖风险的回答:** 印证 C-split + 独立表 + MemoryProvider 接口 + fail-open 是对的 —— agent 记忆不依赖 MAGI 的脆弱书籍管线;MAGI 研究侧崩了,agent 记忆(独立表/独立 write+search)不受影响;MAGI 整体不可用时 fail-open 退回原生核心。审核 UI 后续可复用 MAGI review_queue + Next 前端。

## 补充决策:数据结构 + 失败处理 + 审核 UX

**数据结构 = 精简 ~12 列,刻意不抄 MAGI Fragment(40+ 列):** MAGI Fragment 是学术抽取域专用(school/epistemic_paradigm/evidence_level/char_span/quoted_author/claim_polarity/claim_scope/consensus_level/council…),对个人情景记忆是过度设计。`agent_memory_fragment` 取:`id` / `owner_id`(NOT NULL,index,隔离根)/ `text`(自由文本 fact)/ `embedding`(vector,**NULLABLE**)/ `status`(pending|approved|rejected)/ `confidence`(float,驱动 status 分流)/ `valid_from` / `valid_until`(NULL=当前有效)/ `source_run_id`·`source_session_id`·`topic_id`(provenance+scope,NULL)/ `created_at` / `last_accessed_at`(NULL,给未来 recency/decay 留位)/ `reviewed_by_user`·`user_note`。覆盖 8 决策全部所需;**砍掉** v7 的实体图/Concept/Edge、sentiment、importance 打分层、council/paradigm 字段(证据驱动增量延后)。两个前瞻可空列(`last_accessed_at`+`source_*`)现在加近乎免费,省未来迁移。

**失败处理矩阵:** MAGI 整体不可达 → fail-open(recall 返空、write best-effort、本轮不报错、退原生核心);蒸馏 LLM 失败 → 不产 fact、run 继续;`invalidate` 失败 → 新 fact 照写、旧条暂留、下次对账;**embed(bge/Ollama)失败 → 写 NULL embedding 行(fact 不丢)**,MAGI 检索本就 `WHERE embedding IS NOT NULL` 故 NULL 行自动不进语义检索,后台 backfill 补向量再可召回(优雅降级,胜过整条丢弃);pending 无人审堆积 → MVP 放着(见下)。

**审核 UX:MVP 不做 UI,置信自流。** 高置信(≥0.85)→ 自动 `approved` 即可用;低置信/被 flag → `pending` 堆着(不召回、不浮现)。等 M1-M3 跑通、看真实 pending 量再决定 UI 方向。复用路径已探明:`ReviewQueueItem` 多态(`target_type` String(32)),pending 项以 `target_type='agent_memory_fragment'` 入队即可稍改复用 MAGI review_queue + Next 前端(P5,非 MVP)。不预设 UI 形态。

## 补充决策:M4 增强层(反思 / 升格 / 主动召回 / sentiment / 中文 sparse)

- 状态:已接受(grilling 定稿,2026-06-07)
- 基调:**knowing override**。M1-M3+P5 已上线,本节诸特性原 §7 列为「证据驱动、不前置」(零使用数据)。用户在听过"全建=投机、正是 plan 警告"后明确选择**全建(8 项)**,并要求**判据按检索/记忆质量(性能)优先**,而非最小风险。下列决策即在「质量优先 + 全建」前提下取最优形态;诚实保留两处弱点:① sentiment 近期无运行时消费者(纯数据沉淀);② 零数据下 reflection 可能合成稀薄 → 节流阈值起步保守。

**M4-1 schema 全用列,不开新表(迁移 056,纯 additive)。** `kind TEXT NOT NULL DEFAULT 'fact'`(CHECK `fact|insight`)+ `source_fragment_ids BIGINT[]`(insight 的 provenance = 由哪些 fact 合成)+ `sentiment TEXT`(CHECK `positive|negative|neutral|mixed`)+ `promoted_at TIMESTAMPTZ`(升格幂等)+ `status` DB CHECK(B7,纵深防御)。
- *理由:* insight **也是 fragment**,共用同一套 owner/status/时序/embedding/召回机制,只 `kind` 不同 → 单表检索不变、不动 `_ALLOWED_TABLES` 白名单、无 join。开新表要改白名单 + 召回跨表 UNION,复杂度高且无收益。全列 nullable/带默认 → 旧行零影响、无 backfill。
- *权衡:* 用 `BIGINT[]` 数组存 provenance 而非 join 表 —— MVP 够用,牺牲了引用完整性约束(数组里的 id 可悬空),可接受(provenance 仅供展示/追溯,非强一致需求)。

**M4-2 reflection→insight:agent 侧 + softComplete 边界 + 节流。** 复用 episodic wiring 同钩子(run 收尾、**响应之后**、不阻塞、fail-open)。节流不开新状态表:`list` 拉该 owner approved 事实,数「自上条 insight 以来新增事实数」≥阈值(起步保守,如 8)才合成;合成**输入取宽窗口**(近期 N + 语义聚类,非仅增量)以保洞见质量;产物 `writeAgentMemory(kind='insight', source_fragment_ids=[...])`。
- *否 MAGI Celery:* MAGI API 层刻意无 LLM("inference on agent side"),distill/reconcile/judge 全在 agent 用 agent 的 `LlmChatClient`。reflection 是 LLM 合成,放 MAGI 要么破坏该原则、要么用 MAGI 异构模型(非 agent persona);且 agent(Hono)无入站端点供 Celery 回调。边界+节流更一致、零新基建,且用懂 persona/领域的同一模型 → 质量更优。

**M4-3 升格通道:面板手动升格,非自动硬化。** approved 事实/洞见上加「升格到核心」按钮,用户手动点 → agent 侧 `createMemoryFragment(scope='user', source='import', status='active')`(守原生 char 预算 `consolidateUserMemoriesIfNeeded`)+ MAGI 置 `promoted_at`(幂等,面板隐藏按钮)。
- *理由(质量):* always-on 核心是每轮注入的最贵地段,自动升格会拿噪声污染它;且 distill **刻意排除**身份/长期偏好/习惯(那些归原生 auto-extract),故 approved 的 episodic 事实**按设计不是稳定特质** → 任何"自动判硬化"启发式在零证据下必然瞎猜。人工授权 = 最高精度 + 守住 distill 边界 + 给面板真实职责。
- *权衡:* 牺牲了"全自动"的便利,换核心记忆质量;自动升格(按复发计数)留作攒到复发数据后的增量。

**M4-4 主动召回:`resolveMemoriesForContext` 处注入,复用全局开关。** private(contextPipeline)+ group(groupLlm)都穿过此函数 → 一处注入 `<proactive_memory>` 块覆盖两边。query = 当前用户消息;top-K=3 + relevance 阈值(~0.6,滤噪)+ **排除已升格**(`promoted_at` 非空,已在原生 always-on,免双重)+ 紧超时 + fail-open;门控复用 `magiSystemEnabled`(不新增 toggle)。用与 recall **同款 dense+sparse RRF**。
- *热路径代价(诚实记录):* 必须在模型回复**前**同步注入(否则对本轮不"主动"),每轮多一次 MAGI 检索(query 端嵌入 + 向量搜,~50-200ms)。靠紧超时 + fail-open 兜底:MAGI 慢/挂即跳过,绝不阻塞回复。

**M4-5 sentiment:distill 写 / 面板读,不接召回排序。** distill 逐条事实打 `sentiment` 标签(TEXT 枚举)→ 存 → 面板展示。
- *诚实:* 零证据下唯一靠谱近期消费者 = 面板展示 + 为以后情感/关系特性沉淀语料,**近期不改变运行时行为**。不接主动召回排序 —— 拿情感调检索权重在零证据下是瞎调、**伤精度**,违背"质量优先"。"情感关系"需实体抽取(无实体模型),超范围。

**M4-6 中文 sparse:应用层 jieba 分词,只动 agent_memory_fragment。** MAGI write 用 python `jieba` 分词 → 空格拼接 → `to_tsvector('simple', segmented)`(迁移 057 drop 本表 trigger,改 write 端点 app 层写 `search_vector`);search 端 dense cosine + 分词后 query 的 `ts_rank_cd` + RRF。
- *否 zhparser:* 镜像 `pgvector/pgvector:pg16` **不带** zhparser/pg_jieba,装它要自建 Postgres 镜像(编译 SCWS+zhparser)+ superuser + 碰**共享 fragments 表**的 `'simple'` 配置 + 跟另一会话协调。代价大。
- *质量上 jieba ≥ zhparser/SCWS:* jieba 词典更新、HMM 新词发现、是事实标准;app 层分词还能挂领域用户词典再提召回。检索质量大头在 dense(bge-zh)与 sparse 的 **RRF 融合**。**只动本表**(不碰 fragments)→ 无跨会话协调、无共享配置风险。
- *贯穿性质量线:* sparse 落地后,`recall_memory` / 主动召回 / reconcile 近邻搜**全部**切到 dense+sparse RRF,不止 sparse 自己用。

**M4-H 加固(纯 TDD,无设计):** B6 测试跑真实 alembic 迁移(非 `create_all`,防 model↔迁移漂移)；B7 status DB CHECK(并入 056)；B8 跨 repo 契约测试(agent 侧 `searchAgentMemory/writeAgentMemory/...` 打真实/录制 MAGI 响应,校验解析,防字段漂移)。

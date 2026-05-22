# Agent Runtime M6 设计文档

- 项目代号：`agent-runtime` v0.m6
- 日期：2026-05-23
- 状态：设计待用户复核 → writing-plans
- 关联：v0.m5 已 merge（tag `v0.m5` + `2f03a2d`）；本 milestone 是 M1–M5 的 closeout

---

## 1. 背景

M1–M5 全部 merge，Agent Runtime 主线能力已就位。但 M4/M5 在交付过程中显式留下了几个"用户每天会碰到但 v0.m5 没收口"的尾巴：

1. **Mobile 实时性**：M4 polish 的 SSE 适配从未做；mobile 用 1.5s polling，新 step 出现到 UI 看见有 ~750ms 平均延迟，长任务体感"卡"
2. **Artifact ref 跳不动**：M5A T4 显式占位 `console.log('ref tap:', ref)`，`document` / `magi_card` / `diagram` 三种 ref 点击无反应
3. **`updateAgentRun` summary null-clear 写错**：M5 review 发现写入字符串 `"null"` 而非 SQL NULL，`artifact` 借机已修但 `summary` 等其他 JSONB 字段同病
4. **AgentRunCard 终态模型名显示两次**：header `by {model}` + artifact footer `{model}`，视觉冗余
5. **`youtube_transcript` 工具缺失**：M2 spec §17 原列，M2 plan 砍掉至今未补；用户高频使用场景之一

M6 不引入新方向，**就是把这五件事做完**，达到 v0.m5 应有的体验完整度。

## 2. 目标 / 非目标

### 2.1 目标

| ID | 验收点 |
|---|---|
| G1 | Mobile 详情屏看到新 step 延迟 < 200ms（实测） |
| G2 | Artifact 点 `document` ref → 跳文档屏并高亮；点 `diagram` ref → 详情屏滚到对应 step |
| G3 | `updateAgentRun({ summary: null })` 等 JSONB null 入库后 `IS NULL` 为真 |
| G4 | `AgentRunCard` 终态模型名只出现一次 |
| G5 | `youtube_transcript` 工具可被 planner 选中，给定 YouTube URL 返回 transcript |

### 2.2 非目标

- ❌ 不引入 `react-native-sse` 依赖（long-poll 等价延迟、零新增依赖）
- ❌ 不做 `magi_card` 详情屏（独立 mini-feature，M7 评估）
- ❌ 不动 sub-project B（群聊并发协调）/ C（上下文 v2）/ E（定时调度）
- ❌ 不补其他 spec §17 工具（飞书导出、地图、browserUse）
- ❌ 不做 B 站 transcript（不同 API、反爬，独立 feature）
- ❌ 不做 thundering herd grace period（jitter 已经够；deploy 防护后续再补）

---

## 3. T1：增量 long-poll（含 jitter + heartbeat）

### 3.1 现状

- 后端有 SSE 路由 `/api/agent/runs/:id/stream`（M1d 已支持 `?after=` / `Last-Event-ID` 续传），但 mobile 没用
- Mobile 用 `useAgentRunPoll`，每 1.5s 全量 `GET /api/agent/runs/:id`
- `useAgentRunPoll.ts` 注释明确：RN 缺原生 EventSource，故意走轮询

### 3.2 关键决策

| ADR | 选择 | 原因 |
|---|---|---|
| ADR-M6-1 | 增量 long-poll（不上 SSE，不缩短 poll 间隔） | 零新增 RN 依赖，延迟等价 SSE |
| ADR-M6-2 | Server hold 25s ± 20% jitter | 防 deploy 后 thundering herd |
| ADR-M6-3 | Server 每 15s emit heartbeat | 防中间反向代理 idle cut |
| ADR-M6-4 | 响应格式 `application/x-ndjson` | 简单、可扩展、客户端不依赖 EventSource |
| ADR-M6-5 | 单连接最多 emit 一个 batch 后 close | long-poll 标准语义，客户端代码简单 |

### 3.3 接口

**`GET /api/agent/runs/:id/long-poll?after=<idx>`**

响应：`application/x-ndjson`，每行一个 JSON 对象。

可能出现的行类型：

```json
{"type":"batch","run":{...AgentRun},"steps":[...AgentStep],"notices":[...AgentNotice],"hasMore":false}
{"type":"heartbeat","ts":1716350000000}
{"type":"idle","run":{...AgentRun},"lastIdx":42}
```

- `batch`：有新 step（idx > after）或 run 进入 terminal，必发，发完关连接
- `heartbeat`：hold 期间每 15s 发一次，客户端忽略（仅用于保活）
- `idle`：hold timeout 到期且无新 step，发完关连接

权限：复用 `canAccessRun(run, userId)`（owner 或群成员），与 `/runs/:id` 同。

### 3.4 Server 行为

```
1. SELECT * FROM agent_steps WHERE run_id=$1 AND idx > $after ORDER BY idx
   - 有 N>0 行 → 立即写 batch → close
   - 无 → 进入 hold
2. Hold 模式
   - holdMs = 25000 * (0.8 + Math.random() * 0.4)  // 20000-30000 随机
   - 启 hbInterval：每 15s emit heartbeat 行
   - subscribe runHooks.on('run.step', listener)
     - listener 回调：若 step.runId 匹配 → 立即拉新 step → emit batch → close
   - 启 idleTimer = setTimeout(holdMs)
     - 到期：emit idle 行 → close
   - 任何 close 路径：clear hbInterval + idleTimer + unsubscribe
3. Run 已在 terminal status（completed / failed / cancelled / budget_exhausted）
   - 不 hold，直接 emit batch（含最新 run + 空 steps + hasMore=false）→ close
```

实现位置：`apps/api/src/routes/agent.ts` 新增 handler；不复用 `streamSSE`，直接用 hono `c.body(new ReadableStream(...))` 或 `c.streamText()`。

### 3.5 Client 行为

`apps/mobile/src/features/agent/hooks/useAgentRunPoll.ts` 改造（保留文件名，对外接口不变）：

```typescript
async function loop() {
  let lastIdx = 0;
  let cancelled = false;

  while (!cancelled) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 35000);  // client timeout = server max + 5s
      const resp = await fetch(
        `${baseUrl}/api/agent/runs/${runId}/long-poll?after=${lastIdx}`,
        { signal: ctl.signal, headers: { Accept: 'application/x-ndjson' } },
      );
      clearTimeout(t);

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';  // 残留最后未完整行
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.type === 'heartbeat') continue;
          if (msg.type === 'batch' || msg.type === 'idle') {
            applyUpdate(msg);
            const stepIdxs = (msg.steps ?? []).map((s) => s.idx);
            if (stepIdxs.length > 0) lastIdx = Math.max(lastIdx, ...stepIdxs);
            if (msg.run && TERMINAL.includes(msg.run.status)) cancelled = true;
          }
        }
      }
      // 连接关 → 立即重连（除非 terminal）
    } catch (err) {
      if (cancelled) break;
      await new Promise((r) => setTimeout(r, 1000));  // 错误退避
    }
  }
}
```

**RN 兼容性**：ReadableStream + fetch.body 需 RN ≥ 0.71 / Expo SDK ≥ 49。本项目 Expo 已是最新，确认 OK。  
如果意外发现不可用，回退方案：把 server 改成 hold + 一次性 JSON response（无 heartbeat），mobile 走普通 `await resp.json()` —— 牺牲 heartbeat 但保留 jitter。

### 3.6 Timeout 矩阵（部署文档同步）

| 层 | 值 | 备注 |
|---|---|---|
| Server hold | 20–30s 随机（25 ± 20%） | 单连接独立 jitter |
| Server heartbeat | 15s | 防代理 idle cut |
| Client fetch | 35s | server max(30) + 5s 余量 |
| Client error backoff | 1s | 故障重连等待 |
| Nginx / ALB（部署侧建议） | ≥60s | server hold + heartbeat 的 2× 余量 |

### 3.7 测试

- T1.t1 unit：`GET /long-poll?after=N` 当 `idx > N` 已有数据 → 立即返回 batch，不进 hold
- T1.t2 integration：无新 step 时 server hold；mock timer 让 30s 流逝 → emit idle
- T1.t3 integration：hold 期间发新 step（`runHooks.emit`）→ server 立即返回 batch
- T1.t4 unit：连续 100 次取 jitter 值 → 落 [20000, 30000] 且方差 > 0
- T1.t5 integration：run 已 terminal → 不 hold，立刻 emit batch with hasMore=false
- T1.t6 mobile：手测，详情屏看 step 出现延迟 < 200ms

---

## 4. T2：Artifact ref 跳转

### 4.1 现状

`AgentRunCard.tsx` `ArtifactBlock.onPress`：

```typescript
if (ref.kind === 'url') Linking.openURL(ref.id);
else {
  // M5: document/magi_card/diagram ref navigation not yet implemented
}
```

### 4.2 设计

| kind | 行为 | 失败兜底 |
|---|---|---|
| `url` | `Linking.openURL(ref.id)` | 不动（M5 已实现） |
| `diagram` | 调 `onJumpToStep?.(ref.id)` prop；上层（`AgentRunDetailScreen`）找到匹配 step 后 `FlatList.scrollToIndex` | 找不到 → `appAlert('未找到图表')` |
| `document` | `navigation.navigate('SettingsDocuments', { scope: 'all', highlightId: ref.id })` | `SettingsDocuments` 加 highlight 高亮 1.5s 后 fade |
| `magi_card` | `Alert.alert('MAGI 卡片', '${id}\n${label ?? ''}')` | 暂无详情屏；M7 评估 |

### 4.3 改动点

- `AgentRunCard.tsx`：`ArtifactBlock` 增加 `onJumpToStep?: (stepId: string) => void` prop；从父组件传入
- `AgentRunDetailScreen.tsx`：实现 `handleJumpToStep`；用 `useRef<FlatList>` 控制 `AgentStepList`；查 step.id → `scrollToIndex({ index, animated: true })`
- `AgentStepList.tsx`：暴露 `forwardRef<FlatList>` 给上层
- `SettingsDocumentsScreen.tsx`：
  - route param 加 `highlightId?: string`
  - render 时若 `doc.id === highlightId` → 加临时背景色 `#fff5b3`
  - `useEffect(() => setTimeout(clear, 1500), [])`
- `GroupStackParamList`：`SettingsDocuments` route 类型加 `highlightId?: string`

### 4.4 跨 navigator 跳转

`AgentRunCard` 出现位置：
- `ChatScreen` / `GroupChatScreen` 内（聊天里的 placeholder card）
- `AgentRunDetailScreen` 内（任务面板详情）

**Diagram** 跳转只在 `AgentRunDetailScreen` 有意义（详情屏才有 step list）。在 ChatScreen 里点 diagram → `Alert.alert('请进入任务详情查看图表')`。

**Document** 跳转：两个 screen 都用 `navigateBrainTab(navigation, 'SettingsDocuments', { scope: 'all', highlightId })` 跨 stack（参考 `navigateBrain.ts`）。

### 4.5 测试

- T2.t1 手测：完成一个 doc_export_markdown run → 终态点 artifact 里的 document ref → 跳文档屏 + 1.5s 高亮 fade
- T2.t2 手测：完成一个 render_diagram run → 详情屏点 diagram ref → 滚到对应 step
- T2.t3 手测：在 ChatScreen 里点 diagram → alert 提示进详情

---

## 5. T3：M5 review 遗留 fix

### 5.1 Fix A — JSONB null-clear 统一

**问题**：`store.ts` 现有：

```typescript
if ('summary' in input) values.push(JSON.stringify(input.summary));
```

`JSON.stringify(null)` 返回字符串 `"null"`，写入 JSONB 后是 JSON 标量 null 而非 SQL NULL，`WHERE summary IS NULL` 不命中。

**修法**：抽 helper

```typescript
function jsonbOrNull<T>(v: T | null | undefined): string | null {
  return v === null || v === undefined ? null : JSON.stringify(v);
}
```

应用到所有 JSONB 字段：
- `summary`
- `artifact`（已正确处理，统一后保持一致）
- `todos`、`usage`、`budget`、`plan`、`userApiKeysEnc`

### 5.2 Fix B — AgentRunCard 模型名去重

**问题**：

```typescript
// L124（header）
<Text>by {agentLlmDisplayName(run.providerId, run.modelId)}</Text>
// L160（ArtifactBlock footer，仅终态可见）
<Text>{modelName}</Text>
```

**修法**：去掉 `ArtifactBlock` 的 modelName，footer 只保留"产出于 HH:MM"和"复制全文"按钮。header 保留（running 状态也需要）。

### 5.3 测试

- T3.t1 unit：`updateAgentRun({ summary: null })` → reload → `summary === null`；同样测 `artifact: null`、`plan: null`
- T3.t2 unit：existing summary 测试不破（回归）
- T3.t3 手测：终态 AgentRunCard 模型名只出现一次

---

## 6. T4：`youtube_transcript` 工具

### 6.1 接口

```typescript
type Input = {
  url: string;           // YouTube watch URL or video ID
  lang?: 'zh-CN' | 'en' | 'auto';  // 默认 'auto'
};

type Output =
  | { ok: true; videoId: string; title: string; transcript: string;
      chunks: Array<{ start: number; duration: number; text: string }>;
      lang: string; truncated: boolean }
  | { ok: false; reason: 'invalid_url' | 'no_transcript' | 'fetch_failed';
      videoId?: string };
```

### 6.2 实现

**选型**：`youtube-transcript`（npm，纯 client，无 API key，~50KB）

- 优点：无需 API key，无 OAuth，零部署成本
- 缺点：依赖 YouTube 内部接口，可能某天失效（fallback：返回 `ok:false, reason:'fetch_failed'`，soft-fail）

实现：
```typescript
import { YoutubeTranscript } from 'youtube-transcript';

const chunks = await YoutubeTranscript.fetchTranscript(videoId, { lang });
const text = chunks.map(c => c.text).join(' ');
// 超 10k token（粗估 30k char）截断
const truncated = text.length > 30000;
```

**title** 怎么拿：`youtube-transcript` 不返回 title。从 `https://www.youtube.com/watch?v=<id>` 直接 fetch HTML 抽 `<title>` tag（一个 fetch + regex，带 3s timeout）。失败兜底 `title=videoId`，不阻塞 transcript 返回。

### 6.3 注册

- `apps/api/src/lib/agent/tools/youtubeTranscript.ts` 新建
- `registerAgentTools.ts` 加 `registerYoutubeTranscript()`
- `planner.ts` 的 `PLANNER_INSTRUCTION` 加一行："YouTube 视频链接 → 用 `youtube_transcript` 获取字幕"

### 6.4 测试

- T4.t1 unit：mock `YoutubeTranscript.fetchTranscript` 返回 chunks → 拼接 transcript 正确，chunks 透传
- T4.t2 unit：mock throw → 返回 `{ ok: false, reason: 'fetch_failed' }`
- T4.t3 unit：URL parsing：watch URL / short URL / 直接 videoId 三种输入都能解出 videoId
- T4.t4 unit：transcript > 30000 char → `truncated: true`，文本截断到 30000

---

## 7. 风险与回滚

| 风险 | 评估 | 缓解 |
|---|---|---|
| RN ReadableStream 不可用 | 低（Expo SDK 已支持） | 回退：server 改成一次性 JSON 响应 + jitter（牺牲 heartbeat） |
| `youtube-transcript` 包某天失效 | 中（依赖 YT 内部 API） | soft-fail 已是设计；planner 自然 replan |
| `jsonbOrNull` 重构影响其他 caller | 低 | 全量测试守住，逐字段对照 |
| AgentRunDetailScreen FlatList ref 改造引入回归 | 低 | 仅加 forwardRef，不动渲染逻辑 |

**回滚**：每个 T 独立 commit；T1 失败 → revert 即可，老 polling 自动 restore；T4 失败 → remove register 即可，不影响其他工具。

---

## 8. 估时

| Task | 估时 |
|---|---|
| T0 分支 + baseline | 0.1 天 |
| T1 long-poll + jitter + heartbeat（后端 + mobile） | 0.6 天 |
| T2 artifact ref 跳转 + highlight | 0.4 天 |
| T3 jsonbOrNull + 模型名去重 | 0.2 天 |
| T4 youtube_transcript | 0.5 天 |
| T9 review + merge + tag | 0.2 天 |

**合计 2 天**（含 review）。

---

## 9. 验收

1. ✅ Mobile 详情屏看 step 出现延迟 < 200ms（手测）
2. ✅ jitter 测试 100 次落 [20000, 30000] 且方差 > 0
3. ✅ Long-poll 期间收到 ≥1 个 heartbeat（手测：开浏览器开 Network）
4. ✅ Artifact `document` ref 跳文档屏 + 高亮 fade
5. ✅ Artifact `diagram` ref 在详情屏滚到 step
6. ✅ `updateAgentRun({ summary: null })` → DB `IS NULL`
7. ✅ AgentRunCard 终态模型名只 1 处
8. ✅ `youtube_transcript` 工具可被 planner 选中，给定 YouTube URL 返回 transcript

---

## 10. 未来升级路径

| 升级 | 路径 |
|---|---|
| 切 SSE | `text/event-stream` 替换 ndjson、heartbeat 改 `: heartbeat\n\n`、jitter 不变；客户端用 `react-native-sse` polyfill |
| 切 WebSocket | ping/pong 20–30s 间隔；reconnect 时加 jitter |
| Thundering herd grace period | server 启动 50ms 内拒绝 new connection；M6 不做 |
| MAGI 卡片详情屏 | 独立 mini-feature，M7 评估 |
| 飞书 / 地图 / B 站 transcript | 工具集补完，M7+ |

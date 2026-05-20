# 行动中止派 — 家人辅助写作 App

双端（Expo）+ Node API。写作与问答分开；多文稿标签；增删对比与版本回滚；全中文界面。

**API 专用端口：`3922`**（避免与 3000、3001、3100 等常见端口冲突）

## 结构

```
apps/mobile     # Expo React Native
apps/api        # Hono API
packages/shared # 类型、错误文案、时间格式化、diff
docker-compose.yml
```

## 方式一：Docker 跑后端（推荐）

```bash
cd /Users/hongpengwang/行动中止派

# 复制环境变量（Docker 必填 JWT_SECRET，至少 32 字符随机串）
cp .env.example .env
# 编辑 .env：JWT_SECRET=... 以及可选 DEEPSEEK_API_KEY=sk-...
# 生成 JWT：openssl rand -base64 32

# 构建并启动（端口 3922）
npm run docker:up

# 查看日志
npm run docker:logs

# 停止
npm run docker:down
```

验证：`curl http://localhost:3922/health`

## 方式二：本机直接跑 API

```bash
npm install
npm run build -w @xzz/shared
npm run dev:api   # 同样使用 3922 端口
npm run test      # shared 包单元测试
npm run typecheck # 全仓库类型检查
```

## 启动手机端

```bash
npm run dev:mobile
```

- iOS 模拟器：`http://localhost:3922`
- Android 模拟器：`http://10.0.2.2:3922`
- 真机：`EXPO_PUBLIC_API_URL=http://你的电脑IP:3922 npm run dev:mobile`

## 第一阶段已实现

- [x] 写作 / 问答 / 我的 三 Tab
- [x] 写作多标签、切换文稿
- [x] 续写/润色 → 绿增灰删对比 → 同意/拒绝
- [x] 历史版本（按天 · 周几 · 午别 · 几点）与回滚
- [x] 问答自由聊天 + 朗读回复
- [x] DeepSeek Pro（`deepseek-v4-pro`）
- [x] 「我的」里填写密钥
- [x] Docker 部署 API（端口 3922）
- [ ] 本地听写 / 飞书导出（待接）

## DeepSeek 密钥

1. [platform.deepseek.com](https://platform.deepseek.com/api_keys) 申请  
2. App → **我的** → 填入密钥 → **测试一下**  
3. 或写入 `.env` 给 Docker：`DEEPSEEK_API_KEY=sk-...`

## Agent Runtime（M1a）

后台多步 agent 执行能力。**M1a 范围**：私聊触发、echo mock 工具、worker 后台跑、取消 / SSE 流。群聊 + LLM planner + approval / steer / critique / 真实工具 / mobile UI 留 M1b-d。

**入口**：私聊里发 `/agent 跑三步 echo` —— `intentRules` 把它识别为 `agent_run`，`intentExecute` 异步创建 `agent_runs` 行 + 占位 assistant 消息，worker 后台 pickup 执行。

**HTTP / SSE**（均挂在 `/api/agent`，需登录）：

- `POST /api/intent/execute` 带 `kind: 'agent_run'` 触发任务
- `GET /api/agent/runs/:id` 取任务详情（run + 全部 steps）
- `GET /api/agent/runs/:id/stream`（SSE）实时推送 `step` / `status` / `end` 事件
- `POST /api/agent/runs/:id/cancel` 取消
- `POST /api/agent/runs/:id/confirm` 通过 `awaiting_confirm` 状态（M1b 才用）

**测试 / 开发注意事项**：

- agent runtime 的集成测试依赖共享 PG，跑测试前**先确保没有 `npm run dev:api` 在跑** —— 否则 worker 进程会和 vitest 进程争抢 `agent_runs`。worker 在 `process.env.NODE_ENV=test` / `VITEST=1` 时会自动跳过 pickup，但只对 vitest 进程本身生效，无法影响其他 node 进程。
- `apps/api/vitest.config.ts` 用 `singleFork + fileParallelism:false` 串行执行，避免 db-写测试互相 `DELETE`。
- 跑 db 集成测试要先 `set -a; source .env; set +a` 注入 `DATABASE_URL`。

**设计 / 实现细节**：

- 设计文档：`docs/superpowers/specs/2026-05-20-agent-runtime-design.md`
- M1a 实现计划：`docs/superpowers/plans/2026-05-20-agent-runtime-m1a.md`
- 关键代码：`apps/api/src/lib/agent/*`，迁移：`apps/api/src/db/migrations/012_agent_runtime.sql`

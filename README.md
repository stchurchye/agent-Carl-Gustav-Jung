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

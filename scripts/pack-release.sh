#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DATE=$(date +%Y%m%d)
RELEASE_DIR="dist/release-${DATE}"
mkdir -p "$RELEASE_DIR"

if ! docker info >/dev/null 2>&1; then
  echo "Docker 未运行，正在尝试启动 Docker Desktop…" >&2
  open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true
  for i in $(seq 1 45); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
fi
./scripts/pack-verify.sh

echo "==> 准备生产 node_modules"
npm ci --omit=dev

echo "==> Docker 镜像（dist + 宿主机 node_modules）"
docker compose stop api 2>/dev/null || true
pkill -f 'apps/api/dist/index.js' 2>/dev/null || true
docker compose rm -f api 2>/dev/null || true
if ! docker compose build api; then
  echo "Docker 构建失败" >&2
  exit 1
fi
docker compose up -d postgres 2>/dev/null || true
sleep 2
docker compose up -d api
echo "等待 API 容器就绪…"
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:3922/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
HEALTH=$(curl -sf http://127.0.0.1:3922/health || echo '{}')
echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok'), d" \
  || { docker compose logs api --tail 30; exit 1; }
echo -e "\033[0;32m✓\033[0m Docker 容器 /health 通过"

echo "==> 生成发布目录 $RELEASE_DIR"
cp -r apps/api/dist "$RELEASE_DIR/api-dist"
cp -r packages/shared/dist "$RELEASE_DIR/shared-dist"
cp docker-compose.yml .env.example "$RELEASE_DIR/"
cp scripts/pack-verify.sh "$RELEASE_DIR/"
mkdir -p "$RELEASE_DIR/mobile-export"
cp -r apps/mobile/dist/* "$RELEASE_DIR/mobile-export/"

cat > "$RELEASE_DIR/DEPLOY.md" <<'EOF'
# 部署

1. `cp .env.example .env` 并填写 `DATABASE_URL`、`JWT_SECRET`
2. `docker compose up -d postgres`
3. `npm ci && node api-dist/index.js`（在 monorepo 根目录用 `node apps/api/dist/index.js`）
4. 移动端开发：`npm run dev:mobile`
EOF

ARCHIVE="dist/xzz-release-${DATE}.tar.gz"
tar -czf "$ARCHIVE" -C dist "$(basename "$RELEASE_DIR")"
echo "已生成: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
echo ""
echo -e "\033[0;32m打包与测试全部完成。\033[0m"
echo "继续本地开发请执行: npm install  （pack 使用了 npm ci --omit=dev）"


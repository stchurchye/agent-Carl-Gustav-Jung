#!/usr/bin/env bash
# 打包后验收：编译、迁移文件、API 冒烟、移动端 export
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo "==> 1/7 npm run build"
npm run build

echo "==> 2/7 typecheck"
npm run typecheck

echo "==> 3/7 单元测试"
npm run test

echo "==> 4/7 检查迁移 SQL 已复制到 dist"
for f in 001_initial.sql 002_social.sql 003_intelligence.sql; do
  test -f "apps/api/dist/db/migrations/$f" || fail "缺少 apps/api/dist/db/migrations/$f"
done
pass "迁移文件齐全"

echo "==> 5/7 启动 Postgres（若未运行）"
if ! docker info >/dev/null 2>&1; then
  fail "Docker 未运行，请先启动 Docker Desktop"
fi
docker compose up -d postgres
for i in $(seq 1 60); do
  if nc -z 127.0.0.1 5433 2>/dev/null; then
    break
  fi
  sleep 1
done
nc -z 127.0.0.1 5433 2>/dev/null || fail "Postgres 未在 127.0.0.1:5433 就绪"
# 使用 127.0.0.1，避免 localhost 解析到 ::1 导致 ECONNREFUSED
export DATABASE_URL="postgresql://xzz:xzz_dev_password@127.0.0.1:5433/xzz_app"

echo "==> 6/7 API 冒烟测试"
# 勿对 :3922 盲目 kill -9：Docker 代理占用该端口时会导致 5433 等端口转发一并失效
docker compose stop api 2>/dev/null || true
pkill -f 'apps/api/dist/index.js' 2>/dev/null || true
sleep 1
node apps/api/dist/index.js &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:3922/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

HEALTH=$(curl -sf "http://127.0.0.1:3922/health")
echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok') and d.get('db'), d" \
  || fail "health 检查失败: $HEALTH"
pass "GET /health ok + db"

LOGIN=$(curl -sf -X POST "http://127.0.0.1:3922/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo1234"}')
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['accessToken'])")

curl -sf "http://127.0.0.1:3922/api/documents" -H "Authorization: Bearer $TOKEN" >/dev/null \
  || fail "GET /api/documents 失败"
pass "JWT + documents"

kill $API_PID 2>/dev/null || true
trap - EXIT

echo "==> 7/7 移动端 export"
npm run pack:mobile
test -f apps/mobile/dist/metadata.json || fail "expo export 缺少 metadata.json"
test -d apps/mobile/dist/_expo/static/js/ios || fail "缺少 iOS bundle"
test -d apps/mobile/dist/_expo/static/js/android || fail "缺少 Android bundle"
pass "expo export 完成"

echo ""
echo -e "${GREEN}全部打包验收通过${NC}"

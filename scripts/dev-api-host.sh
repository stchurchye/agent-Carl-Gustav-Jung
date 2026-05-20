#!/usr/bin/env bash
# 本机跑 API（可访问 zenmux.ai）；Postgres 仍用 Docker
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "确保 Postgres 已启动…"
docker compose up -d postgres

if docker ps --format '{{.Names}}' | grep -q '^xzz-api$'; then
  echo "停止 Docker 里的 API（容器内往往连不上 zenmux.ai）…"
  docker stop xzz-api >/dev/null
fi

export PORT="${PORT:-3922}"
export DATABASE_URL="${DATABASE_URL:-postgresql://xzz:xzz_dev_password@127.0.0.1:5433/xzz_app}"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT/.env"
  set +a
fi

echo "本机 API: http://127.0.0.1:${PORT}  (DATABASE_URL -> 5433)"
exec npm run dev -w @xzz/api

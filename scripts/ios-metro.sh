#!/usr/bin/env bash
# 启动行动中止派 Metro（8090），供 Xcode / 模拟器使用
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${RCT_METRO_PORT:-8090}"
cd "$ROOT/apps/mobile"

if lsof -i ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Metro 已在运行: http://localhost:$PORT"
  exit 0
fi

echo "启动 Metro: http://localhost:$PORT"
exec npx expo start --localhost --port "$PORT"

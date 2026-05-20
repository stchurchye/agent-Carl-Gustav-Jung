#!/usr/bin/env bash
# Docker 启动前检查：避免生产容器使用弱 JWT
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${JWT_SECRET:-}" ]]; then
  echo "错误：未设置 JWT_SECRET。" >&2
  echo "请执行：cp .env.example .env" >&2
  echo "然后编辑 .env，将 JWT_SECRET 设为随机长字符串（例如：openssl rand -base64 32）" >&2
  exit 1
fi

if [[ "$JWT_SECRET" == "请换成随机长字符串" ]] || [[ ${#JWT_SECRET} -lt 32 ]]; then
  echo "错误：JWT_SECRET 过弱（至少 32 字符，勿使用 .env.example 中的占位文案）。" >&2
  exit 1
fi

echo "✓ Docker 预检通过（JWT_SECRET 已配置）"

#!/usr/bin/env bash
# 模拟器重新连接本机 Metro（8090）
set -euo pipefail
PORT="${RCT_METRO_PORT:-8090}"
xcrun simctl openurl booted "com.anonymous.xzz://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${PORT}" 2>/dev/null \
  || xcrun simctl openurl booted "http://127.0.0.1:${PORT}"
echo "已请求模拟器连接 http://127.0.0.1:${PORT}"

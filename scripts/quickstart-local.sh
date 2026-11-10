#!/usr/bin/env bash
# MERIDIAN 一键启动（不用 Docker，直接跑源码）：需要 Node.js 24+。
# 用法：bash scripts/quickstart-local.sh        前台运行，Ctrl-C 停止
#      PORT=3100 bash scripts/quickstart-local.sh
set -Eeuo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "未找到 node，请安装 Node.js 24+（https://nodejs.org）。" >&2; exit 1; }
node -e 'process.exit(+process.versions.node.split(".")[0]>=24?0:1)' \
  || { echo "需要 Node.js 24 或更高版本，当前 $(node -v)。" >&2; exit 1; }
node -e 'require("node:sqlite")' 2>/dev/null \
  || { echo "当前 Node 缺少内置 SQLite（node:sqlite），请换官方 Node 24 构建。" >&2; exit 1; }

if [[ -f .env ]]; then
  echo "检测到已有 .env，保持不变"
else
  PW=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))")
  sed -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${PW}|" -e "s|^DATA_DIR=.*|DATA_DIR=./data|" \
      -e "s|^HOST=.*|HOST=127.0.0.1|" .env.example > .env
  unset PW
  chmod 600 .env
  echo "已生成 .env（管理员密码：grep ADMIN_PASSWORD .env）"
fi

[[ -n ${PORT:-} ]] && sed -i.bak "s|^PORT=.*|PORT=${PORT}|" .env && rm -f .env.bak

echo
echo "前台  http://127.0.0.1:${PORT:-3000}/"
echo "后台  http://127.0.0.1:${PORT:-3000}/admin   （密码：grep ADMIN_PASSWORD .env）"
echo "数据  $(grep '^DATA_DIR=' .env | cut -d= -f2)   Ctrl-C 停止"
echo
exec node --env-file=.env server.js

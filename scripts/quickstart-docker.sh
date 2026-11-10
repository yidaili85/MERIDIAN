#!/usr/bin/env bash
# MERIDIAN 一键启动（Docker）：生成 .env、构建镜像、启动、等待健康检查。
# 用法：bash scripts/quickstart-docker.sh
set -Eeuo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "未找到 docker，请先安装 Docker Engine 或 Docker Desktop。" >&2; exit 1; }
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null; then
  DC="docker-compose"
else
  echo "未找到 docker compose 插件，请安装 docker-compose-plugin。" >&2; exit 1
fi
docker info >/dev/null 2>&1 || { echo "Docker 未运行，请先启动 Docker 服务。" >&2; exit 1; }

if [[ -f .env ]]; then
  echo "检测到已有 .env，保持不变"
else
  if command -v node >/dev/null; then
    PW=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))")
  elif command -v openssl >/dev/null; then
    PW=$(openssl rand -hex 24)
  else
    echo "需要 node 或 openssl 生成管理员密码" >&2; exit 1
  fi
  sed "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${PW}|" .env.example > .env
  unset PW
  chmod 600 .env
  echo "已生成 .env（管理员密码在文件里：grep ADMIN_PASSWORD .env）"
fi

echo "构建并启动容器…"
$DC up -d --build

echo "等待健康检查…"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/healthz 2>/dev/null; then
    echo
    echo "启动成功："
    echo "  前台  http://127.0.0.1:3000/"
    echo "  后台  http://127.0.0.1:3000/admin"
    echo "  密码  grep ADMIN_PASSWORD .env"
    echo
    echo "常用命令： $DC logs -f meridian  |  $DC down  |  $DC up -d --build"
    exit 0
  fi
  sleep 1
done

echo "健康检查未通过，最近日志：" >&2
$DC logs --tail=50 meridian >&2 || true
exit 1

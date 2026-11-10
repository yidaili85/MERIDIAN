#!/usr/bin/env bash
# 检查「保存 / 发布」这条链路在服务端是否正常，并打印每一步的结果。
# 用法：bash scripts/publish-check.sh
# 说明：密码只在服务器本地读取，用临时文件传给 curl，不会打印、不进命令行历史。
set -uo pipefail

BASE=${MERIDIAN_DIR:-}
if [[ -z $BASE ]]; then
  for d in "$HOME/.local/share/meridian" /root/.local/share/meridian; do
    [[ -f $d/shared/config.env ]] && BASE=$d && break
  done
fi
[[ -n $BASE ]] || { echo "找不到安装目录，请设置 MERIDIAN_DIR"; exit 1; }

CONFIG=$BASE/shared/config.env
PORT=$(grep -E '^PORT=' "$CONFIG" | cut -d= -f2); PORT=${PORT:-3000}
URL="http://127.0.0.1:$PORT"
PW=$(grep -E '^ADMIN_PASSWORD=' "$CONFIG" | cut -d= -f2-)
[[ -n $PW ]] || { echo "config.env 里没有 ADMIN_PASSWORD"; exit 1; }

JAR=$(mktemp); BODY=$(mktemp); PAY=$(mktemp); OUT=$(mktemp)
chmod 600 "$JAR" "$BODY" "$PAY" "$OUT"
trap 'rm -f "$JAR" "$BODY" "$PAY" "$OUT"' EXIT

printf '{"password":"%s"}' "$PW" > "$PAY"
printf '== 登录 ==\n'
curl -s -c "$JAR" -X POST "$URL/api/login" -H 'Content-Type: application/json' --data-binary @"$PAY" -o "$OUT" -w 'HTTP %{http_code}\n'
head -c 200 "$OUT"; echo

printf '\n== 读取后台内容 ==\n'
curl -s -b "$JAR" "$URL/api/admin/content" -o "$BODY" -w 'HTTP %{http_code}\n'
if head -c 1 "$BODY" | grep -q '{'; then
  node -e '
    const fs=require("fs");
    const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    console.log("阈值项:", ["pages","categories","products","sections"].map(k=>k+"="+(Array.isArray(c[k])?c[k].length:"缺失")).join("  "));
    const bad=c.products.filter(p=>typeof p.badge!=="string");
    console.log("缺少 badge 字段的商品:", bad.length, bad.slice(0,3).map(p=>p.name).join(" / "));
  ' "$BODY" 2>/dev/null
else
  head -c 200 "$BODY"; echo
fi

printf '\n== 原样保存（模拟点“保存草稿”）==\n'
curl -s -b "$JAR" -X PUT "$URL/api/admin/content" -H 'Content-Type: application/json' --data-binary @"$BODY" -o "$OUT" -w 'HTTP %{http_code}  '; head -c 300 "$OUT"; echo

printf '\n== 发布 ==\n'
curl -s -b "$JAR" -X POST "$URL/api/admin/publish" -H 'Content-Type: application/json' -d '{}' -o "$OUT" -w 'HTTP %{http_code}  '; head -c 300 "$OUT"; echo

printf '\n== 前台是否可见发布结果 ==\n'
curl -s -o /dev/null -w '/  HTTP %{http_code}\n' "$URL/"
curl -s -o /dev/null -w '/privacy  HTTP %{http_code}\n' "$URL/privacy"

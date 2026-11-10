#!/usr/bin/env bash
# 一次性收集排障信息。用法：
#   bash scripts/diagnose.sh            # 打印到屏幕
#   bash scripts/diagnose.sh > diag.txt # 存成文件再发出去
# 不会输出密码、密钥或顾客资料。
set -uo pipefail

INSTALL=${MERIDIAN_DIR:-}
if [[ -z $INSTALL ]]; then
  for d in "$HOME/.local/share/meridian" /root/.local/share/meridian /opt/meridian; do
    [[ -d $d ]] && INSTALL=$d && break
  done
fi
SRC=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
# 源码仓库可能在别处（安装目录只有 releases）
for cand in "${MERIDIAN_REPO:-}" "$HOME/meridian-store" "$HOME/MERIDIAN" /root/meridian-store; do
  [[ -n $cand && -d $cand/.git ]] && SRC=$cand && break
done
BASE=${INSTALL:-$SRC}
PORT=$(grep -E '^PORT=' "$BASE/shared/config.env" 2>/dev/null | cut -d= -f2); PORT=${PORT:-3000}
URL="http://127.0.0.1:$PORT"

echo "=== 时间 ==="; date -u '+%Y-%m-%dT%H:%M:%SZ'
echo
echo "=== 源码仓库 ==="
if [[ -d $SRC/.git ]]; then
  git -C "$SRC" log --oneline -3 2>&1
  echo "--- 工作区状态 ---"; git -C "$SRC" status -sb 2>&1 | head -8
  echo "--- 远端 ---"; git -C "$SRC" remote -v 2>&1 | head -2
else
  echo "不是 git 仓库：$SRC"
fi
echo
echo "=== 运行中的版本 ==="
echo "安装目录: $BASE"
[[ -L $BASE/current ]] && echo "current -> $(readlink -f "$BASE/current")"
[[ -f $BASE/shared/server.pid ]] && echo "PID: $(cat "$BASE/shared/server.pid")"
ps -o pid,etimes,args -p "$(cat "$BASE/shared/server.pid" 2>/dev/null)" 2>/dev/null | tail -2
echo
echo "=== 版本指纹 ==="
echo -n "server /api/version : "; curl -s --max-time 5 "$URL/api/version" || echo "(无响应)"
echo
for p in /healthz /privacy /terms /shipping /returns /admin /admin.js; do
  printf '%-12s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL$p")"
done
echo -n "admin.js 含账号安全: "; curl -s --max-time 5 "$URL/admin.js" | grep -c '账号安全'
echo -n "style.css 版本参数 : "; curl -s --max-time 5 "$URL/admin" | grep -o 'style.css?v=[a-z0-9]*' | head -1 || true
echo
echo "=== 关键文件时间 ==="
for f in server.js public/admin.js public/style.css countries.js; do stat -c "%y  %n" "$BASE/current/$f" 2>/dev/null; done
echo
echo "=== server.log（最后 30 行）==="
tail -n 30 "$BASE/shared/server.log" 2>&1
echo
echo "=== last-tests.log（最后 15 行）==="
tail -n 15 "$BASE/shared/last-tests.log" 2>&1 || echo "(没有这个文件，说明测试没跑过或全部通过)"
echo
echo "=== 磁盘 / 内存 ==="
df -h "$BASE" 2>&1 | tail -1
free -m 2>/dev/null | head -2 || true
echo
echo "=== 结束 ==="

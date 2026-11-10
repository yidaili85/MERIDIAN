#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
BASE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
PIDFILE=$BASE/shared/server.pid
NODE=$(cat "$BASE/runtime-path")
owned_pid() {
  [[ -f $PIDFILE ]] || return 1
  local pid
  read -r pid < "$PIDFILE"
  [[ $pid =~ ^[0-9]+$ && -r /proc/$pid/cmdline ]] || return 1
  # Never stop a reused PID or an unrelated Node process.
  [[ $(readlink "/proc/$pid/cwd" 2>/dev/null) == "$BASE"/releases/* ]] || return 1
  tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "$BASE/shared/config.env" || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}
case ${1:-status} in
  diag)
    if [[ -f $BASE/current/scripts/diagnose.sh ]]; then
      MERIDIAN_DIR=$BASE exec bash "$BASE/current/scripts/diagnose.sh"
    fi
    printf 'diagnose.sh 不在当前版本里，请先执行 git pull 并重新安装。\n' >&2
    exit 1
    ;;
  run)
    cd "$BASE/current"
    export DATA_DIR=$BASE/shared/data
    exec "$NODE" --env-file "$BASE/shared/config.env" server.js
    ;;
  start)
    if pid=$(owned_pid); then printf 'Already running (PID %s).\n' "$pid"; exit 0; fi
    # Detect port conflicts before launching; run a live HTTP check after launch.
    "$NODE" --env-file "$BASE/shared/config.env" --input-type=module -e '
      import net from "node:net";
      const host=process.env.HOST||"127.0.0.1", port=Number(process.env.PORT||3000);
      const s=net.createServer();s.once("error",()=>{console.error("Configured host/port is unavailable. Check HOST/PORT and other services.");process.exit(1);});s.listen(port,host,()=>s.close());'
    nohup "$BASE/bin/meridian" run >> "$BASE/shared/server.log" 2>&1 < /dev/null &
    pid=$!
    printf '%s\n' "$pid" > "$PIDFILE"
    if ! "$NODE" --env-file "$BASE/shared/config.env" --input-type=module -e '
      const host=process.env.HOST||"127.0.0.1";
      const addr=host==="0.0.0.0"?"127.0.0.1":host==="::"?"[::1]":host.includes(":")?`[${host}]`:host;
      const url=`http://${addr}:${process.env.PORT||3000}/api/payments/methods`;
      let ok=false;for(let i=0;i<50;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});const d=await r.json();if(r.ok&&typeof d.paypal==="boolean"&&typeof d.usdt==="boolean"){ok=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
      if(!ok){console.error("Readiness request failed. Inspect shared/server.log.");process.exit(1);}' || ! owned_pid >/dev/null; then
      if owned_pid >/dev/null; then kill "$pid" 2>/dev/null || true; fi
      rm -f -- "$PIDFILE"
      exit 1
    fi
    printf 'Store started (PID %s); HTTP readiness passed.\n' "$pid"
    ;;
  stop)
    if pid=$(owned_pid); then
      kill "$pid"
      for ((i=0;i<50;i++)); do if ! owned_pid >/dev/null; then break; fi; sleep 0.1; done
      if owned_pid >/dev/null; then printf 'Process did not stop. Inspect it before retrying.\n' >&2; exit 1; fi
      rm -f -- "$PIDFILE"
      printf 'Store stopped.\n'
    else
      printf 'No managed background process is running.\n'
    fi
    ;;
  restart) "$0" stop; "$0" start;;
  status) if pid=$(owned_pid); then printf 'Running (PID %s).\n' "$pid"; else printf 'No managed background process is running.\n'; exit 1; fi;;
  logs) tail -n 80 -f -- "$BASE/shared/server.log";;
  *) printf 'Usage: %s {start|stop|restart|status|logs|run}\n' "$0" >&2; exit 2;;
esac

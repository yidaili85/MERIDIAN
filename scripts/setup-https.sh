#!/usr/bin/env bash
# 一条命令搞定：Caddy 自动 HTTPS + 反向代理到本机商城
#
#   bash setup-https.sh shop.example.com
#
# 做的事：
#   1. 安装 Caddy（apt 官方源；没有 apt 就用官方静态二进制 + systemd）
#   2. 写 /etc/caddy/Caddyfile：域名 → 127.0.0.1:3000，自动申请证书、自动续期
#   3. 打开防火墙 80/443（ufw / firewalld 都支持）
#   4. 把商城改成 HTTPS 模式：PUBLIC_BASE_URL=https://域名、COOKIE_SECURE=true，然后重启
#   5. 验证 https://域名/healthz
#
# 前提：域名的 A 记录已经指向这台服务器，且云厂商安全组放行 80/443。
set -Eeuo pipefail

DOMAIN=${1:-}
SKIP_DNS=0
DRY=0
for a in "$@"; do
  case $a in --skip-dns-check) SKIP_DNS=1;; --dry-run) DRY=1;; esac
done
PORTS_OK=1

die(){ printf '\nERROR: %s\n' "$*" >&2; exit 1; }
say(){ printf '%s\n' "$*"; }
step(){ printf '\n== %s ==\n' "$*"; }

[[ -n $DOMAIN ]] || die "用法: bash setup-https.sh 你的域名（例如 shop.example.com）"
[[ $DOMAIN =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$ ]] || die "域名格式不对：$DOMAIN"
((DRY)) || [[ $EUID -eq 0 ]] || die "需要 root 权限（要装服务、改防火墙）。前面加 sudo 再跑。
想先看看会做什么：bash setup-https.sh $DOMAIN --dry-run"

step "1/5 检查域名与端口"
SERVER_IP=$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 8 https://ifconfig.me 2>/dev/null || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
say "服务器公网 IP: ${SERVER_IP:-未知}"
say "域名解析到  : ${DNS_IP:-未解析}"
if [[ $SKIP_DNS -eq 0 ]]; then
  [[ -n $DNS_IP ]] || die "域名还没解析。请先在 DNS 里加 A 记录：$DOMAIN → ${SERVER_IP:-服务器IP}，等 1~10 分钟再跑。"
  if [[ -n $SERVER_IP && $DNS_IP != "$SERVER_IP" ]]; then
    say "警告：域名指向 $DNS_IP，不是本机 $SERVER_IP。"
    say "     如果用了 Cloudflare 代理（橙色云），请先改成仅 DNS（灰色云），否则证书申请会失败。"
    read -r -p "仍然继续？[y/N] " ans
    [[ ${ans:-} == [yY] ]] || die "已取消。"
  fi
fi
for p in 80 443; do
  if ss -H -ltn "sport = :$p" 2>/dev/null | grep -q .; then
    PORTS_OK=0
    say "警告：端口 $p 已被占用 —— $(ss -H -ltnp "sport = :$p" 2>/dev/null | head -1)"
  fi
done
((PORTS_OK)) || say "继续执行；如果一会儿 Caddy 起不来，先停掉占用 80/443 的服务（常见：nginx、apache、宝塔）。"

if ((DRY)); then
  step "预览 Caddyfile（dry-run，不做任何改动）"
  cat <<CADDY_PREVIEW
${DOMAIN} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY_PREVIEW
  say ""
  say "dry-run 结束。去掉 --dry-run 即会真的安装并申请证书。"
  exit 0
fi

step "2/5 安装 Caddy"
if command -v caddy >/dev/null 2>&1; then
  say "已安装：$(caddy version 2>/dev/null | head -1)"
elif command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
  say "已通过 apt 安装 Caddy"
else
  case $(uname -m) in
    x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) die "不支持的架构：$(uname -m)";;
  esac
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$ARCH" -o /usr/local/bin/caddy
  chmod +x /usr/local/bin/caddy
  useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy 2>/dev/null || true
  mkdir -p /etc/caddy /var/lib/caddy
  chown -R caddy:caddy /var/lib/caddy /etc/caddy
  cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target
[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  say "已安装官方静态二进制到 /usr/local/bin/caddy"
fi

step "3/5 写 Caddyfile"
mkdir -p /etc/caddy
if [[ -f /etc/caddy/Caddyfile ]] && ! grep -q "reverse_proxy 127.0.0.1:3000" /etc/caddy/Caddyfile 2>/dev/null; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  say "已备份原有 Caddyfile"
fi
cat > /etc/caddy/Caddyfile <<CADDY
{
	email admin@${DOMAIN#*.}
	# 不要在这里放 admin off，否则拿不到证书
}

${DOMAIN} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Real-IP {remote_host}
	}
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
	log {
		output file /var/log/caddy/${DOMAIN}.log
		format console
	}
}
CADDY
mkdir -p /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || die "Caddyfile 校验失败，检查 /etc/caddy/Caddyfile"
say "Caddyfile 已写入并校验通过"

step "4/5 防火墙"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && say "ufw 已放行 80/443"
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-service=http >/dev/null
  firewall-cmd --permanent --add-service=https >/dev/null
  firewall-cmd --reload >/dev/null && say "firewalld 已放行 http/https"
else
  say "没有活动的 ufw/firewalld，跳过（云厂商安全组请自行放行 80/443）"
fi

step "5/5 启动 Caddy 并接上商城"
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy || die "Caddy 启动失败：journalctl -u caddy -n 40 --no-pager"
sleep 2

BASE=${MERIDIAN_DIR:-}
if [[ -z $BASE ]]; then
  for d in "$HOME/.local/share/meridian" /root/.local/share/meridian; do
    [[ -f $d/shared/config.env ]] && BASE=$d && break
  done
fi
if [[ -n $BASE ]]; then
  CFG=$BASE/shared/config.env
  cp "$CFG" "$CFG.bak.$(date +%s)"
  set_kv(){ # key value
    if grep -qE "^$1=" "$CFG"; then
      sed -i "s|^$1=.*|$1=$2|" "$CFG"
    else
      printf '%s=%s\n' "$1" "$2" >> "$CFG"
    fi
  }
  set_kv PUBLIC_BASE_URL "https://$DOMAIN"
  set_kv COOKIE_SECURE "true"
  say "已设置 PUBLIC_BASE_URL=https://$DOMAIN、COOKIE_SECURE=true"
  if [[ -x $BASE/bin/meridian ]]; then
    $BASE/bin/meridian restart && say "商城已重启（HTTPS 模式）"
  else
    say "没找到 $BASE/bin/meridian，请手动重启商城"
  fi
else
  say "没找到商城配置（shared/config.env），跳过；记得手动把 PUBLIC_BASE_URL 设成 https://$DOMAIN"
fi

step "验证"
printf 'https://%s/healthz  →  ' "$DOMAIN"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN/healthz" || echo 000)
printf '%s\n' "$CODE"
if [[ $CODE == 200 ]]; then
  cat <<DONE

✅ 完成。用这个地址：
   前台   https://$DOMAIN
   后台   https://$DOMAIN/admin

证书由 Caddy 自动申请和续期（Let's Encrypt），60 天左右自动刷新，无需管。
以后重启服务器，Caddy 和商城都会自动起来。
DONE
else
  cat <<FAIL

❌ HTTPS 还没通（状态码 $CODE）。按下面顺序排查：

  1. 看 Caddy 日志：
       journalctl -u caddy -n 40 --no-pager
  2. 常见原因：
     · 云安全组没放行 80/443        → 控制台里加规则
     · 域名用了 Cloudflare 橙色云   → 改成仅 DNS（灰色云）后重试
     · 80 被 nginx/宝塔占用         → 停掉它：systemctl stop nginx
     · DNS 还没生效                 → dig +short $DOMAIN
  3. 修好后重跑同一条命令即可（幂等，不会重复装）。
FAIL
  exit 1
fi

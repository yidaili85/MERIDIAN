#!/usr/bin/env bash
# 一条命令：域名 + 自动 HTTPS + 反向代理到本机商城（127.0.0.1:3000）
#
#   bash setup-https.sh demo.example.com
#   bash setup-https.sh demo.example.com --dry-run        # 只看会做什么
#
# 自动选择引擎：
#   · 系统里 nginx 在跑（占用 80/443）→ 给 nginx 加站点 + certbot 签证书
#   · 没有 nginx                     → 装 Caddy，自动 HTTPS
#
# 两种方式都会把商城切成 HTTPS 模式（PUBLIC_BASE_URL / COOKIE_SECURE）并重启。
set -Eeuo pipefail

DOMAIN=${1:-}
SKIP_DNS=0
DRY=0
FORCE=auto
for a in "$@"; do
  case $a in
    --skip-dns-check) SKIP_DNS=1;;
    --dry-run) DRY=1;;
    --use-nginx) FORCE=nginx;;
    --use-caddy) FORCE=caddy;;
  esac
done

die(){ printf '\nERROR: %s\n' "$*" >&2; exit 1; }
say(){ printf '%s\n' "$*"; }
step(){ printf '\n== %s ==\n' "$*"; }
have(){ command -v "$1" >/dev/null 2>&1; }

[[ -n $DOMAIN ]] || die "用法: bash setup-https.sh 你的域名（例如 shop.example.com）[--dry-run]"
[[ $DOMAIN =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$ ]] || die "域名格式不对：$DOMAIN"
((DRY)) || [[ $EUID -eq 0 ]] || die "需要 root 权限。你是 root 就直接跑。"

step "1/5 检查域名与端口"
SERVER_IP=$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
say "服务器公网 IP: ${SERVER_IP:-未知}"
say "域名解析到  : ${DNS_IP:-未解析}"
if ((SKIP_DNS==0)); then
  [[ -n $DNS_IP ]] || die "域名还没解析。先加 A 记录：$DOMAIN → ${SERVER_IP:-服务器IP}，等 1~10 分钟。"
  if [[ -n $SERVER_IP && $DNS_IP != "$SERVER_IP" ]]; then
    say "警告：域名指向 $DNS_IP，不是本机 $SERVER_IP（Cloudflare 橙色云会让证书失败，请改灰色云）。"
    if ((DRY)); then
      say "（dry-run，不询问）"
    else
      read -r -p "仍然继续？[y/N] " ans
      [[ ${ans:-} == [yY] ]] || die "已取消。"
    fi
  fi
fi

owner(){ local n; n=$(ss -H -ltnp "sport = :$1" 2>/dev/null | grep -o 'users:((\"[^\"]*\"' | sed 's/.*"\([^"]*\)"/\1/' | head -1); [[ -n $n ]] && printf '%s' "$n"; }
NGINX_ACTIVE=0
if systemctl is-active --quiet nginx 2>/dev/null || pgrep -x nginx >/dev/null 2>&1; then NGINX_ACTIVE=1; fi
O80=$(owner 80 || true); O443=$(owner 443 || true)
say "80 端口占用 : ${O80:-无}"
say "443 端口占用: ${O443:-无}"
say "nginx       : $([[ $NGINX_ACTIVE == 1 ]] && echo 运行中 || echo 未运行)"

ENGINE=$FORCE
[[ $ENGINE == auto ]] && { if [[ $NGINX_ACTIVE == 1 ]]; then ENGINE=nginx; else ENGINE=caddy; fi; }
say "使用引擎    : $ENGINE"

if ((DRY)); then
  step "预览（dry-run，不做任何改动）"
  if [[ $ENGINE == nginx ]]; then
    say "# 写入 /etc/nginx/conf.d/meridian-$DOMAIN.conf：80 端口反代到 127.0.0.1:3000"
    say "# 然后 certbot --nginx -d $DOMAIN --redirect 自动签证书并跳转 443"
  else
    say "# 写入 /etc/caddy/Caddyfile：$DOMAIN { reverse_proxy 127.0.0.1:3000 }"
  fi
  say ""
  say "dry-run 结束。去掉 --dry-run 即会真的执行。"
  exit 0
fi

BASE=""
for d in "${MERIDIAN_DIR:-}" "$HOME/.local/share/meridian" /root/.local/share/meridian; do
  [[ -n $d && -f $d/shared/config.env ]] && BASE=$d && break
done

switch_meridian(){
  if [[ -z $BASE ]]; then say "没找到商城配置，跳过 HTTPS 切换（记得手动设 PUBLIC_BASE_URL）"; return 0; fi
  local cfg=$BASE/shared/config.env
  cp "$cfg" "$cfg.bak.$(date +%s)"
  if grep -qE '^PUBLIC_BASE_URL=' "$cfg"; then sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://$DOMAIN|" "$cfg"
  else printf 'PUBLIC_BASE_URL=https://%s\n' "$DOMAIN" >> "$cfg"; fi
  if grep -qE '^COOKIE_SECURE=' "$cfg"; then sed -i "s|^COOKIE_SECURE=.*|COOKIE_SECURE=true|" "$cfg"
  else printf 'COOKIE_SECURE=true\n' >> "$cfg"; fi
  say "已设置 PUBLIC_BASE_URL=https://$DOMAIN、COOKIE_SECURE=true"
  [[ -x $BASE/bin/meridian ]] && $BASE/bin/meridian restart && say "商城已重启（HTTPS 模式）"
  return 0
}

verify(){
  local code
  printf 'https://%s/healthz  →  ' "$DOMAIN"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "https://$DOMAIN/healthz" 2>/dev/null || true)
  printf '%s\n' "${code:-000}"
  [[ ${code:-000} == 200 ]]
}

if [[ $ENGINE == nginx ]]; then
  step "2/5 安装 certbot"
  if have certbot; then say "certbot 已存在"
  elif have apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
    say "已安装 certbot + python3-certbot-nginx"
  else
    die "没有 apt，请手动装 certbot，或加 --use-caddy 用 Caddy"
  fi

  if systemctl list-unit-files 2>/dev/null | grep -q '^caddy.service'; then
    systemctl disable --now caddy >/dev/null 2>&1 || true
    say "已停用之前装的 caddy（避免和 nginx 抢 80/443）"
  fi

  step "3/5 写 nginx 站点"
  CONF=/etc/nginx/conf.d/meridian-$DOMAIN.conf
  mkdir -p /etc/nginx/conf.d
  cat > "$CONF" <<NGINX
# MERIDIAN 商城 —— 由 setup-https.sh 生成
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }
}
NGINX
  if nginx -t >/tmp/nginx-test.log 2>&1; then
    systemctl reload nginx 2>/dev/null || nginx -s reload
    say "nginx 已重新加载"
  else
    rm -f "$CONF"
    tail -6 /tmp/nginx-test.log || true
    die "nginx 配置校验失败，已回滚。检查 /etc/nginx/nginx.conf 是否 include conf.d"
  fi

  step "4/5 申请证书"
  MAIL="admin@${DOMAIN#*.}"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect -m "$MAIL" 2>&1 | tail -8 || \
    say "certbot 自动模式失败。手动重试：certbot --nginx -d $DOMAIN --redirect"

  step "5/5 切换商城到 HTTPS 模式"
  switch_meridian
else
  step "2/5 安装 Caddy"
  if have caddy; then
    say "已安装：$(caddy version 2>/dev/null | head -1)"
  elif have apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
    say "已通过 apt 安装 Caddy"
  else
    case $(uname -m) in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) die "不支持的架构";; esac
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$ARCH" -o /usr/local/bin/caddy
    chmod +x /usr/local/bin/caddy
    useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy 2>/dev/null || true
    mkdir -p /etc/caddy /var/lib/caddy /var/log/caddy
    chown -R caddy:caddy /var/lib/caddy /etc/caddy /var/log/caddy
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
    say "已安装官方静态二进制"
  fi

  step "3/5 写 Caddyfile"
  mkdir -p /etc/caddy /var/log/caddy
  [[ -f /etc/caddy/Caddyfile ]] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  cat > /etc/caddy/Caddyfile <<CADDY
{
	email admin@${DOMAIN#*.}
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
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || die "Caddyfile 校验失败"
  say "Caddyfile 已写入并校验通过"

  step "4/5 防火墙与启动"
  if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; say "ufw 已放行 80/443"
  elif have firewall-cmd && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-service=http >/dev/null
    firewall-cmd --permanent --add-service=https >/dev/null
    firewall-cmd --reload >/dev/null; say "firewalld 已放行"
  else
    say "没有活动的 ufw/firewalld（云安全组请自行放行 80/443）"
  fi
  systemctl enable caddy >/dev/null 2>&1 || true
  systemctl restart caddy || { journalctl -u caddy -n 30 --no-pager || true; die "Caddy 启动失败（80/443 可能被 nginx 占用，加 --use-nginx 重跑）"; }

  step "5/5 切换商城到 HTTPS 模式"
  switch_meridian
fi

step "验证"
if verify; then
  cat <<DONE

✅ 完成（引擎：$ENGINE）
   前台   https://$DOMAIN
   后台   https://$DOMAIN/admin
   证书自动续期，无需手动管理。
DONE
else
  cat <<FAIL

❌ HTTPS 还不通。按顺序排查：

  1. 引擎日志：$([[ $ENGINE == nginx ]] && echo 'journalctl -u nginx -n 40 --no-pager' || echo 'journalctl -u caddy -n 40 --no-pager')
  2. 云安全组是否放行 80/443（控制台里加，脚本改不了）
  3. Cloudflare 橙色云是否改成灰色（仅 DNS）
  4. nginx 模式看证书：certbot certificates
  5. 修好后重跑同一条命令即可（幂等）
FAIL
  exit 1
fi

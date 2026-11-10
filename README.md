# MERIDIAN — watches & essentials

面向欧美客户的手表与配件独立站。前台英文默认，支持 Deutsch / Español；后台中文，可分别编辑三种语言内容。Node.js 24+，**零第三方运行依赖**，SQLite 单文件存储。

---

## 1. 功能一览

**前台**：响应式首页、分类、搜索、价格排序、商品详情、购物袋、EN/DE/ES 切换、USD 计价、商品图集 + 全屏放大（滚轮缩放 / 左右切换 / ESC）、WhatsApp 悬浮客服、页脚支付图标。

**后台 `/admin`**：页面设计（品牌、主视觉、公告、服务文案、页脚、三语言）、商品增删改 / 库存 / 多语言 / 多图上传、分类管理、订单记录、支付设置、用户管理（普通 / VIP）、通知邮件测试。

**会员与可见性**：商品和分类都带观看等级（公开 / 登录会员 / VIP），未获授权的商品**不进列表、不进 sitemap**，只能通过后台复制的 `/?product=<id>` 或 `/?category=<id>` 链接直达；直链按等级放行，未授权返回 403 且不泄露名称 / 图片 / 价格、页面 noindex。加购与下单服务端二次校验。

**支付**：PayPal 官方收银台 + USDT 钱包直收人工核账。默认规则：普通订单只能 PayPal，含 VIP 商品的订单只能 USDT（`PAYMENT_RULES=off` 可关闭）。

**其他**：下单确认邮件、未支付订单超时返库、草稿 / 预览 / 发布、SEO（canonical / Open Graph / JSON-LD / robots / sitemap）、CSP / HSTS 等安全响应头、登录限速、scrypt 密码哈希。

---

## 2. 快速开始

### 方式 A：Docker（推荐，最快）

```bash
git clone -b feature/hardening-seo https://github.com/yidaili85/MERIDIAN.git meridian-store
cd meridian-store
bash scripts/quickstart-docker.sh
```

脚本会：生成 `.env`（含随机管理员密码）→ 构建镜像 → 后台启动 → 等 `/healthz` 通过 → 打印地址。

- 前台 http://127.0.0.1:3000/
- 后台 http://127.0.0.1:3000/admin
- 密码 `grep ADMIN_PASSWORD .env`

手动等价命令：

```bash
cp .env.example .env          # 填 ADMIN_PASSWORD
docker compose up -d --build
docker compose logs -f meridian
docker compose down           # 停止；数据在 meridian-data 卷里，不会丢
```

数据卷位置：`docker volume inspect meridian-store_meridian-data`。备份 = 导出该卷（或 `docker compose exec meridian` 里打包 `/data`）。

### 方式 B：源码直跑（不用 Docker）

需要 Node.js **24+**（`node -v` 确认，需带 `node:sqlite`），**无需 `npm install`**。

```bash
git clone -b feature/hardening-seo https://github.com/yidaili85/MERIDIAN.git meridian-store
cd meridian-store
bash scripts/quickstart-local.sh
```

脚本生成 `.env` 后以 `node --env-file=.env server.js` 前台启动，`Ctrl-C` 停止。数据默认在 `./data`（SQLite + `uploads/`）。

### 方式 C：Linux 服务器一键安装（长期运行）

支持 Linux x86_64 / arm64，推荐 Debian 12+ / Ubuntu 22.04+（glibc）。用普通部署用户运行，脚本不会以 root 启动网站，也不改系统 Node。

```bash
git clone -b feature/hardening-seo git@github.com:yidaili85/MERIDIAN.git meridian-store
bash meridian-store/install.sh
```

脚本会：

1. 用现有 Node 24+，或安装独立 Node 24（核对官方 SHA256）。
2. 复制程序到独立版本目录并跑测试；不复制源码里的 `.env` 或 `data/`。
3. 首次生成管理员密码写入 `shared/config.env`（600 权限，不打印，保留不覆盖）。
4. 后台启动并检查真实 HTTP 接口；失败保留数据并回滚到上一版本代码。

```bash
~/.local/share/meridian/bin/meridian {status|restart|stop|logs}
bash install.sh --dir /home/deploy/meridian   # 自定义位置
bash install.sh --no-start                    # 只装不启动
git -C meridian-store pull --ff-only && bash meridian-store/install.sh   # 升级
```

默认目录 `~/.local/share/meridian`：`current`（当前版本软链）、`releases/`、`shared/data/`（数据库）、`shared/config.env`（配置）、`shared/server.log`（日志）。配置由 `--env-file` 读取，**不要 `source`**。改配置后 `meridian restart`。

开机自启（`crontab -e`，路径换真实绝对路径）：

```cron
@reboot /home/deploy/.local/share/meridian/bin/meridian start
```

私有仓库不适用匿名 `curl raw.githubusercontent.com/... | bash`；不要把访问令牌写进安装命令或发到聊天。

---

## 3. 首次登录与上手顺序

1. 打开 `/admin`，输入 `ADMIN_PASSWORD`（`.env` 或 `shared/config.env`）。会话 8 小时过期；未设置密码时每次启动生成临时密码，只打印在启动日志。
2. 后台 → 页面设计：品牌名、主视觉、公告、服务文案、WhatsApp 号码（带国家区号，启用后生效）、页脚内容。
3. 后台 → 商品分类：建分类；需要锁定的选「观看等级」，可复制**分类链接**。
4. 后台 → 商品管理：加商品、传图（PNG/JPEG/WebP ≤5MB）、价格库存、观看等级；编辑页可复制**商品链接**。
5. 保存**草稿** → 授权预览 → **发布**。前台只显示已发布内容。

---

## 4. 配置项

| 变量 | 默认 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | 随机临时密码（仅打印在启动日志） | 后台密码，**务必固定** |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | 容器内用 `0.0.0.0:3000` |
| `DATA_DIR` | `./data` | SQLite 与上传图片；容器内 `/data` |
| `COOKIE_SECURE` | `false` | HTTPS 部署置 `true` |
| `PUBLIC_BASE_URL` | 空 | 正式 HTTPS 根域名；启用 canonical / sitemap / 支付回跳 |
| `PAYMENT_RULES` | `on` | `off` 关闭「VIP=USDT、其他=PayPal」规则 |
| `ORDER_TTL_MINUTES` | `30` | 未支付订单过期返库分钟数，`0` 关闭 |
| `SWEEP_INTERVAL_MS` | `300000` | 过期扫描间隔 |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_WEBHOOK_ID` | 空 | 三项齐全才启用 PayPal |
| `MAIL_PROVIDER` / `MAIL_API_KEY` / `MAIL_FROM` / `MAIL_FROM_NAME` / `MAIL_API_URL` | resend / 空 | 下单邮件（可选） |
| `ORDER_NOTIFY_EMAIL` | 空 | 店主抄送，逗号分隔 |
| `WHATSAPP_NUMBER` | 空 | 邮件里显示的客服号 |

模板见 `.env.example`。密钥只放环境变量或 `.env`，不要进 Git。

---

## 5. 会员、等级与链接

- 前台可注册 / 登录（邮箱 + 密码，scrypt 加盐，30 天会话）；新用户默认**普通用户**。
- 后台 → 用户管理：搜索用户，下拉改 **普通用户 / VIP 用户**，立即生效。
- 商品观看等级：`all` 公开 / `normal` 登录会员 / `vip` VIP 专属。
- 分类观看等级同理；**商品有效等级 = 商品与所属分类中更严格的一档**——把整类商品放进 VIP 分类即可整类锁定。
- 无权用户：列表、导航、筛选、接口、sitemap 全部不下发该商品 / 分类。
- 授权访问靠链接直达：商品 `/?product=<id>`、类目 `/?category=<id>`，后台编辑页一键复制。

自测流程：注册一个账号 → 后台把它设为 VIP → 用该账号打开 VIP 商品或类目链接 → 对比未登录时的效果。

---

## 6. PayPal 对接

1. PayPal Developer 创建 REST App（Sandbox 或 Live），注入 `PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET`；不要写入前端、Git 或聊天。
2. 设置 `PUBLIC_BASE_URL=https://你的域名`（HTTPS 根域名，不带路径），配好反代，`COOKIE_SECURE=true`。
3. 该 App 注册 Webhook `https://你的域名/api/payments/paypal/webhook`，订阅 `PAYMENT.CAPTURE.COMPLETED`，把 Webhook ID 填进 `PAYPAL_WEBHOOK_ID`。
4. 后台 → 支付设置：选 Sandbox，启用 PayPal。前台只有配置齐全才显示该方式；「已注入」只代表变量存在，不代表商户鉴权通过。
5. 用沙箱买家走完整流程；上线时整体替换为 Live 凭证、Webhook ID 与后台环境选项。不要在有未完成支付时更换凭证。

服务端按已保存金额创建 PayPal Order，浏览器跳官方收银台；回跳或签名验证通过的回调到达后，服务端查询 / 捕获并核对商户订单引用、实际扣款金额与 USD 币种，只有真实扣款才标记 Paid，重复回跳与回调幂等。创建与捕获使用固定幂等键。官方文档：[Orders v2](https://developer.paypal.com/docs/api/orders/v2/)、[Webhook 验签](https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post)。

当前使用 `NO_SHIPPING`，收货资料保存在本地订单；未接入 PayPal 地址映射与卖家保障资格处理。

---

## 7. USDT 直收与人工核账

后台 → 支付设置：选 **TRC20** 或 **ERC20**，填公开收款地址与 `1 USD = ? USDT` 比例后启用。不需要私钥，也不查询链上到账。TRC20 校验 Base58Check、ERC20 校验基本格式，均不证明地址归属。

每笔支付快照当时的网络、地址、六位小数应付金额与比例，之后改配置不影响已创建的支付单。报价是商家设定的固定比例，非市场实时汇率。状态：

- `pending`：等待转账
- `awaiting_review`：买家已提交哈希，尚未确认（可更正）
- `paid`：管理员核实后确认，记录时间与哈希

管理员必须在区块浏览器核对真实 USDT 合约、地址、金额、成功状态与确认数。**提交哈希不等于到账**；同一网络同一哈希只能确认一个订单。合并小额、超付、退款、错链错币需商家自行处理。私钥与助记词不应进入网站。

订单访问令牌只存在创建订单标签页的 `sessionStorage`，不出现在回跳 URL。关掉标签页后暂无邮件恢复链接。

---

## 8. 部署与安全

- 服务只监听 `127.0.0.1`，公网请用 Nginx / Caddy 反代到 `127.0.0.1:3000` 并配 HTTPS；`HOST=0.0.0.0` 只在容器内使用。
- 后台建议再加一层：Basic Auth + IP 白名单，或只走 VPN。
- 备份：停止服务后打包 `DATA_DIR`（SQLite + `uploads/`），或用 SQLite 在线备份。
- 已有措施：CSP、HSTS（HTTPS 时）、`X-Frame-Options`、`Permissions-Policy`、同源 CSRF 校验（兼容反代）、登录限速、scrypt 哈希、订单访问令牌。

---

## 9. 测试

```bash
npm test                                      # 26 条集成测试
docker compose run --rm meridian npm test     # 容器内跑
curl -s http://127.0.0.1:3000/healthz         # 健康检查
```

覆盖：服务端核价与库存事务、授权与草稿隔离、发布、图片上传、邮件、PayPal 模拟接口（金额 / 幂等 / 验签失败）、USDT 快照与人工确认、会员等级、分类等级、支付方式规则、静态与 SEO 输出。全部使用临时数据库与虚拟交易，不接触真实资金。

---

## 10. 目录结构

```
server.js               HTTP 服务、路由、内容模型、SEO、静态资源
payments.js             PayPal / USDT 实现
mailer.js               下单邮件（resend / postmark / sendgrid / generic）
public/                 前台 app.js + theme-tandorio.css；后台 admin.js + style.css
test/                   node:test 集成测试
scripts/meridian.sh     服务器安装后的进程管理
scripts/quickstart-docker.sh   Docker 一键启动
scripts/quickstart-local.sh    源码直跑一键启动
install.sh              Linux 一键安装（版本目录 + 回滚）
Dockerfile / docker-compose.yml / .dockerignore
.env.example            配置模板
```

---

## 11. 已知边界

- 可运行 MVP；默认运费（$12 / 满 $150 免运费）与示例商品是演示数据，需替换。
- 金额不含目的地税费与关税，正式收款前需完善 VAT / 销售税与配送策略。
- 尚未实现：优惠券、多币种结算、PayPal 退款 / 争议同步、自动查链上到账、邮件恢复订单链接、购物车跨会话持久化、邀请码注册。
- 未配置支付时订单仍可创建，但前台不显示对应方式；`/healthz` 只代表进程存活，不代表支付就绪。

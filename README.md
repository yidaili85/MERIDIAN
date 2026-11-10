# MERIDIAN — watches & essentials

面向欧美客户的手表与配件独立站。前台英文默认，支持 Deutsch / Español；后台中文，可分别编辑三种语言内容。Node.js 24+，**零第三方运行依赖**，SQLite 单文件存储。

---

## 1. 安装（三选一，都是三条命令）

仓库默认分支就是最新代码，**直接 clone，不用指定分支**。

### ① Docker（最快，推荐）

```bash
git clone https://github.com/yidaili85/MERIDIAN.git meridian-store
cd meridian-store
bash scripts/quickstart-docker.sh
```

脚本自动：生成 `.env`（随机管理员密码）→ 构建镜像 → 后台启动 → 等健康检查通过 → 打印地址。

- 前台 http://127.0.0.1:3000/
- 后台 http://127.0.0.1:3000/admin
- 密码 `grep ADMIN_PASSWORD .env`

没装 Docker：`curl -fsSL https://get.docker.com | sh`

停止 / 查看：`docker compose down`（数据在卷里不会丢）、`docker compose logs -f meridian`。

### ② Node 直跑（不用 Docker）

需要 Node.js **24+**，不需要 `npm install`。

```bash
git clone https://github.com/yidaili85/MERIDIAN.git meridian-store
cd meridian-store
bash scripts/quickstart-local.sh
```

前台运行，`Ctrl-C` 停止，数据在 `./data`。密码同上 `grep ADMIN_PASSWORD .env`。

没有 Node 时：

```bash
# Debian / Ubuntu
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs
# macOS
brew install node
```

### ③ 服务器长期运行（版本目录 + 进程守护）

```bash
git clone https://github.com/yidaili85/MERIDIAN.git meridian-store
cd meridian-store
bash install.sh
```

装完：

- 密码 `grep ADMIN_PASSWORD ~/.local/share/meridian/shared/config.env`
- 管理 `~/.local/share/meridian/bin/meridian {status|restart|stop|logs}`
- 升级 `cd meridian-store && git pull && bash install.sh`（保留商品、订单、密码）
- 自定义目录 `bash install.sh --dir /home/deploy/meridian`

脚本会自动准备 Node 24（核对官方 SHA256）、跑测试、生成配置、启动并验证 HTTP；启动失败保留数据并回滚代码。

**用 root 登录的机器**：默认拒绝执行。测试机可 `MERIDIAN_ALLOW_ROOT=1 bash install.sh`；正式环境建议建部署用户：

```bash
adduser --disabled-password --gecos "" meridian
su - meridian -c 'git clone https://github.com/yidaili85/MERIDIAN.git ~/meridian-store && bash ~/meridian-store/install.sh'
```

### 看不到页面？（在远程服务器上）

服务只监听 `127.0.0.1`。本机开一条隧道即可：

```bash
ssh -L 3000:127.0.0.1:3000 root@你的服务器IP
```

然后浏览器打开 http://127.0.0.1:3000/ 。正式对外用 Nginx / Caddy 反代 + HTTPS，并在配置里设 `PUBLIC_BASE_URL=https://你的域名`、`COOKIE_SECURE=true`。

---

## 2. 首次登录与上手顺序

1. 打开 `/admin`，输入 `ADMIN_PASSWORD`。会话 8 小时过期；没设密码时每次启动生成临时密码，只打印在启动日志。
2. 后台 → 页面设计：品牌名、主视觉、公告、服务文案、WhatsApp 号码（带国家区号，启用后生效）、页脚。
3. 后台 → 商品分类：建分类；要锁定的选「观看等级」，可复制**分类链接**。
4. 后台 → 商品管理：加商品、传图（PNG/JPEG/WebP ≤5MB）、价格库存、观看等级；编辑页可复制**商品链接**。
5. 保存**草稿** → 授权预览 → **发布**。前台只显示已发布内容。

---

## 3. 数据看板（后台首页）

登录后台默认落在「数据看板」：流量、加购、订单、单品浏览量的自建统计，不依赖 Google Analytics 等第三方。

**顶部 KPI**：今日访客（UV）/ 浏览量（PV）/ 加购次数 / 今日订单（含转化率）/ 付款人数 / 销售额，每项带「较昨日」涨跌。

**访客趋势**：PV 实线 + UV 虚线，可切 7/14/30 天或「今日分时」；下方给出区间合计。

**单量趋势**：按天柱状图（订单数，悬停显示当日销售额）。

**客户来源**：直接访问 / 搜索引擎 / 社交媒体 / 邮件 / 外部链接，按访问占比排序。

**单品浏览量**：近 N 天每件商品的浏览、加购、订单、销售额。

数据来自服务端访问记录（`events` 表）与订单库：首页每次 GET 记一次 PV，首次访问下发一个匿名 `mid` cookie 用于 UV 去重（HttpOnly、SameSite=Lax，不含任何个人信息）；商品详情与加购由前台埋点上报。想清零就从 `store.sqlite` 里 `DELETE FROM events`。

---

## 4. 功能

**前台**：响应式首页、分类、搜索、价格排序、详情、购物袋、**立即购买（单件直达结账）**、**游客结账（无需注册）**、EN/DE/ES、USD 计价、商品图集 + 全屏放大（滚轮缩放 / 左右切换 / ESC）、WhatsApp 悬浮客服、页脚支付图标。

**后台**：数据看板、**政策页编辑**、**站点地图**（预览 / 复制 / 下载，只收录游客可见商品）、页面设计（含 **favicon 上传**）与三语言内容、**商品管理表格（每页 10 件分页、批量上架/下架/删除、行内展开编辑、每行直接切换显示状态与观看权限）**、售价与原价（折扣价）双价格、库存、多图上传、分类管理、订单记录、支付设置、用户管理（普通 / VIP）、通知邮件测试。

**会员与可见性**：商品和分类都带观看等级（公开 / 登录会员 / VIP），未获授权的商品**不进列表、不进 sitemap**，只能通过后台复制的 `/?product=<id>` 或 `/?category=<id>` 直达；直链按等级放行，未授权返回 403 且不泄露名称 / 图片 / 价格、页面 noindex。加购与下单服务端二次校验。

**支付**：PayPal 官方收银台 + USDT 直收人工核账。默认规则：普通订单只能 PayPal，含 VIP 商品的订单只能 USDT（`PAYMENT_RULES=off` 关闭）。

**统计**：后台自建数据看板，PV/UV、加购、订单、来源、单品浏览量，不接第三方统计。

**其他**：下单确认邮件、未支付订单超时返库、草稿 / 预览 / 发布、SEO（canonical / Open Graph / JSON-LD / robots / sitemap）、CSP / HSTS 等安全头、登录限速、scrypt 密码哈希、`/healthz` 探活。

---

## 5. 价格与折扣

每件商品有两个价格：

- **售价（price）**：客户实际支付的价格。前台显示它，订单按它计价。
- **原价（compareAt）**：划线价，只用于展示优惠力度。留空表示不打折。

后台商品行内编辑器里填写；原价必须高于售价，否则保存会被拒绝。前台自动渲染成「原价划线 + 售价 + -XX% 徽标」，折扣百分比按数据算，不用手填。

## 6. 站点图标与 sitemap

**favicon**：后台「页面设计 → 品牌与首页」底部有「站点图标」一栏，可上传 PNG/JPG/WebP（建议 512×512）或在 URL 框里填 SVG 地址；留空即使用内置的 `assets/favicon.svg`。保存并发布后，页面 `<head>` 里会输出 `rel="icon"` 与 `rel="apple-touch-icon"`。

**sitemap**：访问 `https://你的域名/sitemap.xml` 即可，内容是动态生成的，不需要手动重建。后台「站点地图」页可以查看收录数量、复制地址、下载文件、预览 XML。

收录规则：只写入**游客可见**的内容——首页 + `access=all` 且已上架的商品；`会员` / `VIP` 商品，以及带等级限制的分类下的商品，一律不写入，避免搜索引擎把受限商品曝光给普通访客。受限商品本身也已输出 `noindex`。

## 7. 政策页、结账与订单查询

**政策页**：后台「政策页面」里默认有四页（`/privacy`、`/terms`、`/shipping`、`/returns`），标题和正文可改、可加、可删，发布后自动挂到前台页脚并写进 sitemap。正文用空行分段，方括号里的内容（公司名、邮箱）记得换成自己的。这些页面是服务端渲染的独立 URL，SEO 和分享链接都正常。

**结账表单**：国家是 59 个国家的下拉（不是自由输入），选美国/加拿大/澳大利亚会自动切换州省下拉，邮编按国家规则校验（美国 5 位或 ZIP+4、加拿大 A1A 1A1、德国 5 位等），错误会当场提示。另有地址第二行（公寓/单元）。

**订单查询**：页脚「Track order」输入下单邮箱 + 订单号即可查询状态、商品、金额与运单号；后台订单记录里的订单号就是客户要填的那串 `MY…`。接口对错误邮箱只返回 404，不泄露订单是否存在，并限流 30 次/10 分钟。

**Cookie 条**：只说明一个匿名统计 cookie，无广告追踪，接受后写本地 `meridian-cookie`，不再重复弹出。

**商品规格**：后台商品行内编辑器里有「规格」六个字段（表径、机芯、防水、表带宽度、表镜、重量），留空不显示；前台详情页自动渲染成规格表。

**支付图标**：页脚展示 Visa / Mastercard / AMEX / PayPal / Apple Pay 五个内联 SVG（不依赖外部图片，不会 404）。

## 8. 配置项

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
| `MAIL_PROVIDER` / `MAIL_API_KEY` / `MAIL_FROM` / `MAIL_FROM_NAME` / `MAIL_API_URL` | resend / 空 | 下单邮件（可选），也可在后台填写 |
| `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT` / `MAIL_SMTP_SECURE` / `MAIL_SMTP_USER` / `MAIL_SMTP_PASS` | 空 / 587 / false | 用自有邮箱 SMTP 发信时的参数 |
| `ORDER_NOTIFY_EMAIL` | 空 | 店主抄送，逗号分隔 |
| `WHATSAPP_NUMBER` | 空 | 邮件里显示的客服号 |

模板见 `.env.example`。密钥只放环境变量或 `.env`，不要进 Git、不要发聊天。

---

## 9. 会员、等级与链接

- 结账不强制注册：公开商品游客可下单（立即购买或购物袋都行）；只有 VIP 商品要求登录且等级达标。
- 前台可注册 / 登录（邮箱 + 密码，scrypt 加盐，30 天会话）；新用户默认**普通用户**。
- 后台 → 用户管理：搜索用户，下拉改 **普通用户 / VIP 用户**，立即生效。
- 商品观看等级：`all` 公开 / `normal` 登录会员 / `vip` VIP 专属。
- 分类观看等级同理；**商品有效等级 = 商品与所属分类中更严格的一档**——把整类商品放进 VIP 分类即可整类锁定。
- 无权用户：列表、导航、筛选、接口、sitemap 全部不下发该商品 / 分类。
- 授权访问靠链接直达：商品 `/?product=<id>`、类目 `/?category=<id>`，后台编辑页一键复制。

自测：注册账号 → 后台设为 VIP → 用该账号打开 VIP 商品或类目链接 → 对比未登录效果。

---

## 10. PayPal 对接

1. PayPal Developer 创建 REST App（Sandbox 或 Live），注入 `PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET`。
2. 设置 `PUBLIC_BASE_URL=https://你的域名`（HTTPS 根域名，不带路径），配好反代，`COOKIE_SECURE=true`。
3. 该 App 注册 Webhook `https://你的域名/api/payments/paypal/webhook`，订阅 `PAYMENT.CAPTURE.COMPLETED`，把 Webhook ID 填进 `PAYPAL_WEBHOOK_ID`。
4. 后台 → 支付设置：选 Sandbox，启用 PayPal。配置不齐前台不显示该方式；「已注入」只代表变量存在，不代表商户鉴权通过。
5. 用沙箱买家走完整流程；上线时整体替换 Live 凭证与后台环境选项，不要在有未完成支付时更换凭证。

服务端按已保存金额创建 PayPal Order，浏览器跳官方收银台；回跳或签名验证通过的回调到达后，服务端查询 / 捕获并核对商户订单引用、金额与 USD 币种，真实扣款才标记 Paid，重复回跳幂等。官方文档：[Orders v2](https://developer.paypal.com/docs/api/orders/v2/)、[Webhook 验签](https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post)。

当前使用 `NO_SHIPPING`，收货资料保存在本地订单；未接入 PayPal 地址映射与卖家保障资格处理。

---

## 11. USDT 直收与人工核账

后台 → 支付设置：选 **TRC20** 或 **ERC20**，填公开收款地址与 `1 USD = ? USDT` 比例后启用。不需要私钥，也不查询链上到账。

每笔支付快照当时的网络、地址、六位小数应付金额与比例，之后改配置不影响已创建支付单。报价是商家设定的固定比例，非市场实时汇率。状态：

- `pending`：等待转账
- `awaiting_review`：买家已提交哈希，尚未确认（可更正）
- `paid`：管理员核实后确认，记录时间与哈希

管理员必须在区块浏览器核对真实 USDT 合约、地址、金额、成功状态与确认数。**提交哈希不等于到账**；同一网络同一哈希只能确认一个订单。合并小额、超付、退款、错链错币需商家自行处理。私钥与助记词不应进入网站。

订单访问令牌只存在创建订单标签页的 `sessionStorage`，不出现在回跳 URL；关掉标签页后暂无邮件恢复链接。

---

## 12. 通知邮件（后台可直接改）

后台 → 通知邮件，两种方式任选，保存即生效，不需要发布、不需要改文件：

**① SMTP（自有邮箱，最省事）**：适合已有域名邮箱（企业邮、CraneMail/NameCrane、Zoho、QQ 企业邮等）。

| 字段 | 说明 |
|---|---|
| 发送方式 | 选 `SMTP（自有邮箱）` |
| 服务器地址 | 服务商给的 host，如 `mail.你的域名.com` |
| 端口 | `465`（勾选 SSL/TLS）或 `587`（不勾，自动 STARTTLS） |
| 账号 / 密码 | 邮箱地址 + 密码；开了两步验证的要填**应用专用密码** |
| 发件地址 | 必须是这个邮箱本身，否则会被拒 |

**② HTTP 邮件服务**：Resend / Postmark / SendGrid，或自建兼容端点（`generic` + 接口地址）。适合没有邮箱、想要投递率和退信统计的场景。

配好点「发送测试邮件」，收到就说明通道通了。之后每笔订单自动发确认邮件（含明细、合计、收货信息、付款按钮），并抄送店主收件地址；发信失败不影响下单，状态记在订单 `details.mail`。

**关于收信**：系统只负责发信。客户回信会进你的邮箱（手机/网页都能看），商城不需要收信能力。若以后要做「站内客服/回信归档」，那需要另加 IMAP 拉取，属于新功能。

---

## 13. 部署与安全

- 服务只监听 `127.0.0.1`，公网用 Nginx / Caddy 反代到 `127.0.0.1:3000` 并配 HTTPS；`HOST=0.0.0.0` 只在容器内使用。
- 后台建议再加一层：Basic Auth + IP 白名单，或只走 VPN。
- 备份：停止服务后打包 `DATA_DIR`（SQLite + `uploads/`），或用 SQLite 在线备份。
- 已有措施：CSP、HSTS（HTTPS 时）、`X-Frame-Options`、`Permissions-Policy`、同源 CSRF 校验（兼容反代）、登录限速、scrypt 哈希、订单访问令牌。

---

## 14. 测试

```bash
npm test                                      # 26 条集成测试
docker compose run --rm meridian npm test     # 容器内跑
curl -s http://127.0.0.1:3000/healthz         # 健康检查
```

覆盖：服务端核价与库存事务、授权与草稿隔离、发布、图片上传、邮件、PayPal 模拟接口（金额 / 幂等 / 验签失败）、USDT 快照与人工确认、会员等级、分类等级、支付方式规则、静态与 SEO 输出。全部使用临时数据库与虚拟交易。

---

## 15. 目录结构

```
server.js               HTTP 服务、路由、内容模型、SEO、静态资源
payments.js             PayPal / USDT 实现
mailer.js               下单邮件（SMTP / resend / postmark / sendgrid / generic）
smtp.js                 零依赖 SMTP 客户端（STARTTLS、AUTH LOGIN）
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

## 16. 已知边界

- 可运行 MVP；默认运费（$12 / 满 $150 免运费）与示例商品是演示数据，需替换。
- 金额不含目的地税费与关税，正式收款前需完善 VAT / 销售税与配送策略。
- 尚未实现：优惠券、多币种结算、PayPal 退款 / 争议同步、自动查链上到账、邮件恢复订单链接、购物车跨会话持久化、邀请码注册。
- 未配置支付时订单仍可创建，但前台不显示对应方式；`/healthz` 只代表进程存活，不代表支付就绪。

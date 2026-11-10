# MERIDIAN — watches & essentials

面向欧美客户的手表与配件商城首版。英文默认，支持 Deutsch / Español；商家后台使用中文，支持分别编辑三种语言的内容。

## 一键安装到 Linux 服务器

支持 **Linux x86_64 / arm64**，推荐 Debian 12+ 或 Ubuntu 22.04+（glibc）。请用普通部署用户运行，脚本不会以 root 启动网站，也不会修改系统 Node.js。

当前 GitHub 仓库为私有仓库。先确保服务器上的 Git/SSH 账号有该仓库的读取权限，然后执行：

```bash
git clone git@github.com:yidaili85/yidaili85.git meridian-store && bash meridian-store/install.sh
```

如果使用已经登录的 HTTPS Git 凭证，也可以执行：

```bash
git clone https://github.com/yidaili85/yidaili85.git meridian-store && bash meridian-store/install.sh
```

私有仓库不适用匿名 `curl raw.githubusercontent.com/... | bash`。不要把访问令牌写进安装命令或发送到聊天。

基础命令缺失时，在 Debian/Ubuntu 安装：

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git tar xz-utils coreutils
```

脚本会：

1. 使用现有 Node.js 24+，或从 Node.js 官方站点安装独立 Node 24，并核对官方 SHA256 校验值。
2. 复制网站程序到独立版本目录，运行项目测试；不复制源码目录中的 `.env` 或 `data/`。
3. 首次生成固定管理员密码，写入仅当前用户可读的配置文件；后续安装保留配置和数据库。
4. 后台启动服务，检查真实 HTTP 接口是否可用。启动失败时保留数据，并尝试恢复上一版本代码。代码回滚不等于数据库回滚；未来如有不兼容数据库迁移，升级前应先备份。

默认安装位置：`~/.local/share/meridian`。默认仅监听 `127.0.0.1:3000`，后台路径 `/admin`。在服务器本地查看配置中的 `ADMIN_PASSWORD` 登录；密码不会显示在安装日志。

```bash
# 自定义安装位置，或只安装不启动
bash meridian-store/install.sh --dir /home/deploy/meridian
bash meridian-store/install.sh --no-start

# 管理服务
~/.local/share/meridian/bin/meridian status
~/.local/share/meridian/bin/meridian restart
~/.local/share/meridian/bin/meridian stop
~/.local/share/meridian/bin/meridian logs

# 拉取 GitHub 最新代码，再次安装；保留商品、订单和管理员密码
git -C meridian-store pull --ff-only && bash meridian-store/install.sh
```

目录结构：`current` 指向当前程序版本，`releases/` 保留各版本代码，`shared/data/` 保存 SQLite 数据，`shared/config.env` 保存配置，`shared/server.log` 保存日志。修改配置后执行 `meridian restart`。配置由 Node 的 `--env-file` 读取，不要用 `source` 执行；如密码包含 `#` 等字符，请遵循 Node `.env` 引号规则。

后台进程在 SSH 断开后继续运行，但默认不注册开机服务。如需重启服务器后自动启动，可用该用户的 `crontab -e` 添加（路径替换为自己的真实绝对路径）：

```cron
@reboot /home/deploy/.local/share/meridian/bin/meridian start
```

公网使用前，请自行配置域名和 Nginx/Caddy HTTPS 反向代理到 `127.0.0.1:3000`，并在 `shared/config.env` 设置 `PUBLIC_BASE_URL` 和 `COOKIE_SECURE=true`。脚本不改防火墙、不申请证书，不会自动启用或填入 PayPal/USDT 收款资料；支付配置见下文。

## 启动

从项目源码直接运行时需要 Node.js 24+，无第三方运行依赖。

```sh
npm start
```

前台 `/`，后台 `/admin`，默认端口 3000。未设置 `ADMIN_PASSWORD` 时，每次启动会生成临时管理员密码并仅输出在服务终端；固定密码请通过环境变量注入，不要提交密码。会话八小时过期，重启需重新登录。

可用环境变量：`PORT`、`HOST`、`DATA_DIR`（默认 `./data`）、`ADMIN_PASSWORD`、`COOKIE_SECURE=true`（HTTPS 部署时启用）、`PUBLIC_BASE_URL`（设置后启用 canonical、Open Graph、`sitemap.xml` 与 robots 中的 Sitemap 行）、`ORDER_TTL_MINUTES`（未支付订单自动过期并返库的分钟数，默认 30，设为 0 关闭）、`SWEEP_INTERVAL_MS`（过期扫描间隔，默认 300000）。邮件通知（可选）：`MAIL_PROVIDER`（resend/postmark/sendgrid/generic，默认 resend）、`MAIL_API_KEY`、`MAIL_FROM`、`MAIL_FROM_NAME`、`MAIL_API_URL`（generic 必填）、`ORDER_NOTIFY_EMAIL`（店主副本，逗号分隔）、`WHATSAPP_NUMBER`（邮件里显示的客服号）。数据库为 SQLite，自动初始化，重启保留数据；备份整个 data 目录前应停止服务或使用 SQLite 备份机制。上传的商品图片保存在 `DATA_DIR/uploads`，需随数据库一起备份。

## 功能

- 响应式商城、EN/DE/ES 切换、分类、搜索、价格排序、详情、购物袋。
- 美元计价，支持国际地址、邮件和邮编；服务端核价、库存校验与事务扣减。
- 后台商品新增/修改/删除/上下架、库存、分类及多语言描述。
- 首页主图、主题色、品牌、公告、主视觉、服务文案、底部内容及三语言编辑。
- 内容区块增删、排序、隐藏；当前支持文字和商品列表两种区块，不是任意 HTML/布局的自由画布。
- 草稿保存、授权预览、手动发布；前台仅显示已发布内容。
- 订单记录、PayPal 官方收银台、USDT 钱包直收与人工核账，后台查看买家信息、支付状态及交易哈希。
- 未支付订单超时自动过期并释放库存（PayPal 待支付与已提交哈希的订单不自动过期，避免误返库）。
- SEO：服务端注入 description/Open Graph/Twitter Card/canonical/JSON-LD（首页 Store、商品 Product），提供 `robots.txt` 与 `sitemap.xml`，`?product=<id>` 可直接打开商品详情。
- 后台支持上传商品图片（PNG/JPEG/WebP，≤5MB，按内容哈希命名，长缓存）。
- 安全响应头：CSP、HSTS（HTTPS 时）、X-Frame-Options、Permissions-Policy；CSRF 同源校验兼容反向代理（`X-Forwarded-Host`/`PUBLIC_BASE_URL`）。
- 商品支持主图 + 图集（最多 8 张），后台上传/设为主图/移除，前台缩略图切换，点击主图全屏放大（滚轮缩放、左右切换、ESC 关闭）。
- 客户下单后立即发送订单确认邮件（HTML + 纯文本，含明细、合计、收货信息与付款入口）；邮件失败不影响下单，状态记录在订单 `details.mail`，后台「通知邮件」可发测试信。
- 页脚展示 WhatsApp 实时沟通入口与支付方式图标（仅显示已启用的 PayPal / 卡组织 / USDT）。
- 会员账户：前台注册/登录（邮箱 + 密码，scrypt 加盐，30 天会话），后台「用户管理」可把用户设为普通或 VIP，立即生效。
- 分类观看等级：分类同样有 `access`（`all`/`normal`/`vip`），商品的有效等级 = 商品自身等级与所属分类等级中**更严格**的一档。把整类商品放进 VIP 分类即可整类锁定，无需逐个设置。
- 商品观看等级：`access` = `all`（公开）/ `normal`（登录会员）/ `vip`（VIP 专属）。未达等级的商品**完全不出现在列表**（列表接口只返回有权商品），只能通过后台「商品链接」复制出的 `/?product=<id>` 直达；直链按等级放行，未授权时返回 403 并只显示通用提示（不泄露名称/图片/价格），页面返回 noindex；加购与下单同样按等级拦截，`sitemap.xml` 只列公开商品。无权分类不出现在导航与筛选中，`/?category=<id>` 可直接打开类目，后台分类编辑里可复制该类目链接。

## 验证

```sh
npm test
```

集成测试使用临时数据库和本机端口，验证授权、草稿隔离、翻译数据、发布、库存、服务器核价、订单记录、跨站保护及静态页面。

## 上线前需要完成

本项目是可运行的商城 MVP。默认运费 $12、满 $150 免运费仅为演示配置。当前金额不含目的地税费和进口关税；正式收款前应根据业务完善 VAT/销售税、关税和配送限制策略，并替换示例商品及图片。

## WhatsApp 悬浮联系按钮

后台 → 页面设计，填写带国家区号的 WhatsApp 号码并启用。可按 English / Deutsch / Español 分别编辑聊天预填消息。保存草稿后预览，发布后才在前台显示；默认未配置号码时不显示按钮。

按钮固定在屏幕右下角，随页面滚动保持可见。桌面显示联系标签，手机显示圆形图标；点击在新标签打开 WhatsApp，不会自动替客户发送消息。不加载 WhatsApp 第三方脚本。号码会出现在公开前台，请填写商家客服号码。

## PayPal 对接

1. 在 PayPal Developer 创建对应 Sandbox 或 Live REST App，通过部署平台的服务端秘密管理功能注入 `PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET`；不要写入前端、Git 或聊天。
2. 设置 `PUBLIC_BASE_URL=https://你的域名`（仅 HTTPS 根域名，不带路径），配置 HTTPS 反向代理，并启用 `COOKIE_SECURE=true`。
3. 在该 PayPal App 注册 `https://你的域名/api/payments/paypal/webhook`，订阅 `PAYMENT.CAPTURE.COMPLETED`，将对应 Webhook ID 注入 `PAYPAL_WEBHOOK_ID`。
4. 后台 → 支付设置，选择 Sandbox，启用 PayPal。前台只有在必要配置齐全时才显示该方式；“已注入”仅表示变量存在，不证明商户鉴权成功。
5. 用沙箱买家完成测试。上线时一起替换 Live 凭证、Webhook ID 和后台环境选项；不要在有未完成支付时更换应用凭证。

支付过程：先创建本地订单和专属访问令牌，再由服务端按已保存金额创建 PayPal Order，浏览器跳转到官方收银台。买家返回或签名验证成功的回调到达后，服务端查询/捕获订单并核对商户订单引用、实际扣款金额与 USD 币种，只有完成扣款才标记 Paid。重复返回或回调不会重复更新到账。遇到网络超时，可在原标签页点击“继续支付 / 刷新状态”；PayPal 创建与捕获使用固定幂等键。当前库存按创建订单扣减；未支付订单不会自动到期返库。

官方接口参考：[Orders v2](https://developer.paypal.com/docs/api/orders/v2/)、[验证 Webhook 签名](https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post)。当前使用 `NO_SHIPPING`，商城收货资料保存在本地订单中；尚未接入 PayPal 收货地址映射或卖家保障资格处理，正式卖家保障需求需单独完善。

## USDT 钱包直收与人工核账

后台 → 支付设置，选择 **TRC20（Tron）** 或 **ERC20（Ethereum）**，填写公开收款地址及 `1 USD = ? USDT` 报价比例后启用。不需要第三方支付服务或钱包私钥。TRC20 检查 Base58Check，ERC20 检查基本地址格式，均不证明地址归属；商家须自行确认地址正确。

每笔支付固定记录当时的网络、钱包、六位小数 USDT 应付金额和报价比例，后续修改配置不改变已创建支付单。报价为商家设置的固定比例，非市场实时汇率。买家自行转账、承担链上手续费，并提交交易哈希：

- `pending`：等待转账。
- `awaiting_review`：买家已提交哈希，尚未确认到账；可更正哈希。
- `paid`：管理员在订单记录中核实后确认，记录确认时间与交易哈希。

管理员必须在相应链的区块浏览器核实真实 USDT 合约、收款地址、实际金额、成功状态和足够确认数。**后台不会自动查询链上到账，也不会把哈希提交当成支付成功。** 同一网络的同一交易哈希只能确认到一个订单；重复确认同一订单保持幂等。多笔小额合并、超付、退款、错误网络或错误代币需商家另行处理。

支付配置立即生效且独立于页面草稿发布。缺省两种支付均关闭。钱包地址及网络可在后台设置；私钥与助记词不应进入网站。未开启任何支付方式时，仍可保留订单供商家联系确认。

订单访问令牌只保存在创建订单的浏览器标签页 `sessionStorage`，不出现在支付回跳 URL 中。保留原标签页用于返回与查看支付状态；关闭标签页后尚无邮件恢复链接功能。升级前的历史订单没有访问令牌，不能直接走新增自助支付流程。PayPal 退款/争议同步、自动返库、邮件通知和多币种换汇尚未实现。

## 验证范围

`npm test` 包含安装/重复升级/数据保留测试、真实本机 HTTP/SQLite 集成测试和 PayPal 模拟接口测试，覆盖配置、金额、授权、验签失败、钱包快照、人工确认与交易重复使用防护。另已用本机 Chromium 验证后台支付配置、三语言结账、USDT 哈希提交、管理员确认和前台状态更新。所有测试使用隔离数据与虚拟交易；未配置真实 PayPal 凭证、未调用真实商户收款、未发生链上转账。真实 Sandbox / Live 联调仍需商户环境配置。

默认图片为项目内置 SVG 示意图，使用系统字体，无第三方图片或字体加载依赖。

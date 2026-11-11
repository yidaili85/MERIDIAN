// 极简事务邮件：零依赖，走 HTTP API（Resend / Postmark / SendGrid / 自建兼容端点）或 SMTP
import { smtpSend } from './smtp.js';
const PROVIDERS = ['resend', 'postmark', 'sendgrid', 'generic', 'smtp'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n || 0).toFixed(2);
const addressOnly = (v) => String(v || '').replace(/^.*</, '').replace(/>.*$/, '').trim();

export function createMailer(env = process.env, fetchImpl = fetch) {
  const provider = (env.MAIL_PROVIDER || 'resend').toLowerCase();
  const key = env.MAIL_API_KEY || '';
  const from = (env.MAIL_FROM || '').trim();
  const name = (env.MAIL_FROM_NAME || 'MERIDIAN').trim();
  const fromHeader = from ? (from.includes('<') ? from : `${name} <${from}>`) : '';
  const endpoint = provider === 'generic' ? (env.MAIL_API_URL || '') : '';
  const smtpHost = (env.MAIL_SMTP_HOST || '').trim();
  const enabled = Boolean(
    PROVIDERS.includes(provider) && fromHeader && (
      provider === 'smtp' ? smtpHost
      : key && (provider !== 'generic' || endpoint)));

  async function send({ to, subject, html, text }) {
    if (!enabled) throw Error('邮件未配置（MAIL_API_KEY / MAIL_FROM）');
    if (!/^\S+@\S+\.\S+$/.test(String(to || ''))) throw Error('收件地址无效');
    let url = endpoint, init;
    if (provider === 'smtp') {
      await smtpSend({
        host: smtpHost,
        port: Number(env.MAIL_SMTP_PORT || 587),
        secure: String(env.MAIL_SMTP_SECURE || '') === 'true',
        user: env.MAIL_SMTP_USER || '',
        pass: env.MAIL_SMTP_PASS || '',
        from: addressOnly(from), fromName: name,
        to, subject, text, html,
      });
      return true;
    }
    if (provider === 'resend') {
      url = 'https://api.resend.com/emails';
      init = { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: fromHeader, to: [to], subject, html, text }) };
    } else if (provider === 'postmark') {
      url = 'https://api.postmarkapp.com/email';
      init = { method: 'POST', headers: { 'X-Postmark-Server-Token': key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ From: fromHeader, To: to, Subject: subject, HtmlBody: html, TextBody: text }) };
    } else if (provider === 'sendgrid') {
      url = 'https://api.sendgrid.com/v3/mail/send';
      const address = from.replace(/^.*</, '').replace(/>.*$/, '');
      init = { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: address, name }, subject, content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }] }) };
    } else {
      init = { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: fromHeader, to, subject, html, text }) };
    }
    const res = await fetchImpl(url, init);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch {}
      throw Error(`邮件服务返回 ${res.status}${detail ? ' ' + detail : ''}`);
    }
    return true;
  }

  return { enabled, provider, from: fromHeader, send };
}

export function orderEmail({ order, accessToken, brand = 'MERIDIAN', siteUrl = '', whatsapp = '' }) {
  const details = order.details || order;
  const items = Array.isArray(details.items) ? details.items : [];
  const rows = items.map((i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${esc(i.name)}<br><span style="color:#868686;font-size:12px">× ${i.quantity} · ${money(i.price)} each</span>${i.artwork?`<br><span style="color:#868686;font-size:12px">Custom dial artwork: <a href="${esc(i.artwork.url)}">${esc(i.artwork.url)}</a></span>`:''}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #eee">${money(i.price * i.quantity)}</td></tr>`).join('');
  const payUrl = siteUrl && accessToken ? `${siteUrl}/?order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(accessToken)}` : '';
  const subject = `订单已收到 ${order.id} · ${brand}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f3;font-family:Georgia,serif;color:#333">
<div style="max-width:600px;margin:0 auto;background:#fff;padding:36px">
  <p style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#868686;margin:0 0 18px">${esc(brand)}</p>
  <h1 style="font-family:Arial,sans-serif;font-weight:300;font-size:26px;margin:0 0 6px">感谢您的订单</h1>
  <p style="margin:0 0 24px;color:#666">我们已收到您的订单，正在确认库存与配送信息。订单号 <strong>${esc(order.id)}</strong></p>
  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}
    <tr><td style="padding:10px 0;color:#666">小计</td><td align="right">${money(details.total - (details.shipping || 0))}</td></tr>
    <tr><td style="padding:4px 0;color:#666">运费</td><td align="right">${details.shipping ? money(details.shipping) : '免运费'}</td></tr>
    <tr><td style="padding:10px 0;border-top:1px solid #111;font-family:Arial,sans-serif;font-weight:600">合计</td><td align="right" style="border-top:1px solid #111;font-family:Arial,sans-serif;font-weight:600">${money(details.total)} USD</td></tr>
  </table>
  <h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:.16em;text-transform:uppercase;margin:28px 0 8px">收货信息</h2>
  <p style="margin:0;color:#555;font-size:14px;line-height:1.7">${esc(details.name)}<br>${esc(details.address)}<br>${esc(details.postalCode)} ${esc(details.country)}<br>${esc(details.phone)}</p>
  ${payUrl ? `<p style="margin:26px 0"><a href="${payUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:13px 24px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:.16em;text-transform:uppercase">查看订单与付款</a></p>` : ''}
  <p style="color:#868686;font-size:12px;line-height:1.7;margin:22px 0 0">付款确认后我们会立即安排发货。如需修改地址或咨询物流${whatsapp ? `，可通过 WhatsApp ${esc(whatsapp)} 联系我们` : '，请直接回复此邮件'}。</p>
</div>
<p style="max-width:600px;margin:14px auto 0;text-align:center;color:#9b9b9b;font-size:11px;font-family:Arial,sans-serif">© ${new Date().getFullYear()} ${esc(brand)}</p>
</body></html>`;
  const text = [
    `${brand} — 感谢您的订单`,
    `订单号: ${order.id}`,
    '',
    ...items.map((i) => `${i.name} × ${i.quantity} — ${money(i.price * i.quantity)}${i.artwork ? ` · artwork ${i.artwork.url}` : ''}`),
    `小计: ${money(details.total - (details.shipping || 0))}`,
    `运费: ${details.shipping ? money(details.shipping) : '免运费'}`,
    `合计: ${money(details.total)} USD`,
    '',
    `${details.name} / ${details.address} / ${details.postalCode} ${details.country} / ${details.phone}`,
    payUrl ? `查看订单: ${payUrl}` : '',
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}

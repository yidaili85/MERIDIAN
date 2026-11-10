// 零依赖 SMTP 客户端：支持 STARTTLS、AUTH LOGIN / PLAIN，multipart/alternative 正文
import net from 'node:net';
import tls from 'node:tls';
import {randomBytes} from 'node:crypto';

const CRLF = '\r\n';

function conn(socket, timeoutMs) {
  let buf = '', waiters = [], err = null, closed = false, sock = socket;
  const pump = () => {
    while (waiters.length) {
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      waiters.shift().resolve(line);
    }
  };
  const fail = (e) => {
    err = e || new Error('SMTP connection closed');
    while (waiters.length) waiters.shift().reject(err);
  };
  const attach = (s) => {
    sock = s;
    s.setEncoding('utf8');
    s.setTimeout(timeoutMs, () => s.destroy(new Error('SMTP timeout')));
    s.on('data', (d) => { buf += d; pump(); });
    s.on('error', fail);
    s.on('close', () => { closed = true; fail(); });
  };
  attach(socket);
  const api = {
    line() {
      return new Promise((resolve, reject) => {
        if (err) return reject(err);
        waiters.push({ resolve, reject });
        pump();
      });
    },
    async reply() {
      const lines = [];
      for (;;) {
        const line = await api.line();
        lines.push(line);
        if (line.length < 4 || line[3] !== '-') return { code: Number(line.slice(0, 3)), lines };
      }
    },
    write(text) {
      if (closed || err) throw err || new Error('SMTP connection closed');
      sock.write(text + CRLF);
    },
    async starttls(host) {
      const secured = tls.connect({ socket: sock, servername: host });
      await new Promise((resolve, reject) => {
        secured.once('secureConnect', resolve);
        secured.once('error', reject);
      });
      sock.removeAllListeners('data');
      sock.removeAllListeners('error');
      sock.removeAllListeners('close');
      attach(secured);
      return api;
    },
    close() { try { sock.end(); } catch {} },
  };
  return api;
}

const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const addr = (v) => String(v || '').replace(/^.*</, '').replace(/>.*$/, '').trim();
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function buildMessage({ fromHeader, to, subject, text, html }) {
  const boundary = 'meridian-' + randomBytes(12).toString('hex');
  const head = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@meridian>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text || ''),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html || text || ''),
    `--${boundary}--`,
    '',
  ];
  const raw = head.join(CRLF) + CRLF + CRLF + parts.join(CRLF);
  // 行首的 . 需要转义（RFC 5321 4.5.2）
  return raw.split(CRLF).map((l) => (l.startsWith('.') ? '.' + l : l)).join(CRLF);
}

export async function smtpSend(opts) {
  const {
    host, port = 587, secure = false, user, pass,
    from, fromName = 'MERIDIAN', to, subject, text, html, timeout = 20000,
  } = opts;
  if (!host) throw Error('未配置 SMTP 服务器地址');
  if (!to) throw Error('收件地址无效');

  const fromHeader = from.includes('<') ? from : `${fromName} <${addr(from)}>`;
  let c = conn(secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port }), timeout);
  try {
    const greet = await c.reply();
    if (greet.code !== 220) throw Error('SMTP 服务未就绪：' + greet.lines.join(' '));

    let ehlo = await (async () => {
      c.write('EHLO meridian.local');
      return c.reply();
    })();
    if (ehlo.code !== 250) throw Error('SMTP EHLO 失败：' + ehlo.lines.join(' '));

    if (!secure && ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
      c.write('STARTTLS');
      const r = await c.reply();
      if (r.code !== 220) throw Error('STARTTLS 被拒绝：' + r.lines.join(' '));
      c = await c.starttls(host);
      c.write('EHLO meridian.local');
      ehlo = await c.reply();
      if (ehlo.code !== 250) throw Error('SMTP EHLO(加密后) 失败：' + ehlo.lines.join(' '));
    }

    if (user) {
      c.write('AUTH LOGIN');
      const r1 = await c.reply();
      if (r1.code !== 334) throw Error('SMTP AUTH 不被支持：' + r1.lines.join(' '));
      c.write(b64(user));
      const r2 = await c.reply();
      if (r2.code !== 334) throw Error('SMTP 用户名被拒绝：' + r2.lines.join(' '));
      c.write(b64(pass || ''));
      const r3 = await c.reply();
      if (r3.code !== 235) throw Error('SMTP 登录失败：' + r3.lines.join(' '));
    }

    c.write(`MAIL FROM:<${addr(from)}>`);
    const mf = await c.reply();
    if (mf.code !== 250) throw Error('SMTP 发件人被拒绝：' + mf.lines.join(' '));

    c.write(`RCPT TO:<${addr(to)}>`);
    const rc = await c.reply();
    if (![250, 251].includes(rc.code)) throw Error('SMTP 收件人被拒绝：' + rc.lines.join(' '));

    c.write('DATA');
    const data = await c.reply();
    if (data.code !== 354) throw Error('SMTP DATA 被拒绝：' + data.lines.join(' '));

    c.write(buildMessage({ fromHeader, to, subject, text, html }) + CRLF + '.');
    const done = await c.reply();
    if (done.code !== 250) throw Error('SMTP 投递失败：' + done.lines.join(' '));

    c.write('QUIT');
    return true;
  } finally {
    c.close();
  }
}

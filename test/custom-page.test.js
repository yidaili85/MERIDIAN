import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = 41900 + Math.floor(Math.random() * 300);
const dir = mkdtempSync(join(tmpdir(), 'meridian-custom-'));

async function start() {
  writeFileSync(join(dir, 'config.env'), 'ADMIN_PASSWORD=custom-pass-123\n');
  const p = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', ADMIN_PASSWORD: 'custom-pass-123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  p.stdout.on('data', d => out.push(d.toString()));
  p.stderr.on('data', d => out.push(d.toString()));
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100));
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) return p; } catch {}
  }
  throw new Error('server did not start: ' + out.join(''));
}

const base = () => `http://127.0.0.1:${port}`;
let proc;

test('custom page: /custom renders the SPA shell and is listed in the sitemap', async t => {
  proc = await start();
  t.after(() => {
    if (proc) { proc.kill('SIGTERM'); }
    rmSync(dir, { recursive: true, force: true });
  });
  proc.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 400));
  // 用 HTTPS 基址重启，让 sitemap 生效
  proc = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1',
      ADMIN_PASSWORD: 'custom-pass-123', PUBLIC_BASE_URL: 'https://demo.ikuci.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100));
    try { const r = await fetch(`${base()}/healthz`); if (r.ok) break; } catch {}
  }

  // 页面可用（SPA 由 index.html 承载）
  let r = await fetch(base() + '/custom');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<div id="app">/);
  assert.equal(r.headers.get('content-type').split(';')[0], 'text/html');

  // 静态资源里确实有定制目录页逻辑
  const app = await (await fetch(base() + '/app.js')).text();
  assert.match(app, /function renderCustomPage\(/);
  assert.match(app, /czrPageTitle/);
  assert.match(app, /href="\/custom"/);

  // sitemap 收录 /custom
  r = await fetch(base() + '/sitemap.xml');
  assert.equal(r.status, 200);
  const xml = await r.text();
  assert.match(xml, /https:\/\/demo\.ikuci\.com\/custom<\/loc>/);

  // 首页也挂了导航入口
  const home = await (await fetch(base() + '/')).text();
  assert.match(home, /meridian-assets/);
});

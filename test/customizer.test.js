import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = 41300 + Math.floor(Math.random() * 400);
const dir = mkdtempSync(join(tmpdir(), 'meridian-czr-'));

// 1x1 透明 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function start() {
  writeFileSync(join(dir, 'config.env'), 'ADMIN_PASSWORD=czr-pass-123\n');
  const p = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', ADMIN_PASSWORD: 'czr-pass-123' },
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
const post = (path, body, headers = {}) => fetch(base() + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

let proc;
test('customizer: artwork upload + order carries placement', async t => {
  proc = await start();
  t.after(() => { proc.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); });

  // 只收 PNG
  let r = await post('/api/artwork', { data: 'data:image/jpeg;base64,' + Buffer.from('GIF89a').toString('base64') });
  assert.equal(r.status, 400);

  r = await post('/api/artwork', {});
  assert.equal(r.status, 400);

  r = await post('/api/artwork', { data: 'data:image/png;base64,' + PNG.toString('base64') });
  assert.equal(r.status, 201);
  const { url } = await r.json();
  assert.match(url, /^\/uploads\/[a-f0-9]{32}\.png$/);

  // 落盘可访问
  const got = await fetch(base() + url);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');

  const files = readdirSync(join(dir, 'uploads')).filter(f => f.endsWith('.png'));
  assert.ok(files.length >= 1 && existsSync(join(dir, 'uploads', files[0])));

  // 后台开启定制
  r = await post('/api/login', { password: 'czr-pass-123' });
  assert.equal(r.status, 200);
  const cookie = (r.headers.getSetCookie?.() || [r.headers.get('set-cookie')]).filter(Boolean).map(c => c.split(';')[0]).join('; ');
  const store = await (await fetch(base() + '/api/store')).json();
  const content = { ...store, products: store.products.map(p => p.id === 'p1' ? { ...p, customizer: { enabled: true, x: 48, y: 52, size: 30 } } : p) };
  r = await fetch(base() + '/api/admin/content', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(content) });
  assert.equal(r.status, 200);
  r = await fetch(base() + '/api/admin/publish', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie } });
  assert.equal(r.status, 200);
  const after = await (await fetch(base() + '/api/store')).json();
  const p1 = after.products.find(p => p.id === 'p1');
  assert.equal(p1.customizer.enabled, true);
  assert.equal(p1.customizer.x, 48);
  assert.equal(p1.customizer.size, 30);

  // 下单带图案
  r = await post('/api/orders', {
    name: 'Custom Buyer', email: 'buyer@example.com', phone: '+1 617 555 0100',
    address: '1 Test Street', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US',
    note: 'Please put the shield a little higher.',
    items: [{ id: 'p1', quantity: 1, artwork: { url, x: 48, y: 52, size: 30, preview: url } }],
  });
  assert.ok([200, 201].includes(r.status), 'order created: ' + r.status);
  const order = await r.json();
  assert.ok(order.id);

  const detail = await (await fetch(`${base()}/api/orders/lookup?email=${encodeURIComponent('buyer@example.com')}&id=${encodeURIComponent(order.id)}`)).json();
  assert.equal(detail.items[0].artwork.url, url);
  assert.equal(detail.items[0].artwork.size, 30);
  assert.equal(detail.items[0].artwork.preview, url);
  assert.equal(detail.items[0].fee, 25, 'custom dial fee applied per item');
  // 定制商品单价 189 + 25 定制费，运费按商品+定制合计计算
  assert.ok(detail.total >= 214, 'total includes the customisation fee: ' + detail.total);

  // 非本站图案路径一律丢弃
  r = await post('/api/orders', {
    name: 'Custom Buyer 2', email: 'buyer2@example.com', phone: '+1 617 555 0101',
    address: '2 Test Street', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US',
    items: [{ id: 'p1', quantity: 1, artwork: { url: 'https://evil.example.com/x.png', preview: 'https://evil.example.com/p.png', x: 1, y: 1, size: 20 } }],
  });
  assert.ok([200, 201].includes(r.status), 'order2 created: ' + r.status);
  const o2 = await r.json();
  const d2 = await (await fetch(`${base()}/api/orders/lookup?email=${encodeURIComponent('buyer2@example.com')}&id=${encodeURIComponent(o2.id)}`)).json();
  assert.equal(d2.items[0].artwork, undefined);
  assert.equal(d2.items[0].fee, 0, 'no fee without valid artwork');

  // 越界数值被夹紧
  r = await post('/api/orders', {
    name: 'Custom Buyer 3', email: 'buyer3@example.com', phone: '+1 617 555 0102',
    address: '3 Test Street', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US',
    items: [{ id: 'p1', quantity: 1, artwork: { url, x: 999, y: -50, size: 1000, rot: 500 } }],
  });
  const o3 = await r.json();
  const d3 = await (await fetch(`${base()}/api/orders/lookup?email=${encodeURIComponent('buyer3@example.com')}&id=${encodeURIComponent(o3.id)}`)).json();
  assert.equal(d3.items[0].artwork.x, 100);
  assert.equal(d3.items[0].artwork.y, 0);
  assert.equal(d3.items[0].artwork.size, 120);
  assert.equal(d3.items[0].artwork.rot, 45);
});

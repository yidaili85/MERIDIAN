import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {deflateSync} from 'node:zlib';
import {request as httpRequest} from 'node:http';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const customer = (email) => ({
  name: 'Security Tester', email, phone: '+1 202 555 0123', address: '1 Main Street',
  city: 'Boston', state: 'MA', postalCode: '02108', country: 'US',
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const paypalCaptureEvent = () => ({
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: {id: 'CAP-TEST', status: 'COMPLETED', supplementary_data: {related_ids: {order_id: 'PP-TEST'}}},
});
const crc32 = (buf) => {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return out;
};
const malformedPngWithValidCrc = () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.from([0]))), pngChunk('IEND', Buffer.alloc(0))]);
};
const tinyInterlacedPng = () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 6, 0, 0, 1], 8);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))), pngChunk('IEND', Buffer.alloc(0))]);
};

async function waitFor(check, {timeout = 12000, interval = 100, label = 'condition'} = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    if (await check()) return;
    await sleep(interval);
  }
  throw Error('Timed out waiting for ' + label);
}

function start(env = {}, mockPayPal = false) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'meridian-security-'));
    const port = 52000 + Math.floor(Math.random() * 6000);
    const childEnv = {...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'security-pass-123', ...env};
    if (mockPayPal) childEnv.NODE_OPTIONS = `--import=${new URL('../test-support/paypal-fetch-mock.mjs', import.meta.url).href}`;
    const child = spawn(process.execPath, ['server.js'], {env: childEnv, stdio: ['ignore', 'pipe', 'pipe']});
    const timer = setTimeout(() => reject(Error('Startup timed out')), 12000);
    timer.unref();
    child.stdout.on('data', (data) => {
      if (data.toString().includes(String(port))) {
        clearTimeout(timer);
        resolve({child, dir, base: `http://127.0.0.1:${port}`});
      }
    });
    child.stderr.on('data', (data) => {
      if (!/ExperimentalWarning|trace-warnings/.test(data.toString())) reject(Error(data));
    });
    child.on('exit', (code) => reject(Error('Exited ' + code)));
  });
}

const A = await start({PUBLIC_BASE_URL: 'https://shop.example.com'});
const E = await start({ORDER_TTL_MINUTES: '0.02', SWEEP_INTERVAL_MS: '200', PAYMENT_RULES: 'off'});
const R = await start({});
const P = await start({PUBLIC_BASE_URL: 'https://shop.example.com'}, true);
const Q = await start({PUBLIC_BASE_URL: 'https://shop.example.com', ORDER_TTL_MINUTES: '0.05', SWEEP_INTERVAL_MS: '50', PAYMENT_RULES: 'off', PAYPAL_MOCK_CAPTURE_DELAY_MS: '2500'}, true);
after(() => {
  for (const s of [A, E, R, P, Q]) {
    s.child.kill();
    rmSync(s.dir, {recursive: true, force: true});
  }
});

async function post(base, path, body, headers = {}) {
  return fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
}
async function postFrom(base, path, body, localAddress, headers = {}) {
  const url = new URL(base + path);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', localAddress,
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers},
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end(payload);
  });
}
async function adminCookie(server, password = 'security-pass-123') {
  const response = await post(server.base, '/api/login', {password});
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
async function stock(base, id) {
  const store = await (await fetch(base + '/api/store')).json();
  return store.products.find((product) => product.id === id).stock;
}

let adminA = '';
test('setup admin session for regression checks', async () => {
  adminA = await adminCookie(A);
});

test('registering an unverified address cannot claim older guest orders', async () => {
  const guest = await (await post(A.base, '/api/orders', {...customer('victim@example.test'), items: [{id: 'p1', quantity: 1}]})).json();
  const registration = await post(A.base, '/api/auth/register', {email: 'victim@example.test', name: 'Attacker', password: 'attacker-pass-123'});
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get('set-cookie').split(';')[0];

  const list = await (await fetch(A.base + '/api/account/orders', {headers: {Cookie: cookie}})).json();
  assert.deepEqual(list.orders, []);
  const access = await post(A.base, `/api/account/orders/${encodeURIComponent(guest.id)}/access`, {}, {Cookie: cookie});
  assert.equal(access.status, 403);
});

test('HTTPS public URL automatically marks session cookies Secure', async () => {
  const registration = await post(A.base, '/api/auth/register', {email: 'secure-cookie@example.test', name: 'Secure Cookie', password: 'secure-pass-123'});
  assert.equal(registration.status, 201);
  assert.match(registration.headers.get('set-cookie') || '', /; Secure(?:;|$)/i);
});

test('orders placed while signed in remain visible to their owner', async () => {
  const registration = await post(A.base, '/api/auth/register', {email: 'owner@example.test', name: 'Owner', password: 'owner-pass-123'});
  const cookie = registration.headers.get('set-cookie').split(';')[0];
  const created = await post(A.base, '/api/orders', {...customer('owner@example.test'), items: [{id: 'p2', quantity: 1}]}, {Cookie: cookie});
  assert.equal(created.status, 201);
  const order = await created.json();
  const list = await (await fetch(A.base + '/api/account/orders', {headers: {Cookie: cookie}})).json();
  assert.ok(list.orders.some((row) => row.id === order.id));
});

test('direct lookup still finds an order after more than 500 newer orders', async () => {
  const order = await (await post(A.base, '/api/orders', {...customer('old-order@example.test'), items: [{id: 'p3', quantity: 1}]})).json();
  const db = new DatabaseSync(join(A.dir, 'store.sqlite'));
  const insert = db.prepare('INSERT INTO orders VALUES (?,?,?)');
  db.exec('BEGIN');
  for (let i = 0; i < 501; i++) {
    insert.run(`FILLER${i}`, new Date(Date.now() + 10000 + i).toISOString(), JSON.stringify({email: `filler${i}@example.test`, status: 'Awaiting confirmation — unpaid', items: [], total: 1}));
  }
  db.exec('COMMIT');
  db.close();

  const found = await fetch(A.base + `/api/orders/lookup?email=old-order@example.test&id=${encodeURIComponent(order.id)}`);
  assert.equal(found.status, 200);
  assert.equal((await found.json()).id, order.id);
});

test('expired orders cannot create or submit payments', async () => {
  const cookie = await adminCookie(E);
  const config = {paypalEnabled: false, paypalMode: 'sandbox', usdtEnabled: true, usdtNetwork: 'erc20', usdtAddress: '0x' + '1'.repeat(40), usdtRate: 1};
  const saved = await fetch(E.base + '/api/admin/payments', {method: 'PUT', headers: {'Content-Type': 'application/json', Cookie: cookie}, body: JSON.stringify(config)});
  assert.equal(saved.status, 200);

  const before = await stock(E.base, 'p4');
  const order = await (await post(E.base, '/api/orders', {...customer('expired@example.test'), items: [{id: 'p4', quantity: 1}]})).json();
  await waitFor(async () => await stock(E.base, 'p4') === before, {label: 'expired stock release'});

  const payment = await post(E.base, `/api/orders/${order.id}/payment`, {provider: 'usdt'}, {Authorization: 'Bearer ' + order.accessToken});
  assert.equal(payment.status, 409);
  const transaction = await post(E.base, `/api/orders/${order.id}/transaction`, {transactionId: 'a'.repeat(64)}, {Authorization: 'Bearer ' + order.accessToken});
  assert.equal(transaction.status, 409);
});

test('abandoned pending PayPal checkout releases stock after TTL', async () => {
  const before = await stock(E.base, 'p2');
  const order = await (await post(E.base, '/api/orders', {...customer('abandoned@example.test'), items: [{id: 'p2', quantity: 1}]})).json();
  const db = new DatabaseSync(join(E.dir, 'store.sqlite'));
  db.prepare('INSERT INTO payments VALUES (?,?)').run(order.id, JSON.stringify({provider: 'paypal', providerId: 'PP-ABANDONED', mode: 'sandbox', status: 'pending', amount: String(order.total), currency: 'USD'}));
  db.close();
  await waitFor(async () => await stock(E.base, 'p2') === before, {label: 'PayPal abandoned stock release'});
  const rows = await (await fetch(E.base + '/api/admin/orders', {headers: {Cookie: await adminCookie(E)}})).json();
  assert.equal(rows.find((row) => row.id === order.id).details.stockReleased, true);
});

test('rate limits use the rightmost real client behind a trusted local proxy', async () => {
  for (let i = 0; i < 10; i++) {
    const response = await post(R.base, '/api/login', {password: 'wrong'}, {'X-Forwarded-For': `203.0.113.${i + 1}, 198.51.100.10`});
    assert.equal(response.status, 401);
  }
  assert.equal((await post(R.base, '/api/login', {password: 'wrong'}, {'X-Forwarded-For': '203.0.113.200, 198.51.100.10'})).status, 429);
  assert.equal((await post(R.base, '/api/login', {password: 'wrong'}, {'X-Forwarded-For': '203.0.113.200, 198.51.100.11'})).status, 401);
});

test('forwarded host is only trusted from a trusted proxy socket', async () => {
  const status = await postFrom(R.base, '/api/track', {kind: 'product'}, '127.0.0.2', {
    Origin: 'https://attacker.example', 'X-Forwarded-Host': 'attacker.example',
  });
  assert.equal(status, 403);
});

test('one client cannot create unlimited unpaid orders', async () => {
  const codes = [];
  for (let i = 0; i < 11; i++) {
    const response = await post(R.base, '/api/orders', {...customer(`flood${i}@example.test`), items: [{id: 'p3', quantity: 1}]}, {'X-Forwarded-For': '203.0.113.44'});
    codes.push(response.status);
  }
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(201));
  assert.equal(codes[10], 429);
});

test('artwork upload rejects a PNG signature followed by garbage', async () => {
  const fake = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('not-an-image')]);
  const response = await post(A.base, '/api/artwork', {data: 'data:image/png;base64,' + fake.toString('base64')});
  assert.equal(response.status, 400);
});

test('artwork upload rejects structurally truncated PNG scanlines with valid CRCs', async () => {
  const fake = malformedPngWithValidCrc();
  const response = await post(A.base, '/api/artwork', {data: 'data:image/png;base64,' + fake.toString('base64')});
  assert.equal(response.status, 400);
});

test('artwork upload accepts a valid transparent Adam7 PNG', async () => {
  const image = tinyInterlacedPng();
  const response = await post(A.base, '/api/artwork', {data: 'data:image/png;base64,' + image.toString('base64')});
  assert.equal(response.status, 201);
});

test('invalid artwork attempts are rate limited before expensive parsing', async () => {
  const data = 'data:image/png;base64,' + Buffer.from('not-a-png').toString('base64');
  for (let i = 0; i < 20; i++) {
    const response = await post(A.base, '/api/artwork', {data}, {'X-Forwarded-For': '198.51.100.90'});
    assert.equal(response.status, 400);
  }
  const blocked = await post(A.base, '/api/artwork', {data}, {'X-Forwarded-For': '198.51.100.90'});
  assert.equal(blocked.status, 429);
});

test('shipping recalculation keeps the snapshotted customizer fee', async () => {
  const upload = await (await post(A.base, '/api/artwork', {data: 'data:image/png;base64,' + PNG.toString('base64')})).json();
  const created = await post(A.base, '/api/orders', {...customer('fee@example.test'), items: [{id: 'p1', quantity: 1, artwork: {url: upload.url, x: 50, y: 50, size: 30}}]});
  assert.equal(created.status, 201);
  const order = await created.json();
  assert.ok(order.items[0].fee > 0);

  const recalculated = await post(A.base, `/api/admin/orders/${order.id}/shipping`, {rule: {mode: 'free'}}, {Cookie: adminA});
  assert.equal(recalculated.status, 200);
  const result = await recalculated.json();
  assert.equal(Math.round(result.total * 100), Math.round((order.items[0].price + order.items[0].fee) * 100));
});

test('invalid analytics days falls back to a finite default', async () => {
  const response = await fetch(A.base + '/api/admin/analytics?days=not-a-number', {headers: {Cookie: adminA}});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data && typeof data === 'object');
});

test('PayPal capture uses credentials saved in the admin settings', async () => {
  const cookie = await adminCookie(P);
  const config = {paypalEnabled: true, paypalMode: 'sandbox', usdtEnabled: false, usdtNetwork: 'erc20', usdtAddress: '', usdtRate: 1, paypalClientId: 'db-client', paypalClientSecret: 'db-secret', paypalWebhookId: 'WH-TEST'};
  const saved = await fetch(P.base + '/api/admin/payments', {method: 'PUT', headers: {'Content-Type': 'application/json', Cookie: cookie}, body: JSON.stringify(config)});
  assert.equal(saved.status, 200);
  const order = await (await post(P.base, '/api/orders', {...customer('paypal@example.test'), items: [{id: 'p1', quantity: 1}]})).json();
  const headers = {Authorization: 'Bearer ' + order.accessToken};
  assert.equal((await post(P.base, `/api/orders/${order.id}/payment`, {provider: 'paypal'}, headers)).status, 201);
  const changedShipping = await post(P.base, `/api/admin/orders/${order.id}/shipping`, {rule: {mode: 'free'}}, {Cookie: cookie});
  assert.equal(changedShipping.status, 400, 'an existing payment snapshot must freeze the order total');
  const captured = await post(P.base, `/api/orders/${order.id}/capture`, {}, headers);
  assert.equal(captured.status, 200);
  assert.equal((await captured.json()).payment.status, 'paid');
});

test('the expiry sweeper cannot release stock during an in-flight PayPal capture', async () => {
  const cookie = await adminCookie(Q);
  const config = {paypalEnabled: true, paypalMode: 'sandbox', usdtEnabled: false, usdtNetwork: 'erc20', usdtAddress: '', usdtRate: 1, paypalClientId: 'db-client', paypalClientSecret: 'db-secret', paypalWebhookId: 'WH-TEST'};
  assert.equal((await fetch(Q.base + '/api/admin/payments', {method: 'PUT', headers: {'Content-Type': 'application/json', Cookie: cookie}, body: JSON.stringify(config)})).status, 200);
  const before = await stock(Q.base, 'p1');
  const order = await (await post(Q.base, '/api/orders', {...customer('paypal-race@example.test'), items: [{id: 'p1', quantity: 1}]})).json();
  const headers = {Authorization: 'Bearer ' + order.accessToken};
  assert.equal((await post(Q.base, `/api/orders/${order.id}/payment`, {provider: 'paypal'}, headers)).status, 201);
  await sleep(1000);
  const captured = await post(Q.base, `/api/orders/${order.id}/capture`, {}, headers);
  assert.equal(captured.status, 200);
  assert.equal((await captured.json()).payment.status, 'paid');
  assert.equal(await stock(Q.base, 'p1'), before - 1);
  const rows = await (await fetch(Q.base + '/api/admin/orders', {headers: {Cookie: cookie}})).json();
  assert.notEqual(rows.find((row) => row.id === order.id).details.stockReleased, true);
});

test('a PayPal webhook in flight during expiry keeps the stock reserved', async () => {
  const W = await start({PUBLIC_BASE_URL: 'https://shop.example.com', ORDER_TTL_MINUTES: '0.05', SWEEP_INTERVAL_MS: '50', PAYMENT_RULES: 'off', PAYPAL_MOCK_VERIFY_DELAY_MS: '4000'}, true);
  try {
    const cookie = await adminCookie(W);
    const config = {paypalEnabled: true, paypalMode: 'sandbox', usdtEnabled: false, usdtNetwork: 'erc20', usdtAddress: '', usdtRate: 1, paypalClientId: 'db-client', paypalClientSecret: 'db-secret', paypalWebhookId: 'WH-TEST'};
    assert.equal((await fetch(W.base + '/api/admin/payments', {method: 'PUT', headers: {'Content-Type': 'application/json', Cookie: cookie}, body: JSON.stringify(config)})).status, 200);
    const before = await stock(W.base, 'p1');
    const order = await (await post(W.base, '/api/orders', {...customer('paypal-webhook@example.test'), items: [{id: 'p1', quantity: 1}]})).json();
    const headers = {Authorization: 'Bearer ' + order.accessToken};
    assert.equal((await post(W.base, `/api/orders/${order.id}/payment`, {provider: 'paypal'}, headers)).status, 201);
    // 验签要 4s，订单 3s 就过期；这段时间里不能返库，否则钱收了货也卖回去了。
    const webhook = await post(W.base, '/api/payments/paypal/webhook', paypalCaptureEvent(), {'paypal-transmission-id': 'TX-1'});
    assert.equal(webhook.status, 200);
    const rows = await (await fetch(W.base + '/api/admin/orders', {headers: {Cookie: cookie}})).json();
    const row = rows.find((item) => item.id === order.id);
    assert.equal(row.details.status, 'Paid');
    assert.notEqual(row.details.stockReleased, true);
    assert.equal(await stock(W.base, 'p1'), before - 1);
  } finally {
    W.child.kill();
    rmSync(W.dir, {recursive: true, force: true});
  }
});

test('a PayPal capture that lands after expiry is settled and re-reserves stock', async () => {
  const L = await start({PUBLIC_BASE_URL: 'https://shop.example.com', ORDER_TTL_MINUTES: '0.01', SWEEP_INTERVAL_MS: '50', PAYMENT_RULES: 'off'}, true);
  try {
    const cookie = await adminCookie(L);
    const config = {paypalEnabled: true, paypalMode: 'sandbox', usdtEnabled: false, usdtNetwork: 'erc20', usdtAddress: '', usdtRate: 1, paypalClientId: 'db-client', paypalClientSecret: 'db-secret', paypalWebhookId: 'WH-TEST'};
    assert.equal((await fetch(L.base + '/api/admin/payments', {method: 'PUT', headers: {'Content-Type': 'application/json', Cookie: cookie}, body: JSON.stringify(config)})).status, 200);
    const before = await stock(L.base, 'p1');
    const order = await (await post(L.base, '/api/orders', {...customer('paypal-late@example.test'), items: [{id: 'p1', quantity: 1}]})).json();
    const headers = {Authorization: 'Bearer ' + order.accessToken};
    assert.equal((await post(L.base, `/api/orders/${order.id}/payment`, {provider: 'paypal'}, headers)).status, 201);
    const rows = async () => (await (await fetch(L.base + '/api/admin/orders', {headers: {Cookie: cookie}})).json());
    await waitFor(async () => (await rows()).find((item) => item.id === order.id)?.details.stockReleased === true, {label: 'expiry sweep'});
    assert.equal(await stock(L.base, 'p1'), before);
    const webhook = await post(L.base, '/api/payments/paypal/webhook', paypalCaptureEvent(), {'paypal-transmission-id': 'TX-2'});
    assert.equal(webhook.status, 200);
    const row = (await rows()).find((item) => item.id === order.id);
    assert.equal(row.details.status, 'Paid');
    assert.notEqual(row.details.stockReleased, true, 'a captured payment must hold its stock again');
    assert.equal(await stock(L.base, 'p1'), before - 1);
  } finally {
    L.child.kill();
    rmSync(L.dir, {recursive: true, force: true});
  }
});

test('an auto-generated admin password is stored in a 0600 file, never printed to logs', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'meridian-bootstrap-password-'));
  const port = 58000 + Math.floor(Math.random() * 500);
  const env = {...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: ''};
  const child = spawn(process.execPath, ['server.js'], {env, stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => { child.kill(); rmSync(dir, {recursive: true, force: true}); });
  let output = '';
  child.stdout.on('data', (data) => { output += data.toString(); });
  child.stderr.on('data', (data) => { output += data.toString(); });
  await waitFor(() => output.includes(String(port)), {label: 'password bootstrap server'});
  const path = join(dir, 'initial-admin-password');
  assert.equal(existsSync(path), true);
  const password = readFileSync(path, 'utf8').trim();
  assert.ok(password.length >= 16);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(output.includes(password), false);
  assert.doesNotMatch(output, /临时管理员密码/);
});

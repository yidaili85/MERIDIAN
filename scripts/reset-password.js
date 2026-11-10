#!/usr/bin/env node
// 重置后台密码：不需要进入后台，也不需要重启服务。
//
//   node scripts/reset-password.js            # 删除库里的密码，回到 config.env 里的初始密码
//   node scripts/reset-password.js '新密码'    # 直接把后台密码设成新密码（至少 10 位）
//
// 数据库位置与主程序一致：DATA_DIR > ./data
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const dir = process.env.DATA_DIR || './data';
const file = resolve(dir, 'store.sqlite');
if (!existsSync(file)) {
  console.error(`找不到数据库：${file}\n请在部署目录里执行，或用 DATA_DIR 指定数据目录。`);
  process.exit(1);
}

const next = process.argv[2];
const db = new DatabaseSync(file);
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');

if (!next) {
  const n = db.prepare('DELETE FROM settings WHERE key=?').run('admin_password').changes;
  console.log(n ? '已删除后台自定义密码，登录密码恢复为 config.env 中的 ADMIN_PASSWORD。' : '库里没有自定义密码，本来就是 config.env 中的 ADMIN_PASSWORD。');
} else {
  if (next.length < 10) {
    console.error('新密码至少 10 位。');
    process.exit(2);
  }
  const salt = randomBytes(16);
  const value = salt.toString('hex') + ':' + scryptSync(next, salt, 64).toString('hex');
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('admin_password', value);
  console.log('后台密码已更新。所有已登录设备需要重新登录。');
}
db.close();

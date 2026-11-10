import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function start(env){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-paypal-'));
  const port=46000+Math.floor(Math.random()*2000);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'paypal-pass-123',PUBLIC_BASE_URL:'https://shop.example.com',...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}

const S=await start({});
after(()=>{S.child.kill();rmSync(S.dir,{recursive:true,force:true});});

const login=async()=>{
 const r=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'paypal-pass-123'})});
 return (r.headers.get('set-cookie')||'').split(';')[0];
};
const cfg={paypalEnabled:true,paypalMode:'sandbox',usdtEnabled:false,usdtNetwork:'trc20',usdtAddress:'',usdtRate:1};

test('PayPal credentials can be typed in the admin panel and are never returned in full',async()=>{
 const cookie=await login();
 const saved=await fetch(S.base+'/api/admin/payments',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({...cfg,paypalClientId:'client-abc-123',paypalClientSecret:'super-secret-value-9876',paypalWebhookId:'WH-1234567890'})});
 assert.equal(saved.status,200);
 const after=await saved.json();
 assert.equal(after.config.paypalClientSecret,'');
 assert.equal(after.config.paypalClientSecretSet,true);
 assert.match(after.config.paypalClientSecretMask,/9876$/);
 assert.equal(after.readiness.paypalCredentials,true);
 assert.equal(after.readiness.paypalWebhook,true);
 assert.equal(after.readiness.publicURL,true);
 assert.equal(after.config.paypalClientId,'client-abc-123');

 const row=await (await fetch(S.base+'/api/admin/payments',{headers:{Cookie:cookie}})).json();
 assert.equal(row.config.paypalClientSecret,'');
 assert.ok(!JSON.stringify(row).includes('super-secret-value-9876'),'secret must not leak through the API');

 // 留空保存 = 保持原密钥
 const keep=await fetch(S.base+'/api/admin/payments',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({...cfg,paypalClientId:'client-abc-123',paypalClientSecret:'',paypalWebhookId:'WH-1234567890'})});
 const kept=await keep.json();
 assert.equal(kept.config.paypalClientSecretSet,true);
 assert.match(kept.config.paypalClientSecretMask,/9876$/);

 // 勾选删除 = 清空
 const cleared=await (await fetch(S.base+'/api/admin/payments',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({...cfg,paypalClientId:'client-abc-123',clearPaypalSecret:true,paypalWebhookId:'WH-1234567890'})})).json();
 assert.equal(cleared.config.paypalClientSecretSet,false);
 assert.equal(cleared.readiness.paypalCredentials,false);
});

test('anonymous callers cannot touch payment credentials',async()=>{
 assert.equal((await fetch(S.base+'/api/admin/payments')).status,401);
 assert.equal((await fetch(S.base+'/api/admin/payments',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)})).status,401);
});

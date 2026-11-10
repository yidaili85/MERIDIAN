import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function start(){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-pricing-'));
  const port=40400+Math.floor(Math.random()*200);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',PUBLIC_BASE_URL:'https://shop.example.com'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
const S=await start();
after(()=>{S.child.kill();rmSync(S.dir,{recursive:true,force:true});});

let adminCookie='';
async function login(){
 const r=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});
 adminCookie=(r.headers.get('set-cookie')||'').split(';')[0];
 assert.ok(adminCookie,'登录应返回 cookie');
}
const content=async()=>{const r=await fetch(S.base+'/api/admin/content',{headers:{Cookie:adminCookie}});assert.equal(r.status,200);return r.json();};
const save=(body)=>fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:adminCookie},body:JSON.stringify(body)});
const publish=()=>fetch(S.base+'/api/admin/publish',{method:'POST',headers:{Cookie:adminCookie}});

test('discount price: selling price drives storefront, original price is display only',async()=>{
 await login();
 const c=await content();
 assert.ok(c.products.length>0);
 const p=c.products[0];
 p.price=189; p.compareAt=249;
 const r=await save(c);
 assert.equal(r.status,200);
 assert.equal((await publish()).status,200);

 const store=await (await fetch(S.base+'/api/store')).json();
 const s=store.products.find(x=>x.id===p.id);
 assert.equal(s.price,189,'前台售价应为折扣价');
 assert.equal(s.compareAt,249,'前台应保留划线原价');

 // 订单按折扣价计算，不按原价
 const order=await fetch(S.base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Buyer',email:'b@example.com',phone:'+1 202 555 0100',country:'US',state:'MA',postalCode:'02108',address:'9 Beacon St',items:[{id:p.id,quantity:2}]})});
 assert.equal(order.status,201);
 const created=await order.json();
 assert.equal(created.total,378,'两件应按 189 × 2 计价');
});

test('original price must be higher than selling price',async()=>{
 await login();
 const c=await content();
 const p=c.products[0];
 p.price=100; p.compareAt=90;
 const r=await save(c);
 assert.equal(r.status,400,'原价低于售价应被拒绝');
 const body=await r.json();
 assert.match(body.error,/原价/);

 // 留空表示无折扣
 p.compareAt='';
 const ok=await save(c);
 assert.equal(ok.status,200);
 assert.equal((await publish()).status,200);
 const store=await (await fetch(S.base+'/api/store')).json();
 const s=store.products.find(x=>x.id===p.id);
 assert.ok(!s.compareAt||Number(s.compareAt)===0,'留空不应产生划线价');
});

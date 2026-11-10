import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// 运费规则：默认满额免邮 + 固定运费；可切成按商品金额百分比；每单可以单独重算。
function start(){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-ship-'));
  const port=50200+Math.floor(Math.random()*900);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'ship-pass'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),12000).unref();
 });
}
const S=await start();
after(()=>{S.child.kill();rmSync(S.dir,{recursive:true,force:true});});

let cookie='';
let orderId='';
const json=(u,o={})=>fetch(S.base+u,o);

test('admin can read and change the shipping rule',async()=>{
 const login=await json('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'ship-pass'})});
 cookie=login.headers.get('set-cookie').split(';')[0];
 const before=await (await json('/api/admin/shipping',{headers:{Cookie:cookie}})).json();
 assert.equal(before.config.mode,'auto');
 assert.equal(before.config.flat,1200);
 assert.equal(before.config.freeOver,15000);
 const put=await json('/api/admin/shipping',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({mode:'percent',percent:8,flat:1200,freeOver:0})});
 assert.equal(put.status,200);
 const store=await (await json('/api/store')).json();
 assert.deepEqual(store.shipping&&{mode:store.shipping.mode,percent:store.shipping.percent},{mode:'percent',percent:8});
});

test('a new order is charged the percentage of the goods total',async()=>{
 const store=await (await json('/api/store')).json();
 const p=store.products.find(x=>x.price>0);
 const mk=await json('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'p@example.com',name:'P',phone:'+16175550123',address:'1 Main',city:'Boston',state:'MA',postalCode:'02108',country:'US',items:[{id:p.id,quantity:1}]})});
 assert.equal(mk.status,201);
 const o=await mk.json();
 orderId=o.id;
 const itemsCents=Math.round(p.price*100);
 assert.equal(Math.round(o.shipping*100),Math.round(itemsCents*8/100));
 assert.equal(Math.round(o.total*100),itemsCents+Math.round(itemsCents*8/100));
 assert.equal(o.shippingRule.mode,'percent');
});

test('an order keeps its own shipping when the global rule changes',async()=>{
 await json('/api/admin/shipping',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({mode:'free',percent:0,flat:0,freeOver:0})});
 const list=await (await json('/api/admin/orders',{headers:{Cookie:cookie}})).json();
 const o=list.find(x=>x.id===orderId);
 assert.ok(o.details.shipping>0,'existing order keeps the shipping it was placed with');
});

test('admin can recompute one order: fixed amount, then percentage',async()=>{
 const items=await itemsCents();
 const flat=await (await json('/api/admin/orders/'+encodeURIComponent(orderId)+'/shipping',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({rule:{mode:'flat',flat:750}})})).json();
 assert.equal(Math.round(flat.shipping*100),750);
 assert.equal(Math.round(flat.total*100),items+750);
 const items2=await itemsCents();
 const pct=await (await json('/api/admin/orders/'+encodeURIComponent(orderId)+'/shipping',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({rule:{mode:'percent',percent:12.5}})})).json();
 assert.equal(Math.round(pct.shipping*100),Math.round(items2*12.5/100));
 const free=await (await json('/api/admin/orders/'+encodeURIComponent(orderId)+'/shipping',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({rule:{mode:'free'}})})).json();
 assert.equal(free.shipping,0);
 assert.equal(Math.round(free.total*100),await itemsCents());
});

async function itemsCents(){
 const list=await (await json('/api/admin/orders',{headers:{Cookie:cookie}})).json();
 const o=list.find(x=>x.id===orderId);
 return Math.round((o.details.items||[]).reduce((n,i)=>n+i.price*i.quantity,0)*100);
}

test('shipping values are clamped, not trusted blindly',async()=>{
 const r=await (await json('/api/admin/orders/'+encodeURIComponent(orderId)+'/shipping',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({rule:{mode:'percent',percent:500}})})).json();
 assert.ok(r.rule.percent<=100);
 const bad=await json('/api/admin/shipping',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({mode:'nonsense',percent:-5,flat:-100,freeOver:-1})});
 const cfg=(await bad.json()).config;
 assert.equal(cfg.mode,'auto');
 assert.ok(cfg.percent>=0&&cfg.flat>=0&&cfg.freeOver>=0);
});

test('shipping endpoints reject anonymous callers',async()=>{
 assert.equal((await json('/api/admin/shipping')).status,401);
 assert.equal((await json('/api/admin/orders/'+encodeURIComponent(orderId)+'/shipping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rule:{mode:'free'}})})).status,401);
});

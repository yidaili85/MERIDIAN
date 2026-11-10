import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function start(env){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-access-'));
  const port=37000+Math.floor(Math.random()*6000);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',PUBLIC_BASE_URL:'https://shop.example.com',...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
const S=await start({});
after(()=>{S.child.kill();rmSync(S.dir,{recursive:true,force:true});});

const adminCookie=async()=>(await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})})).headers.get('set-cookie').split(';')[0];
const post=async(path,body,cookie)=>fetch(S.base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body||{})});
const put=async(path,body,cookie)=>fetch(S.base+path,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
const store=async(cookie)=>(await fetch(S.base+'/api/store',{headers:cookie?{Cookie:cookie}:{}})).json();
const customer={name:'Alex',email:'alex@example.com',phone:'+1 202 555 0123',address:'12 Beacon St',country:'US',postalCode:'02108'};

let admin,vipCookie;

before(async()=>{
 admin=await adminCookie();
 const draft=await (await fetch(S.base+'/api/admin/content',{headers:{Cookie:admin}})).json();
 draft.products.find(p=>p.id==='p2').access='vip';     // 只有 VIP 可见
 draft.products.find(p=>p.id==='p3').access='normal';  // 登录会员可见
 await put('/api/admin/content',draft,admin);
 await post('/api/admin/publish',{},admin);
});

test('guests see locked entries without details, members unlock progressively',async()=>{
 const guest=await store();
 assert.equal(guest.viewer,null);
 // VIP / 会员商品完全不出现在列表里
 assert.equal(guest.products.some(p=>p.id==='p2'),false);
 assert.equal(guest.products.some(p=>p.id==='p3'),false);
 assert.ok(guest.products.some(p=>p.id==='p1'));
 const direct=await fetch(S.base+'/api/products/p2');
 assert.equal(direct.status,403);
 assert.equal((await direct.json()).access,'vip');

 const reg=await post('/api/auth/register',{email:'alex@example.com',password:'secret123',name:'Alex'});
 assert.equal(reg.status,201);
 const cookie=reg.headers.get('set-cookie').split(';')[0];
 const me=await (await fetch(S.base+'/api/auth/me',{headers:{Cookie:cookie}})).json();
 assert.equal(me.level,'normal');

 const normal=await store(cookie);
 assert.equal(normal.viewer.level,'normal');
 assert.ok(normal.products.find(p=>p.id==='p3').description.length>0);
 assert.equal(normal.products.some(p=>p.id==='p2'),false);
 const linkNormal=await fetch(S.base+'/api/products/p2',{headers:{Cookie:cookie}});
 assert.equal(linkNormal.status,403);
 const linkMember=await fetch(S.base+'/api/products/p3',{headers:{Cookie:cookie}});
 assert.equal(linkMember.status,200);
});

test('checkout rejects restricted items until the level is granted',async()=>{
 const login=await post('/api/auth/login',{email:'alex@example.com',password:'secret123'});
 const cookie=login.headers.get('set-cookie').split(';')[0];

 const blocked=await post('/api/orders',{...customer,items:[{id:'p2',quantity:1}]},cookie);
 assert.equal(blocked.status,400);
 assert.match((await blocked.json()).error,/等级/);

 const users=await (await fetch(S.base+'/api/admin/customers',{headers:{Cookie:admin}})).json();
 assert.equal(users.length,1);
 assert.equal(users[0].level,'normal');
 const upgrade=await put('/api/admin/customers/'+users[0].id,{level:'vip'},admin);
 assert.equal(upgrade.status,200);

 const vip=await store(cookie);
 assert.equal(vip.viewer.level,'vip');
 assert.ok(vip.products.find(p=>p.id==='p2'));
 const linkVip=await fetch(S.base+'/api/products/p2',{headers:{Cookie:cookie}});
 assert.equal(linkVip.status,200);
 assert.equal((await linkVip.json()).id,'p2');

 const ok=await post('/api/orders',{...customer,items:[{id:'p2',quantity:1}]},cookie);
 assert.equal(ok.status,201);
 const order=await ok.json();
 assert.ok(order.id);
 const rows=await (await fetch(S.base+'/api/admin/orders',{headers:{Cookie:admin}})).json();
 assert.equal(rows.find(r=>r.id===order.id).details.customerId,users[0].id);
 vipCookie=cookie;
});

test('product page meta is gated by level',async()=>{
 const guest=await (await fetch(S.base+'/?product=p2')).text();
 assert.doesNotMatch(guest,/"sku":"p2"/);
 assert.doesNotMatch(guest,/Chronograph/);
 assert.match(guest,/name="robots" content="noindex/);

 const sitemap=await (await fetch(S.base+'/sitemap.xml')).text();
 assert.doesNotMatch(sitemap,/product=p2/);
 assert.match(sitemap,/product=p1/);

 const vip=await (await fetch(S.base+'/?product=p2',{headers:{Cookie:vipCookie}})).text();
 assert.match(vip,/"@type":"Product"/);
 assert.match(vip,/"sku":"p2"/);
 assert.match(vip,/Chronograph/);
});

test('account hygiene: weak password, duplicate email, wrong password, logout',async()=>{
 assert.equal((await post('/api/auth/register',{email:'x@y.co',password:'short'})).status,400);
 assert.equal((await post('/api/auth/register',{email:'alex@example.com',password:'secret123'})).status,409);
 const wrong=await post('/api/auth/login',{email:'alex@example.com',password:'nope'});
 assert.equal(wrong.status,401);

 const login=await post('/api/auth/login',{email:'alex@example.com',password:'secret123'});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 await post('/api/auth/logout',{},cookie);
 assert.equal((await fetch(S.base+'/api/auth/me',{headers:{Cookie:cookie}})).status,401);

 const invalid=await put('/api/admin/content',{...(await (await fetch(S.base+'/api/admin/content',{headers:{Cookie:admin}})).json()),products:[{id:'p1',name:'x',price:1,stock:1,image:'',category:'watches',description:'',active:true,badge:'',access:'gold'}]},admin);
 assert.equal(invalid.status,400);
});

test('category level gates everything inside it',async()=>{
 const draft=await (await fetch(S.base+'/api/admin/content',{headers:{Cookie:admin}})).json();
 draft.categories.push({id:'vip-room',name:'The Vault',de:'Der Tresor',es:'La Bóveda',access:'vip'});
 draft.products.find(p=>p.id==='p4').category='vip-room';
 draft.products.find(p=>p.id==='p4').access='all'; // 商品本身公开，分类锁 VIP
 await put('/api/admin/content',draft,admin);
 await post('/api/admin/publish',{},admin);

 const guest=await store();
 assert.equal(guest.categories.some(c=>c.id==='vip-room'),false);
 assert.equal(guest.products.some(p=>p.id==='p4'),false);
 assert.equal((await fetch(S.base+'/api/products/p4')).status,403);

 const vip=await store(vipCookie);
 assert.equal(vip.categories.some(c=>c.id==='vip-room'),true);
 const item=vip.products.find(p=>p.id==='p4');
 assert.equal(item.access,'vip');

 const sitemap=await (await fetch(S.base+'/sitemap.xml')).text();
 assert.doesNotMatch(sitemap,/product=p4/);

 const bad=structuredClone(draft);bad.categories.find(c=>c.id==='vip-room').access='gold';
 assert.equal((await put('/api/admin/content',bad,admin)).status,400);
});

import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function start(){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-compliance-'));
  const port=40700+Math.floor(Math.random()*200);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',PUBLIC_BASE_URL:'https://shop.example.com'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
const S=await start();
after(()=>{S.child.kill();rmSync(S.dir,{recursive:true,force:true});});
let cookie='';
const login=async()=>{const r=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});cookie=(r.headers.get('set-cookie')||'').split(';')[0];assert.ok(cookie);};

test('policy pages render server-side and appear in the sitemap',async()=>{
 for(const id of ['privacy','terms','shipping','returns']){
  const r=await fetch(`${S.base}/${id}`);
  assert.equal(r.status,200,`/${id} 应可访问`);
  const html=await r.text();
  assert.match(html,/<h1>/,'政策页应有标题');
  assert.match(html,/Back to the shop/,'政策页应有返回商城链接');
 }
 assert.equal((await fetch(S.base+'/nope-not-a-page')).status,404);
 const xml=await (await fetch(S.base+'/sitemap.xml')).text();
 for(const id of ['privacy','terms','shipping','returns']) assert.ok(xml.includes('/'+id),`sitemap 应包含 /${id}`);
});

test('store payload exposes countries, policies and contact email',async()=>{
 const d=await (await fetch(S.base+'/api/store')).json();
 assert.equal(d.countries.length,59,'应下发 59 个国家');
 const us=d.countries.find(c=>c.code==='US');
 assert.ok(us.states.some(s=>s.code==='MA'),'US 应包含州列表');
 assert.equal(d.pages.length,4,'应下发 4 个政策页');
 assert.ok('contactEmail' in d);
});

test('checkout validates country, state and postal code',async()=>{
 await login();
 const c=await (await fetch(S.base+'/api/admin/content',{headers:{Cookie:cookie}})).json();
 const p=c.products[0];p.access='all';p.active=true;
 await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(c)});
 await fetch(S.base+'/api/admin/publish',{method:'POST',headers:{Cookie:cookie}});
 const post=(body)=>fetch(S.base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Jane Doe',email:'jane@example.com',phone:'+1 617 555 0142',address:'9 Beacon St',items:[{id:p.id,quantity:1}],...body})});

 assert.equal((await post({country:'US',state:'MA',postalCode:'02108'})).status,201,'合法美国地址应下单成功');
 assert.equal((await post({country:'US',postalCode:'ABC',state:'MA'})).status,400,'错误邮编应拒绝');
 assert.equal((await post({country:'US',postalCode:'02108'})).status,400,'美国缺州应拒绝');
 assert.equal((await post({country:'ZZ',postalCode:'12345',state:'MA'})).status,400,'不存在的国家应拒绝');
 assert.equal((await post({country:'DE',postalCode:'10115'})).status,201,'德国邮编应通过');
 assert.equal((await post({country:'DE',postalCode:'9999'})).status,400,'德国 4 位邮编应拒绝');
});

test('order lookup needs both email and order number',async()=>{
 const r=await fetch(S.base+'/api/orders/lookup?email=jane@example.com&id=NOPE');
 assert.equal(r.status,404,'不存在的订单应 404');
 const orders=await (await fetch(S.base+'/api/orders/lookup?email=jane@example.com&id=')).text();
 assert.ok(orders.includes('error'),'缺少订单号应报错');
});

test('product specs are stored and served to the storefront',async()=>{
 await login();
 const c=await (await fetch(S.base+'/api/admin/content',{headers:{Cookie:cookie}})).json();
 const p=c.products[0];
 p.specs={caseSize:'40 mm',movement:'Japanese quartz',waterResistance:'5 ATM',lugWidth:'20 mm',crystal:'Sapphire',weight:'78 g'};
 let r=await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(c)});
 assert.equal(r.status,200,'规格应可保存');
 await fetch(S.base+'/api/admin/publish',{method:'POST',headers:{Cookie:cookie}});
 const d=await (await fetch(S.base+'/api/store')).json();
 const s=d.products.find(x=>x.id===p.id);
 assert.equal(s.specs.caseSize,'40 mm');
 assert.equal(s.specs.waterResistance,'5 ATM');

 p.specs={unknownField:'x'};
 r=await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(c)});
 assert.equal(r.status,400,'未知规格字段应拒绝');
});

test('policy pages are editable from the admin content API',async()=>{
 await login();
 const c=await (await fetch(S.base+'/api/admin/content',{headers:{Cookie:cookie}})).json();
 c.pages.find(p=>p.id==='returns').title='Refund Policy';
 let r=await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(c)});
 assert.equal(r.status,200);
 await fetch(S.base+'/api/admin/publish',{method:'POST',headers:{Cookie:cookie}});
 const html=await (await fetch(S.base+'/returns')).text();
 assert.match(html,/Refund Policy/,'前台应显示改过的标题');

 c.pages[0].id='Bad Slug!';
 r=await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(c)});
 assert.equal(r.status,400,'非法页面地址应拒绝');
});

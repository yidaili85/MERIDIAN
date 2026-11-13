import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// /account 独立页：登录用户能看到自己的订单、地址、金额；管理员填写的物流单号会出现在账户页。
function start(){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-account-'));
  const port=48800+Math.floor(Math.random()*1200);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'account-pass',PUBLIC_BASE_URL:'https://shop.example.com'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),12000).unref();
 });
}
const S=await start();
after(()=>{S.child.kill();rmSync(S.dir,{recursive:true,force:true});});

let customerCookie='';
let adminCookie='';
let orderId='';

test('/account renders as its own page and is not indexed',async()=>{
 const r=await fetch(S.base+'/account');
 assert.equal(r.status,200);
 const html=await r.text();
 assert.match(html,/<meta name="robots" content="noindex/);
 assert.match(html,/id="app"/);
});

test('a registered customer gets an empty order list',async()=>{
 const reg=await fetch(S.base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'buyer@example.com',name:'Buyer',password:'buyerpass123'})});
 assert.ok([200,201].includes(reg.status));
 customerCookie=reg.headers.get('set-cookie').split(';')[0];
 const list=await (await fetch(S.base+'/api/account/orders',{headers:{Cookie:customerCookie}})).json();
 assert.deepEqual(list.orders,[]);
});

test('an order shows up in the account list with address and total',async()=>{
 const store=await (await fetch(S.base+'/api/store')).json();
 const pid=store.products[0].id;
 const mk=await fetch(S.base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json',Cookie:customerCookie},body:JSON.stringify({email:'buyer@example.com',name:'Buyer',phone:'+16175550123',address:'1 Main St',city:'Boston',state:'MA',postalCode:'02108',country:'US',items:[{id:pid,quantity:2}]})});
 assert.equal(mk.status,201);
 const created=await mk.json();
 orderId=created.id;
 const list=await (await fetch(S.base+'/api/account/orders',{headers:{Cookie:customerCookie}})).json();
 assert.equal(list.orders.length,1);
 const o=list.orders[0];
 assert.equal(o.id,orderId);
 assert.equal(o.address.city,'Boston');
 assert.equal(o.address.countryName,'United States');
 assert.ok(o.total>0);
 assert.equal(o.tracking,null);
});

test('admin sets a tracking number and the customer sees it',async()=>{
 const login=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'account-pass'})});
 adminCookie=login.headers.get('set-cookie').split(';')[0];
 const put=await fetch(S.base+'/api/admin/orders/'+encodeURIComponent(orderId)+'/tracking',{method:'POST',headers:{'Content-Type':'application/json',Cookie:adminCookie},body:JSON.stringify({carrier:'DHL',number:'CX123456789DE'})});
 assert.equal(put.status,200);
 const list=await (await fetch(S.base+'/api/account/orders',{headers:{Cookie:customerCookie}})).json();
 assert.deepEqual(list.orders[0].tracking&&{carrier:list.orders[0].tracking.carrier,number:list.orders[0].tracking.number},{carrier:'DHL',number:'CX123456789DE'});
 const lookup=await (await fetch(S.base+'/api/orders/lookup?email=buyer@example.com&id='+encodeURIComponent(orderId))).json();
 assert.equal(lookup.tracking.number,'CX123456789DE');
});

test('another customer cannot read or re-open someone else\u2019s order',async()=>{
 const reg=await fetch(S.base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'other@example.com',name:'Other',password:'otherpass123'})});
 const otherCookie=reg.headers.get('set-cookie').split(';')[0];
 const list=await (await fetch(S.base+'/api/account/orders',{headers:{Cookie:otherCookie}})).json();
 assert.deepEqual(list.orders,[]);
 const access=await fetch(S.base+'/api/account/orders/'+encodeURIComponent(orderId)+'/access',{method:'POST',headers:{Cookie:otherCookie}});
 assert.equal(access.status,403);
});

test('the owner can re-open the payment step for an unpaid order',async()=>{
 const access=await fetch(S.base+'/api/account/orders/'+encodeURIComponent(orderId)+'/access',{method:'POST',headers:{Cookie:customerCookie}});
 assert.equal(access.status,200);
 const {accessToken}=await access.json();
 assert.ok(accessToken&&accessToken.length>20);
 const state=await (await fetch(S.base+'/api/orders/'+encodeURIComponent(orderId)+'/payment',{headers:{Authorization:'Bearer '+accessToken}})).json();
 assert.equal(state.id,orderId);
});

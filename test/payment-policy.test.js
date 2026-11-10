import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function start(env){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-pay-'));
  const port=38000+Math.floor(Math.random()*4000);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',PUBLIC_BASE_URL:'https://shop.example.com',PAYPAL_CLIENT_ID:'cid',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_WEBHOOK_ID:'wh',...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
const S=await start({});
const O=await start({PAYMENT_RULES:'off'});
after(()=>{S.child.kill();O.child.kill();rmSync(S.dir,{recursive:true,force:true});rmSync(O.dir,{recursive:true,force:true});});

const adminLogin=async(base)=>(await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})})).headers.get('set-cookie').split(';')[0];
const post=(base,path,body,cookie)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body||{})});
const put=(base,path,body,cookie)=>fetch(base+path,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
const customer={name:'Alex',email:'alex@example.com',phone:'+1 202 555 0123',address:'12 Beacon St',country:'US',postalCode:'02108'};
const pay=(base,order,provider)=>post(base,'/api/orders/'+order.id+'/payment',{provider},undefined).then(r=>r);

async function setup(base){
 const admin=await adminLogin(base);
 await put(base,'/api/admin/payments',{paypalEnabled:true,paypalMode:'sandbox',usdtEnabled:true,usdtNetwork:'erc20',usdtAddress:'0x'+'1'.repeat(40),usdtRate:1},admin);
 const draft=await (await fetch(base+'/api/admin/content',{headers:{Cookie:admin}})).json();
 draft.products.find(p=>p.id==='p2').access='vip';
 await put(base,'/api/admin/content',draft,admin);
 await post(base,'/api/admin/publish',{},admin);
 await post(base,'/api/auth/register',{email:'vip@example.com',password:'password123',name:'VIP'});
 const users=await (await fetch(base+'/api/admin/customers',{headers:{Cookie:admin}})).json();
 await put(base,'/api/admin/customers/'+users[0].id,{level:'vip'},admin);
 const login=await post(base,'/api/auth/login',{email:'vip@example.com',password:'password123'});
 return {admin,cookie:login.headers.get('set-cookie').split(';')[0]};
}
const auth=(order)=>({Authorization:'Bearer '+order.accessToken});

test('public and normal items are PayPal-only, VIP items are USDT-only',async()=>{
 const {cookie}=await setup(S.base);

 const plain=await (await post(S.base,'/api/orders',{...customer,items:[{id:'p1',quantity:1}]})).json();
 assert.equal(plain.paymentPolicy,'paypal');
 const plainState=await (await fetch(S.base+'/api/orders/'+plain.id+'/payment',{headers:auth(plain)})).json();
 assert.deepEqual(plainState.allowed,['paypal']);
 const usdtOnPlain=await fetch(S.base+'/api/orders/'+plain.id+'/payment',{method:'POST',headers:{'Content-Type':'application/json',...auth(plain)},body:JSON.stringify({provider:'usdt'})});
 assert.equal(usdtOnPlain.status,400);
 assert.match((await usdtOnPlain.json()).error,/PayPal/);

 const vipOrder=await (await post(S.base,'/api/orders',{...customer,items:[{id:'p2',quantity:1}]},cookie)).json();
 assert.equal(vipOrder.paymentPolicy,'usdt');
 const vipState=await (await fetch(S.base+'/api/orders/'+vipOrder.id+'/payment',{headers:auth(vipOrder)})).json();
 assert.deepEqual(vipState.allowed,['usdt']);
 const paypalOnVip=await fetch(S.base+'/api/orders/'+vipOrder.id+'/payment',{method:'POST',headers:{'Content-Type':'application/json',...auth(vipOrder)},body:JSON.stringify({provider:'paypal'})});
 assert.equal(paypalOnVip.status,400);
 assert.match((await paypalOnVip.json()).error,/USDT/);

 const usdtOnVip=await fetch(S.base+'/api/orders/'+vipOrder.id+'/payment',{method:'POST',headers:{'Content-Type':'application/json',...auth(vipOrder)},body:JSON.stringify({provider:'usdt'})});
 assert.equal(usdtOnVip.status,201);
 assert.equal((await usdtOnVip.json()).payment.provider,'usdt');
});

test('mixed cart containing a VIP item switches the whole order to USDT',async()=>{
 const login=await post(S.base,'/api/auth/login',{email:'vip@example.com',password:'password123'});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const mixed=await (await post(S.base,'/api/orders',{...customer,items:[{id:'p1',quantity:1},{id:'p2',quantity:1}]},cookie)).json();
 assert.equal(mixed.paymentPolicy,'usdt');
});

test('PAYMENT_RULES=off restores both providers',async()=>{
 const {cookie}=await setup(O.base);
 const order=await (await post(O.base,'/api/orders',{...customer,items:[{id:'p1',quantity:1}]})).json();
 assert.equal(order.paymentPolicy,null);
 const state=await (await fetch(O.base+'/api/orders/'+order.id+'/payment',{headers:auth(order)})).json();
 assert.deepEqual(state.allowed.sort(),['paypal','usdt']);
});

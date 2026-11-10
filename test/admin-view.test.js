import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// 管理员在后台登录后，前台应能看到全部商品（含 VIP），游客仍然看不到。
function start(){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-adminview-'));
  const port=47000+Math.floor(Math.random()*1500);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'admin-view-pass',PUBLIC_BASE_URL:'https://shop.example.com'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
const S=await start();
after(()=>{S.child.kill();rmSync(S.dir,{recursive:true,force:true});});

let adminCookie='';

test('admin publishes a VIP-only product',async()=>{
 const login=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'admin-view-pass'})});
 adminCookie=login.headers.get('set-cookie').split(';')[0];
 const c=await (await fetch(S.base+'/api/admin/content',{headers:{Cookie:adminCookie}})).json();
 c.products.push({id:'vip-only-1',name:'VIP Only Watch',price:500,stock:1,category:c.categories[0].id,active:true,description:'vip',image:'',badge:'',access:'vip'});
 const put=await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:adminCookie},body:JSON.stringify(c)});
 assert.equal(put.status,200);
 assert.equal((await fetch(S.base+'/api/admin/publish',{method:'POST',headers:{'Content-Type':'application/json',Cookie:adminCookie},body:'{}'})).status,200);
});

test('guests still cannot see or open the VIP product',async()=>{
 const store=await (await fetch(S.base+'/api/store')).json();
 assert.equal(store.products.some(p=>p.id==='vip-only-1'),false);
 assert.equal(store.adminView,false);
 assert.equal((await fetch(S.base+'/api/products/vip-only-1')).status,403);
});

test('logged-in admin sees every product on the storefront',async()=>{
 const store=await (await fetch(S.base+'/api/store',{headers:{Cookie:adminCookie}})).json();
 assert.equal(store.adminView,true);
 assert.equal(store.viewer,null,'admin is not impersonated as a member');
 assert.ok(store.products.some(p=>p.id==='vip-only-1'),'VIP product visible to admin');
 const one=await fetch(S.base+'/api/products/vip-only-1',{headers:{Cookie:adminCookie}});
 assert.equal(one.status,200);
 const body=await one.json();
 assert.equal(body.access,'vip');
 assert.equal(body.locked,false);
});

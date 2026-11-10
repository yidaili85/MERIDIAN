import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function start(){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-sitemap-'));
  const port=39500+Math.floor(Math.random()*200);
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
async function login(){
 const r=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});
 cookie=(r.headers.get('set-cookie')||'').split(';')[0];
 assert.ok(cookie);
}

test('favicon: default ships with the page and admin can override it',async()=>{
 const html=await (await fetch(S.base+'/')).text();
 assert.match(html,/<link rel="icon" href="\/assets\/favicon\.svg">/,'默认应注入 favicon link');
 assert.match(html,/<link rel="apple-touch-icon"/);
 assert.equal((await fetch(S.base+'/assets/favicon.svg')).status,200,'默认图标应可访问');

 await login();
 const c=await (await fetch(S.base+'/api/admin/content',{headers:{Cookie:cookie}})).json();
 c.favicon='/uploads/0123456789abcdef0123456789abcdef.png';
 let r=await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(c)});
 assert.equal(r.status,200);
 await fetch(S.base+'/api/admin/publish',{method:'POST',headers:{Cookie:cookie}});
 const html2=await (await fetch(S.base+'/')).text();
 assert.match(html2,/href="\/uploads\/0123456789abcdef0123456789abcdef\.png"/,'自定义图标应生效');

 // 非法地址拒绝
 c.favicon='javascript:alert(1)';
 r=await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(c)});
 assert.equal(r.status,400,'非法图标地址应被拒绝');
});

test('sitemap contains guest-visible products only',async()=>{
 await login();
 const c=await (await fetch(S.base+'/api/admin/content',{headers:{Cookie:cookie}})).json();
 const pub=c.products[0],vip=c.products[1];
 pub.access='all'; pub.active=true;
 vip.access='vip'; vip.active=true;
 await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(c)});
 await fetch(S.base+'/api/admin/publish',{method:'POST',headers:{Cookie:cookie}});

 const xml=await (await fetch(S.base+'/sitemap.xml')).text();
 assert.ok(xml.includes(encodeURIComponent(pub.id)),'公开商品应写入 sitemap');
 assert.ok(!xml.includes(encodeURIComponent(vip.id)),'VIP 商品不得写入 sitemap');
 assert.ok(!/<\/?noindex/.test(xml));

 // 后台接口：鉴权 + 统计
 assert.equal((await fetch(S.base+'/api/admin/sitemap')).status,401,'未登录应 401');
 const api=await (await fetch(S.base+'/api/admin/sitemap',{headers:{Cookie:cookie}})).json();
 assert.equal(api.url,'https://shop.example.com/sitemap.xml');
 assert.ok(api.products.every(p=>p.id!==vip.id),'后台统计也不含 VIP 商品');
 assert.ok(api.excluded>=1,'应报告被排除的受限商品数量');
});

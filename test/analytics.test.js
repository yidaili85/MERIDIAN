import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function start(env){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-analytics-'));
  const port=39600+Math.floor(Math.random()*300);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
const S=await start({PUBLIC_BASE_URL:'https://shop.example.com'});
after(()=>{S.child.kill();rmSync(S.dir,{recursive:true,force:true});});

const cookieOf=r=>{const raw=r.headers.get('set-cookie')||'';const m=raw.match(/mid=[a-f0-9]+/);return m?m[0]:'';};

test('dashboard counts page views, unique visitors, product views, carts and orders',async()=>{
 // 同一个访客打开两次首页 → PV 2 / UV 1
 const first=await fetch(S.base+'/',{headers:{'User-Agent':'Mozilla/5.0 test'}});
 const mid=cookieOf(first);
 assert.ok(mid,'访问首页应下发访客 cookie');
 await first.text();
 await (await fetch(S.base+'/',{headers:{Cookie:mid}})).text();

 // 另一个访客
 const second=await fetch(S.base+'/',{headers:{Referer:'https://www.google.com/search?q=watches'}});
 const mid2=cookieOf(second);
 await second.text();

 // 商品浏览 / 加购埋点
 const track=(body,cookie)=>fetch(S.base+'/api/track',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie||mid},body:JSON.stringify(body)});
 assert.equal((await track({kind:'product',id:'p1'})).status,204);
 assert.equal((await track({kind:'product',id:'p1'})).status,204);
 assert.equal((await track({kind:'addcart',id:'p1'})).status,204);
 assert.equal((await track({kind:'product',id:'p2'},mid2)).status,204);
 assert.equal((await track({kind:'nonsense',id:'p1'})).status,204); // 静默忽略

 // 下单
 const order=await fetch(S.base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Alex',email:'alex@example.com',phone:'+1 202 555 0123',address:'Boston MA',country:'US',state:'MA',postalCode:'02108',items:[{id:'p1',quantity:2}]})});
 assert.equal(order.status,201);

 const login=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});
 const admin=login.headers.get('set-cookie').split(';')[0];

 const anon=await fetch(S.base+'/api/admin/analytics');
 assert.ok([401,403].includes(anon.status),'未登录不能读看板');

 const data=await (await fetch(S.base+'/api/admin/analytics?days=7',{headers:{Cookie:admin}})).json();
 assert.equal(data.today.pv,3);
 assert.equal(data.today.uv,2);
 assert.equal(data.today.addcarts,1);
 assert.equal(data.today.orders,1);
 assert.equal(data.series.length,7);
 const sources=Object.fromEntries(data.sources.map(s=>[s.source,s.pv]));
 assert.equal(sources.direct,2);
 assert.equal(sources.search,1);
 const p1=data.topProducts.find(p=>p.id==='p1');
 assert.equal(p1.views,2);
 assert.equal(p1.addcarts,1);
 assert.equal(p1.orders,1);
 assert.equal(p1.units,2);
 const p2=data.topProducts.find(p=>p.id==='p2');
 assert.equal(p2.views,1);

 const hourly=await (await fetch(S.base+'/api/admin/analytics?days=1&mode=hour',{headers:{Cookie:admin}})).json();
 assert.equal(hourly.hours.length,24);
 assert.equal(hourly.hours.reduce((a,h)=>a+h.pv,0),3);
});

import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

function start(env){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-hardening-'));
  const port=34000+Math.floor(Math.random()*10000);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}

const A=await start({PUBLIC_BASE_URL:'https://shop.example.com'});
const B=await start({ORDER_TTL_MINUTES:'0.02',SWEEP_INTERVAL_MS:'200'});
after(()=>{A.child.kill();B.child.kill();rmSync(A.dir,{recursive:true,force:true});rmSync(B.dir,{recursive:true,force:true});});

const call=async(base,path,{method='GET',body,headers={}}={})=>{
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 const type=r.headers.get('content-type')||'';
 return {status:r.status,headers:r.headers,text:await r.text(),json:async()=>JSON.parse(await r.text()),type};
};
async function login(base){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});return r.headers.get('set-cookie').split(';')[0];}

test('security headers and proxy-aware origin checks',async()=>{
 const page=await call(A.base,'/');
 assert.match(page.headers.get('content-security-policy')||'',/default-src 'self'/);
 assert.match(page.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
 assert.equal(page.headers.get('x-frame-options'),'DENY');
 assert.match(page.headers.get('permissions-policy')||'',/camera=\(\)/);
 assert.match(page.headers.get('strict-transport-security')||'',/max-age=/);

 // 反代场景：Host 与浏览器 Origin 不同，但 X-Forwarded-Host 与之匹配时应放行
 const viaProxy=await fetch(A.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://shop.example.com','X-Forwarded-Host':'shop.example.com','X-Forwarded-Proto':'https'},body:JSON.stringify({password:'wrong'})});
 assert.equal(viaProxy.status,401);
 // 跨站来源必须仍然拒绝
 const evil=await fetch(A.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.example'},body:JSON.stringify({password:'test-password'})});
 assert.equal(evil.status,403);
});

test('SEO: meta, Open Graph, JSON-LD, product page, robots and sitemap',async()=>{
 const home=await call(A.base,'/');
 assert.match(home.text,/<meta name="description" content="[^"]+">/);
 assert.match(home.text,/property="og:title"/);
 assert.match(home.text,/rel="canonical" href="https:\/\/shop\.example\.com\/"/);
 assert.match(home.text,/"@type":"Store"/);
 assert.match(home.text,/"@type":"OfferCatalog"/);
 assert.match(home.text,/property="og:image" content="https:\/\/shop\.example\.com\/assets\/hero\.svg"/);

 const product=await call(A.base,'/?product=p1');
 assert.match(product.text,/<title>MERIDIAN/);
 assert.match(product.text,/"@type":"Product"/);
 assert.match(product.text,/"price":"189"/);
 assert.match(product.text,/rel="canonical" href="https:\/\/shop\.example\.com\/\?product=p1"/);

 const robots=await call(A.base,'/robots.txt');
 assert.equal(robots.status,200);
 assert.match(robots.text,/Sitemap: https:\/\/shop\.example\.com\/sitemap\.xml/);
 assert.match(robots.text,/Disallow: \/admin/);

 const sitemap=await call(A.base,'/sitemap.xml');
 assert.equal(sitemap.status,200);
 assert.match(sitemap.text,/<loc>https:\/\/shop\.example\.com\/<\/loc>/);
 assert.match(sitemap.text,/<loc>https:\/\/shop\.example\.com\/\?product=p1<\/loc>/);
});

test('image upload: admin only, magic-byte validation, cacheable serving',async()=>{
 assert.equal((await call(A.base,'/api/admin/uploads',{method:'POST',body:{data:PNG.toString('base64')}})).status,401);
 const cookie=await login(A.base);
 const up=await fetch(A.base+'/api/admin/uploads',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({data:PNG.toString('base64')})});
 assert.equal(up.status,201);
 const {url}=await up.json();
 assert.match(url,/^\/uploads\/[a-f0-9]{32}\.png$/);

 const img=await fetch(A.base+url);
 assert.equal(img.status,200);
 assert.equal(img.headers.get('content-type'),'image/png');
 assert.match(img.headers.get('cache-control')||'',/immutable/);
 assert.equal(Buffer.from(await img.arrayBuffer()).length,PNG.length);

 const svg=await fetch(A.base+'/api/admin/uploads',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({data:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')})});
 assert.equal(svg.status,400);

 const draft=await (await fetch(A.base+'/api/admin/content',{headers:{Cookie:cookie}})).json();
 draft.products[0].image=url;
 const saved=await fetch(A.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(draft)});
 assert.equal(saved.status,200);
});

test('unpaid orders expire and release stock, but submitted payments are kept',async()=>{
 const customer={name:'Alex',email:'alex@example.com',phone:'+1 202 555 0123',address:'Boston MA',country:'US',postalCode:'02108'};
 const before=(await (await fetch(B.base+'/api/store')).json()).products.find(p=>p.id==='p1').stock;
 const order=await (await fetch(B.base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...customer,items:[{id:'p1',quantity:2}]})})).json();
 assert.equal((await (await fetch(B.base+'/api/store')).json()).products.find(p=>p.id==='p1').stock,before-2);

 await new Promise(r=>setTimeout(r,1200));
 const afterSweep=(await (await fetch(B.base+'/api/store')).json()).products.find(p=>p.id==='p1').stock;
 assert.equal(afterSweep,before);

 const cookie=await login(B.base);
 const rows=await (await fetch(B.base+'/api/admin/orders',{headers:{Cookie:cookie}})).json();
 assert.match(rows.find(x=>x.id===order.id).details.status,/Expired/);

 // USDT 已提交哈希的订单不自动释放
 const keep=await (await fetch(B.base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...customer,items:[{id:'p2',quantity:1}]})})).json();
 await fetch(B.base+'/api/admin/payments',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({paypalEnabled:false,paypalMode:'sandbox',usdtEnabled:true,usdtNetwork:'erc20',usdtAddress:'0x'+'1'.repeat(40),usdtRate:1})});
 await fetch(B.base+'/api/orders/'+keep.id+'/payment',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+keep.accessToken},body:JSON.stringify({provider:'usdt'})});
 await fetch(B.base+'/api/orders/'+keep.id+'/transaction',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+keep.accessToken},body:JSON.stringify({transactionId:'c'.repeat(64)})});
 await new Promise(r=>setTimeout(r,1200));
 const rows2=await (await fetch(B.base+'/api/admin/orders',{headers:{Cookie:cookie}})).json();
 assert.match(rows2.find(x=>x.id===keep.id).details.status,/Awaiting/);
});

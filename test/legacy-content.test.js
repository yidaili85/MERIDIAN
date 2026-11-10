import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// 旧版本数据库：商品没有 badge / specs / images，整份内容没有 pages。
// 升级后必须能正常保存、发布，并且政策页能打开。
const legacy={
 brand:'MERIDIAN',accent:'#303c38',heroImage:'/assets/hero.svg',
 title:'Time, exceptionally yours.',subtitle:'x',eyebrow:'PRECISION',announcement:'x',
 promise1:'a',promise2:'b',promise3:'c',
 closingTitle:'x',closingText:'y',closingLink:'z',footer:'f',
 translations:{de:{},es:{}},
 categories:[{id:'watches',name:'Watches'}],
 sections:[{id:'s1',type:'text',title:'t',text:'x',visible:true}],
 products:[{id:'p1',name:'Old watch',price:100,stock:4,category:'watches',active:true,description:'legacy product',image:'https://example.com/old.jpg'}]
};

let S;
const dir=mkdtempSync(join(tmpdir(),'meridian-legacy-'));
{
 const db=new DatabaseSync(join(dir,'store.sqlite'));
 db.exec('CREATE TABLE content (id INTEGER PRIMARY KEY, draft TEXT NOT NULL, published TEXT NOT NULL);');
 const payload=JSON.stringify(legacy);
 db.prepare('INSERT INTO content VALUES (1,?,?)').run(payload,payload);
 db.close();
}
function start(){
 return new Promise((resolve,reject)=>{
  const port=46000+Math.floor(Math.random()*1000);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'legacy-pass-123',PUBLIC_BASE_URL:'https://shop.example.com'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
S=await start();
after(()=>{S.child.kill();rmSync(dir,{recursive:true,force:true});});

test('legacy content is upgraded in place: defaults filled, publish accepted',async()=>{
 const login=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'legacy-pass-123'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];

 const res=await fetch(S.base+'/api/admin/content',{headers:{Cookie:cookie}});
 assert.equal(res.status,200);
 const c=await res.json();

 // 旧库缺的键必须补上，否则后台保存会被校验拒绝
 assert.ok(Array.isArray(c.pages)&&c.pages.length>0,'policy pages defaulted');
 assert.ok(Array.isArray(c.categories));
 const p=c.products.find(x=>x.id==='p1');
 assert.equal(p.badge,'');
 assert.deepEqual(p.specs,{});
 assert.deepEqual(p.images,['https://example.com/old.jpg']);

 // 原样回写 + 追加分类商品 + 发布，全部成功
 c.categories.push({id:'legacy-cat',name:'Legacy cat'});
 c.products.push({id:'p2',name:'New watch',price:120,stock:2,category:'legacy-cat',active:true,description:'d',image:'https://example.com/new.jpg'});
 const put=await fetch(S.base+'/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(c)});
 assert.equal(put.status,200,await put.text());
 const pub=await fetch(S.base+'/api/admin/publish',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{}'});
 assert.equal(pub.status,200);
});

test('policy pages render on an upgraded legacy database',async()=>{
 assert.equal((await fetch(S.base+'/privacy')).status,200);
 assert.equal((await fetch(S.base+'/returns')).status,200);
});

import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const stubSent=[];
const stub=http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{stubSent.push({url:req.url,auth:req.headers.authorization||'',body:b});res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');});});
await new Promise(r=>stub.listen(0,'127.0.0.1',r));
const stubPort=stub.address().port;

function start(env){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-mailcfg-'));
  const port=39500+Math.floor(Math.random()*400);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
const S=await start({});
after(()=>{S.child.kill();stub.close();rmSync(S.dir,{recursive:true,force:true});});

const login=async()=>{
 const r=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});
 return r.headers.get('set-cookie').split(';')[0];
};
const put=(cookie,body)=>fetch(S.base+'/api/admin/mail',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});

test('mail settings are editable from the admin API and never leak the key',async()=>{
 const cookie=await login();

 const initial=await (await fetch(S.base+'/api/admin/mail',{headers:{Cookie:cookie}})).json();
 assert.equal(initial.enabled,false);
 assert.equal(initial.apiKeySet,false);
 assert.equal(initial.source,'none');

 assert.equal((await put(cookie,{provider:'carrier-pigeon'})).status,400);
 assert.equal((await put(cookie,{provider:'generic',from:'orders@example.com'})).status,400); // 缺接口地址
 assert.equal((await put(cookie,{provider:'resend',from:'not-an-email'})).status,400);
 assert.equal((await put(cookie,{provider:'resend',from:'orders@example.com',notifyEmail:'broken'})).status,400);

 const saved=await put(cookie,{provider:'generic',apiKey:'secret-key-1234',from:'orders@example.com',fromName:'MERIDIAN',apiUrl:`http://127.0.0.1:${stubPort}/send`,notifyEmail:'owner@example.com, ops@example.com',whatsapp:'+8613800000000'});
 assert.equal(saved.status,200);
 const view=await saved.json();
 assert.equal(view.enabled,true);
 assert.equal(view.apiKeySet,true);
 assert.equal(view.apiKeyHint,'••••1234');
 assert.equal(view.source,'db');
 assert.equal(JSON.stringify(view).includes('secret-key-1234'),false);
 assert.deepEqual(view.notify,['owner@example.com','ops@example.com']);

 const test1=await fetch(S.base+'/api/admin/mail/test',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({to:'buyer@example.com'})});
 assert.equal(test1.status,200);
 assert.equal(stubSent.length,1);
 assert.equal(stubSent[0].url,'/send');
 assert.match(stubSent[0].auth,/secret-key-1234/);
 assert.match(stubSent[0].body,/buyer@example\.com/);

 // 留空 API Key 表示沿用旧值
 const again=await put(cookie,{provider:'generic',from:'orders@example.com',apiUrl:`http://127.0.0.1:${stubPort}/send`});
 assert.equal(again.status,200);
 assert.equal((await again.json()).apiKeySet,true);
});

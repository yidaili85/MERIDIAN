import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function start(env){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-auth-'));
  const port=44000+Math.floor(Math.random()*2000);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'initial-pass-123',...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
const S=await start({});
after(()=>{S.child.kill();rmSync(S.dir,{recursive:true,force:true});});

const login=async(body)=>fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const cookieOf=(r)=>(r.headers.get('set-cookie')||'').split(';')[0];

test('session lasts 8 hours by default, 30 days with remember',async()=>{
 const plain=await login({password:'initial-pass-123'});
 assert.equal(plain.status,200);
 assert.match(plain.headers.get('set-cookie'),/Max-Age=28800\b/);

 const remember=await login({password:'initial-pass-123',remember:true});
 assert.equal(remember.status,200);
 assert.match(remember.headers.get('set-cookie'),/Max-Age=2592000\b/);
});

test('wrong password still rejected',async()=>{
 assert.equal((await login({password:'nope-nope-nope'})).status,401);
});

test('password can be changed from the admin API and old one stops working',async()=>{
 const cookie=cookieOf(await login({password:'initial-pass-123'}));
 const acct=await (await fetch(S.base+'/api/admin/account',{headers:{Cookie:cookie}})).json();
 assert.equal(acct.passwordSource,'env');
 assert.equal(acct.sessionHours,8);

 const weak=await fetch(S.base+'/api/admin/password',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({current:'initial-pass-123',next:'short'})});
 assert.equal(weak.status,400);

 const wrongCurrent=await fetch(S.base+'/api/admin/password',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({current:'bad-current-pass',next:'another-long-pass'})});
 assert.equal(wrongCurrent.status,400);

 const ok=await fetch(S.base+'/api/admin/password',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({current:'initial-pass-123',next:'new-strong-pass-2026'})});
 assert.equal(ok.status,200);

 assert.equal((await login({password:'initial-pass-123'})).status,401);
 assert.equal((await login({password:'new-strong-pass-2026'})).status,200);

 // 改密码后旧会话全部作废
 assert.equal((await fetch(S.base+'/api/admin/account',{headers:{Cookie:cookie}})).status,401);

 const again=await (await fetch(S.base+'/api/admin/account',{headers:{Cookie:cookieOf(await login({password:'new-strong-pass-2026'}))}})).json();
 assert.equal(again.passwordSource,'database');
});

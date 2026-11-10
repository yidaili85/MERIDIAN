import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createMailer,orderEmail} from '../mailer.js';

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

function start(env){
 return new Promise((resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-mail-'));
  const port=36000+Math.floor(Math.random()*8000);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}

// 本地邮件接收器，模拟 Resend 兼容端点
const received=[];
let failNext=false;
const mock=http.createServer((req,res)=>{
 let body='';
 req.on('data',c=>body+=c);
 req.on('end',()=>{
  if(failNext)return res.writeHead(500).end('boom');
  received.push({auth:req.headers.authorization,payload:JSON.parse(body||'{}')});
  res.writeHead(200,{'Content-Type':'application/json'}).end('{"id":"mock"}');
 });
});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const mockUrl='http://127.0.0.1:'+mock.address().port+'/emails';

const mailEnv={MAIL_PROVIDER:'generic',MAIL_API_URL:mockUrl,MAIL_API_KEY:'test-key',MAIL_FROM:'orders@shop.example.com',MAIL_FROM_NAME:'MERIDIAN',ORDER_NOTIFY_EMAIL:'owner@shop.example.com',PUBLIC_BASE_URL:'https://shop.example.com'};
const C=await start(mailEnv);
const D=await start({PUBLIC_BASE_URL:'https://shop.example.com'});
after(()=>{C.child.kill();D.child.kill();mock.close();rmSync(C.dir,{recursive:true,force:true});rmSync(D.dir,{recursive:true,force:true});});

const customer={name:'Alex Doe',email:'alex@example.com',phone:'+1 202 555 0123',address:'12 Beacon St',country:'US',state:'MA',postalCode:'02108'};
const order=async(base,items=[{id:'p1',quantity:1}])=>{
 const r=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...customer,items})});
 return {status:r.status,body:await r.json()};
};
const login=async(base)=>(await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})})).headers.get('set-cookie').split(';')[0];
const wait=async(fn,ms=4000)=>{const t=Date.now();while(Date.now()-t<ms){if(await fn())return true;await new Promise(r=>setTimeout(r,100));}return false;};

test('mailer payloads match provider APIs',async()=>{
 const calls=[];
 const fake=async(url,init)=>{calls.push({url,init});return new Response('{"ok":true}',{status:200});};
 const base={MAIL_API_KEY:'k',MAIL_FROM:'shop@example.com',MAIL_FROM_NAME:'Shop'};
 for(const provider of ['resend','postmark','sendgrid']){
  const m=createMailer({...base,MAIL_PROVIDER:provider},fake);
  assert.equal(m.enabled,true);
  await m.send({to:'a@b.co',subject:'S',html:'<b>h</b>',text:'t'});
 }
 const resend=JSON.parse(calls[0].init.body);
 assert.equal(calls[0].url,'https://api.resend.com/emails');
 assert.deepEqual(resend.to,['a@b.co']);
 assert.equal(calls[0].init.headers.Authorization,'Bearer k');
 const postmark=JSON.parse(calls[1].init.body);
 assert.equal(calls[1].url,'https://api.postmarkapp.com/email');
 assert.equal(postmark.To,'a@b.co');
 assert.equal(calls[1].init.headers['X-Postmark-Server-Token'],'k');
 const sendgrid=JSON.parse(calls[2].init.body);
 assert.equal(sendgrid.personalizations[0].to[0].email,'a@b.co');
 assert.equal(sendgrid.from.email,'shop@example.com');
 assert.equal(sendgrid.content[0].value,'t');

 const off=createMailer({MAIL_PROVIDER:'resend'},fake);
 assert.equal(off.enabled,false);
 await assert.rejects(()=>off.send({to:'a@b.co'}),/未配置/);
 const badAddr=createMailer({...base,MAIL_PROVIDER:'resend'},fake);
 await assert.rejects(()=>badAddr.send({to:'nope'}),/收件地址无效/);
});

test('order email: html escaping, totals and payment link',()=>{
 const msg=orderEmail({order:{id:'MY1',details:{items:[{name:'<script>x</script>',price:19.5,quantity:2}],total:51,shipping:12,name:'A & B',address:'St 1',postalCode:'1',country:'US',phone:'+1'}},accessToken:'tok',brand:'MERIDIAN',siteUrl:'https://shop.example.com'});
 assert.match(msg.html,/&lt;script&gt;/);
 assert.doesNotMatch(msg.html,/<script>x<\/script>/);
 assert.match(msg.html,/\$39\.00/);
 assert.match(msg.html,/\$51\.00/);
 assert.match(msg.html,/https:\/\/shop\.example\.com\/\?order=MY1&token=tok/);
 assert.match(msg.text,/MY1/);
});

test('customer and owner receive order email, status recorded',async()=>{
 received.length=0;failNext=false;
 const created=await order(C.base);
 assert.equal(created.status,201);
 const ok=await wait(()=>received.length>=2);
 assert.equal(ok,true,'email not sent');
 const tos=received.map(r=>r.payload.to).sort();
 assert.deepEqual(tos,['alex@example.com','owner@shop.example.com']);
 const mail=received[0].payload;
 assert.match(mail.subject,/MY/);
 assert.match(mail.html,/The Classic/);
 assert.match(mail.html,/https:\/\/shop\.example\.com\/\?order=/);
 assert.equal(received[0].auth,'Bearer test-key');

 const cookie=await login(C.base);
 const readRow=async(base,id)=>{const c=await login(base);const rows=await (await fetch(base+'/api/admin/orders',{headers:{Cookie:c}})).json();return rows.find(r=>r.id===id);};
 assert.equal(await wait(async()=>(await readRow(C.base,created.body.id)).details.mail?.status==='sent'),true);
});

test('failed email does not break checkout, unconfigured stays disabled',async()=>{
 failNext=true;
 const created=await order(C.base);
 assert.equal(created.status,201);
 const readRow=async(base,id)=>{const c=await login(base);const rows=await (await fetch(base+'/api/admin/orders',{headers:{Cookie:c}})).json();return rows.find(r=>r.id===id);};
 assert.equal(await wait(async()=>(await readRow(C.base,created.body.id)).details.mail?.status==='failed'),true);
 failNext=false;

 const plain=await order(D.base);
 assert.equal(plain.status,201);
 const plainCookie=await login(D.base);
 const plainRows=await (await fetch(D.base+'/api/admin/orders',{headers:{Cookie:plainCookie}})).json();
 assert.equal(plainRows.find(r=>r.id===plain.body.id).details.mail.status,'disabled');

 const status=await (await fetch(D.base+'/api/admin/mail',{headers:{Cookie:plainCookie}})).json();
 assert.equal(status.enabled,false);
 const test=await fetch(D.base+'/api/admin/mail/test',{method:'POST',headers:{'Content-Type':'application/json',Cookie:plainCookie},body:JSON.stringify({to:'a@b.co'})});
 assert.equal(test.status,400);
});

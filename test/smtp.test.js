import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requiresStartTLS,smtpSend} from '../smtp.js';
import {createMailer} from '../mailer.js';

// 极简假 SMTP 服务：AUTH LOGIN + DATA 抓取
const received=[];
const smtp=net.createServer((sock)=>{
 sock.setEncoding('utf8');
 let buf='', inData=false, dataLines=[], authed=false, stage='greet', user='';
 sock.write('220 fake.smtp ESMTP ready\r\n');
 sock.on('data',(chunk)=>{
  buf+=chunk;
  for(;;){
   const nl=buf.indexOf('\r\n');
   if(nl<0)break;
   const line=buf.slice(0,nl); buf=buf.slice(nl+2);
   if(inData){
    if(line==='.'){inData=false;received.push({user,data:dataLines.join('\r\n')});dataLines=[];sock.write('250 2.0.0 queued\r\n');}
    else dataLines.push(line.startsWith('..')?line.slice(1):line);
    continue;
   }
   if(stage==='auth-user'){user=Buffer.from(line,'base64').toString();stage='auth-pass';sock.write('334 UGFzc3dvcmQ6\r\n');continue;}
   if(stage==='auth-pass'){const pass=Buffer.from(line,'base64').toString();authed=pass==='mailpass';stage='';sock.write(authed?'235 2.7.0 authenticated\r\n':'535 5.7.8 bad credentials\r\n');continue;}
   const cmd=line.split(' ')[0].toUpperCase();
   if(cmd==='EHLO'){sock.write('250-fake.smtp\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 10485760\r\n');continue;}
   if(cmd==='AUTH'){stage='auth-user';sock.write('334 VXNlcm5hbWU6\r\n');continue;}
   if(cmd==='MAIL'){sock.write(authed?'250 2.1.0 ok\r\n':'530 5.7.0 auth required\r\n');continue;}
   if(cmd==='RCPT'){sock.write('250 2.1.5 ok\r\n');continue;}
   if(cmd==='DATA'){inData=true;sock.write('354 End data with <CR><LF>.<CR><LF>\r\n');continue;}
   if(cmd==='QUIT'){sock.write('221 bye\r\n');sock.end();continue;}
   sock.write('250 ok\r\n');
  }
 });
});
await new Promise(r=>smtp.listen(0,'127.0.0.1',r));
const smtpPort=smtp.address().port;

function freePort(){
 return new Promise((resolve,reject)=>{
  const probe=net.createServer();
  probe.once('error',reject);
  probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p));});
 });
}
function startServer(env){
 return new Promise(async(resolve,reject)=>{
  const dir=mkdtempSync(join(tmpdir(),'meridian-smtp-'));
  const port=await freePort();
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',...env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{if(x.toString().includes(String(port)))resolve({child,dir,base:`http://127.0.0.1:${port}`});});
  child.stderr.on('data',x=>{if(!/ExperimentalWarning|trace-warnings/.test(x.toString()))reject(Error(x));});
  child.on('exit',c=>reject(Error('Exited '+c)));
  setTimeout(()=>reject(Error('Startup timed out')),10000).unref();
 });
}
async function startWithRetry(attempts=3){
 let last;
 for(let i=0;i<attempts;i++){
  try{return await startServer({});}catch(e){last=e;await new Promise(r=>setTimeout(r,400));}
 }
 throw last;
}
const S=await startWithRetry();
after(()=>{S.child.kill();smtp.close();rmSync(S.dir,{recursive:true,force:true});});

test('authenticated remote SMTP requires TLS unless explicitly overridden',()=>{
 assert.equal(requiresStartTLS({host:'smtp.example.com',secure:false,user:'orders@example.com',allowInsecure:false}),true);
 assert.equal(requiresStartTLS({host:'127.0.0.1',secure:false,user:'orders@example.com',allowInsecure:false}),false);
 assert.equal(requiresStartTLS({host:'smtp.example.com',secure:true,user:'orders@example.com',allowInsecure:false}),false);
 assert.equal(requiresStartTLS({host:'smtp.example.com',secure:false,user:'orders@example.com',allowInsecure:true}),false);
});

test('smtpSend delivers a multipart message over AUTH LOGIN',async()=>{
 await smtpSend({host:'127.0.0.1',port:smtpPort,user:'orders@example.com',pass:'mailpass',from:'orders@example.com',fromName:'MERIDIAN',to:'buyer@example.com',subject:'Order MY123',text:'plain body',html:'<b>html body</b>'});
 const mail=received.at(-1);
 assert.equal(mail.user,'orders@example.com');
 assert.match(mail.data,/Subject: Order MY123/);
 assert.match(mail.data,/multipart\/alternative/);
 assert.match(mail.data,/Content-Transfer-Encoding: base64/);
 assert.ok(mail.data.includes(Buffer.from('<b>html body</b>').toString('base64')));
});

test('wrong SMTP password is reported, not silently ignored',async()=>{
 await assert.rejects(()=>smtpSend({host:'127.0.0.1',port:smtpPort,user:'orders@example.com',pass:'wrong',from:'orders@example.com',to:'buyer@example.com',subject:'x',text:'x',html:'x'}),/SMTP 登录失败|535/);
});

test('mailer exposes smtp provider and sends',async()=>{
 const mailer=createMailer({MAIL_PROVIDER:'smtp',MAIL_SMTP_HOST:'127.0.0.1',MAIL_SMTP_PORT:String(smtpPort),MAIL_SMTP_USER:'orders@example.com',MAIL_SMTP_PASS:'mailpass',MAIL_FROM:'orders@example.com',MAIL_FROM_NAME:'MERIDIAN'});
 assert.equal(mailer.enabled,true);
 await mailer.send({to:'buyer@example.com',subject:'Hi',html:'<p>hi</p>',text:'hi'});
 assert.match(received.at(-1).data,/Subject: Hi/);
 const off=createMailer({MAIL_PROVIDER:'smtp',MAIL_FROM:'orders@example.com'});
 assert.equal(off.enabled,false);
});

test('admin can switch to SMTP from the UI API and send a test mail',async()=>{
 const login=await fetch(S.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const put=body=>fetch(S.base+'/api/admin/mail',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});

 assert.equal((await put({provider:'smtp',from:'orders@example.com'})).status,400); // 缺 host
 assert.equal((await put({provider:'smtp',from:'orders@example.com',smtpHost:'127.0.0.1',smtpPort:'abc'})).status,400);

 const saved=await put({provider:'smtp',from:'orders@example.com',fromName:'MERIDIAN',smtpHost:'127.0.0.1',smtpPort:String(smtpPort),smtpSecure:false,smtpUser:'orders@example.com',smtpPass:'mailpass',notifyEmail:'owner@example.com'});
 assert.equal(saved.status,200);
 const view=await saved.json();
 assert.equal(view.provider,'smtp');
 assert.equal(view.enabled,true);
 assert.equal(view.smtpPassSet,true);
 assert.equal(JSON.stringify(view).includes('mailpass'),false);
 assert.equal(view.smtpHost,'127.0.0.1');

 const before=received.length;
 const sent=await fetch(S.base+'/api/admin/mail/test',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({to:'buyer@example.com'})});
 assert.equal(sent.status,200);
 assert.equal(received.length,before+1);
 assert.match(received.at(-1).data,/Subject:/);
});

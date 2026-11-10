import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,statSync,mkdirSync,copyFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
const source=resolve('.');
function command(args){return new Promise((resolve,reject)=>{const p=spawn('bash',args,{env:{...process.env,MERIDIAN_INSTALLER_NESTED:'1'},stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',reject);p.on('close',code=>code===0?resolve(out):reject(Error(out)));});}
async function freePort(){const server=net.createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});const port=server.address().port;await new Promise(r=>server.close(r));return port;}
// Installer runs the repository tests too. Avoid recursively invoking itself.
const skip=process.env.MERIDIAN_INSTALLER_NESTED==='1'||process.getuid?.()===0||process.platform!=='linux';
test('installer starts HTTP service, preserves config/orders on reinstall and stops only its own process',{skip,timeout:120000},async()=>{
 const temp=mkdtempSync(join(tmpdir(),'meridian-install-test-')),base=join(temp,'installation'),input=join(temp,'source');let manager;
 try{
  // Model the clean application checkout to avoid copying local customer data.
  mkdirSync(input);for(const f of ['install.sh','package.json','server.js','payments.js','mailer.js','README.md','.env.example'])copyFileSync(join(source,f),join(input,f));
  for(const d of ['public','scripts','test'])cpSync(join(source,d),join(input,d),{recursive:true});
  writeFileSync(join(input,'.env'),'SHOULD_NOT_COPY=1\n');mkdirSync(join(input,'data'));writeFileSync(join(input,'data','private.txt'),'do not copy');
  const output=await command([join(input,'install.sh'),'--source',input,'--dir',base,'--no-start']);
  const configPath=join(base,'shared','config.env'),config=readFileSync(configPath,'utf8');
  assert.equal(statSync(configPath).mode&0o777,0o600);
  const password=config.match(/^ADMIN_PASSWORD=(.+)$/m)[1];assert.ok(password.length>=24);assert.ok(!output.includes(password));
  assert.equal(existsSync(join(base,'current','.env')),false);assert.equal(existsSync(join(base,'shared','data','private.txt')),false);
  const port=await freePort();writeFileSync(configPath,config.replace('PORT=3000','PORT='+port));
  manager=join(base,'bin','meridian');await command([manager,'start']);const url='http://127.0.0.1:'+port;
  const c={name:'Installer test',email:'test@example.com',phone:'+12025550123',country:'US',postalCode:'02108',address:'Test address',items:[{id:'p1',quantity:1}]};
  const r=await fetch(url+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)});assert.equal(r.status,201);const order=await r.json();
  const before=readFileSync(configPath,'utf8');
  await command([join(input,'install.sh'),'--source',input,'--dir',base]);
  assert.equal(readFileSync(configPath,'utf8'),before);
  const state=await fetch(url+'/api/orders/'+order.id+'/payment',{headers:{Authorization:'Bearer '+order.accessToken}});assert.equal(state.status,200);assert.equal((await state.json()).id,order.id);
  const products=await(await fetch(url+'/api/store')).json();assert.equal(products.products[0].stock,29);
  await command([manager,'start']); // idempotent start
  const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  try{await command([manager,'stop']);writeFileSync(join(base,'shared','server.pid'),String(sentinel.pid));await command([manager,'stop']);assert.ok(process.kill(sentinel.pid,0));}finally{sentinel.kill();}
  assert.ok(existsSync(join(base,'shared','data','store.sqlite')));
 }finally{if(manager)await command([manager,'stop']).catch(()=>{});rmSync(temp,{recursive:true,force:true});}
});

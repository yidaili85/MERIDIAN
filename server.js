import {defaults, digest, readiness, methods, validateConfig, createCheckout, capturePayPal, verifyPayPalWebhook, transactionHash} from './payments.js';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual, scryptSync, createHash } from 'node:crypto';
import { createMailer, orderEmail } from './mailer.js';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
const dir = process.env.DATA_DIR || './data'; mkdirSync(dir,{recursive:true});
const uploadDir = resolve(dir,'uploads'); mkdirSync(uploadDir,{recursive:true});
// 公网地址：只接受纯 HTTPS 源，用于 canonical / OG / sitemap
const publicBase=(()=>{if(!process.env.PUBLIC_BASE_URL)return '';try{const u=new URL(process.env.PUBLIC_BASE_URL);return u.protocol==='https:'&&u.pathname==='/'?u.origin:''}catch{return ''}})();
// 未支付订单保留时长（分钟），0 表示关闭自动释放库存
const orderTTL=Math.max(0,Number(process.env.ORDER_TTL_MINUTES??30))*60000;
const MAIL_FIELDS=['provider','apiKey','from','fromName','apiUrl','notifyEmail','whatsapp'];
function mailSettings(){
 let saved={};
 try{const row=db.prepare('SELECT value FROM mail_config WHERE id=1').get();if(row)saved=JSON.parse(row.value)||{};}catch{}
 const env=process.env;
 const pick=(dbKey,envKey,fallback='')=>{const v=saved[dbKey];return (typeof v==='string'&&v.trim())?v.trim():(env[envKey]||fallback);};
 const settings={
  provider:pick('provider','MAIL_PROVIDER','smtp').toLowerCase(),
  apiKey:pick('apiKey','MAIL_API_KEY',''),
  from:pick('from','MAIL_FROM',''),
  fromName:pick('fromName','MAIL_FROM_NAME','MERIDIAN'),
  apiUrl:pick('apiUrl','MAIL_API_URL',''),
  notifyEmail:pick('notifyEmail','ORDER_NOTIFY_EMAIL',''),
  whatsapp:pick('whatsapp','WHATSAPP_NUMBER',''),
  smtpHost:pick('smtpHost','MAIL_SMTP_HOST',''),
  smtpPort:pick('smtpPort','MAIL_SMTP_PORT','587'),
  smtpSecure:pick('smtpSecure','MAIL_SMTP_SECURE','false'),
  smtpUser:pick('smtpUser','MAIL_SMTP_USER',''),
  smtpPass:pick('smtpPass','MAIL_SMTP_PASS',''),
  source:Object.keys(saved).length?'db':((env.MAIL_API_KEY||env.MAIL_SMTP_HOST)?'env':'none')
 };
 return settings;
}
function mailEnv(settings){return {...process.env,MAIL_PROVIDER:settings.provider,MAIL_API_KEY:settings.apiKey,MAIL_FROM:settings.from,MAIL_FROM_NAME:settings.fromName,MAIL_API_URL:settings.apiUrl,ORDER_NOTIFY_EMAIL:settings.notifyEmail,WHATSAPP_NUMBER:settings.whatsapp,MAIL_SMTP_HOST:settings.smtpHost,MAIL_SMTP_PORT:settings.smtpPort,MAIL_SMTP_SECURE:settings.smtpSecure,MAIL_SMTP_USER:settings.smtpUser,MAIL_SMTP_PASS:settings.smtpPass};}
function visitorId(req,res){
 const raw=String(req.headers.cookie||'');
 const m=raw.match(/(?:^|;\s*)mid=([a-f0-9]{16,64})/);
 if(m)return m[1];
 const id=randomBytes(16).toString('hex');
 const cookie=`mid=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${process.env.COOKIE_SECURE==='true'?'; Secure':''}`;
 const prev=res.getHeader('Set-Cookie');
 res.setHeader('Set-Cookie',prev?[].concat(prev,cookie):cookie);
 return id;
}
function sourceOf(req){
 const ref=String(req.headers.referer||req.headers.referrer||'');
 let host='';
 try{host=new URL(ref).hostname.replace(/^www\./,'').toLowerCase();}catch{return 'direct';}
 const self=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim().split(':')[0].replace(/^www\./,'').toLowerCase();
 if(!host||host===self)return 'direct';
 if(/(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave|qwant)\.[a-z.]+$/.test(host))return 'search';
 if(/(^|\.)(instagram|facebook|fb|tiktok|youtube|youtu|twitter|x|pinterest|reddit|linkedin|t\.co)\.[a-z.]+$/.test(host))return 'social';
 if(/(^|\.)(mail|email|outlook|gmail|qq|163|126)\.[a-z.]+$/.test(host))return 'email';
 return 'referral';
}
function trackEvent(kind,{ref='',vid='',source=''}={}){
 const d=new Date();
 db.prepare('INSERT INTO events (ts,day,hour,kind,ref,vid,source) VALUES (?,?,?,?,?,?,?)')
  .run(d.toISOString(),d.toISOString().slice(0,10),d.getUTCHours(),String(kind).slice(0,24),String(ref).slice(0,64),String(vid).slice(0,64),String(source).slice(0,32));
}
const dayKey=(offset=0)=>{const d=new Date(Date.now()+offset*86400000);return d.toISOString().slice(0,10);};
const currentMailer=()=>createMailer(mailEnv(mailSettings()));
const mailView=()=>{const m=currentMailer(),st=mailSettings();return{enabled:m.enabled,provider:m.provider||st.provider,from:m.from||st.from,apiKeySet:Boolean(st.apiKey),apiKeyHint:st.apiKey?('••••'+st.apiKey.slice(-4)):'',fromName:st.fromName,apiUrl:st.apiUrl,notify:String(st.notifyEmail||'').split(',').map(x=>x.trim()).filter(Boolean),whatsapp:st.whatsapp,smtpHost:st.smtpHost,smtpPort:st.smtpPort,smtpSecure:String(st.smtpSecure)==='true',smtpUser:st.smtpUser,smtpPassSet:Boolean(st.smtpPass),source:st.source};};
const db = new DatabaseSync(resolve(dir,'store.sqlite'));
db.exec("CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, pass TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'normal', created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS customer_sessions (token TEXT PRIMARY KEY, customer_id TEXT NOT NULL, expires INTEGER NOT NULL);");
const LEVELS=['normal','vip'];
const ACCESS_LEVELS=['all','normal','vip'];
const levelRank={normal:1,vip:2};
const ACCESS_RANK={all:0,normal:1,vip:2};
const stricterAccess=(a,b)=>(ACCESS_RANK[a]??0)>=(ACCESS_RANK[b]??0)?(a||'all'):(b||'all');
const categoryAccessMap=(content_)=>new Map((content_.categories||[]).map(c=>[c.id,ACCESS_LEVELS.includes(c.access)?c.access:'all']));
const effectiveAccess=(product,map)=>stricterAccess(ACCESS_LEVELS.includes(product.access)?product.access:'all',map.get(product.category)||'all');
const hashPass=(pw)=>{const salt=randomBytes(16);return salt.toString('hex')+':'+scryptSync(pw,salt,64).toString('hex');};
const checkPass=(pw,stored)=>{const [saltHex,hashHex]=String(stored||'').split(':');if(!saltHex||!hashHex)return false;try{return timingSafeEqual(scryptSync(pw,Buffer.from(saltHex,'hex'),64),Buffer.from(hashHex,'hex'));}catch{return false;}};
const canView=(access,viewer)=>{const a=ACCESS_LEVELS.includes(access)?access:'all';if(a==='all')return true;if(!viewer)return false;return (levelRank[viewer.level]||0)>=(levelRank[a]||9);};
const customerFromReq=(req)=>{
 const token=(req.headers.cookie||'').match(/(?:^|;\s*)meridian_customer=([^;]+)/)?.[1];
 if(!token)return null;
 try{
  const row=db.prepare('SELECT c.id,c.email,c.name,c.level,s.expires FROM customer_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.token=?').get(digest(token));
  if(!row||row.expires<Date.now())return null;
  return {id:row.id,email:row.email,name:row.name,level:row.level};
 }catch{return null;}
};
function setCustomerCookie(res,id){
 const token=randomBytes(32).toString('hex');
 db.prepare('INSERT INTO customer_sessions VALUES (?,?,?)').run(digest(token),id,Date.now()+30*86400000);
 res.setHeader('Set-Cookie',`meridian_customer=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);
}
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY, draft TEXT NOT NULL, published TEXT NOT NULL); CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created TEXT NOT NULL, details TEXT NOT NULL);');
db.exec("CREATE TABLE IF NOT EXISTS events (ts TEXT NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', vid TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT ''); CREATE INDEX IF NOT EXISTS events_lookup ON events(day,kind);");
db.exec('CREATE TABLE IF NOT EXISTS mail_config (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
db.exec("CREATE TABLE IF NOT EXISTS payment_config (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS payments (order_id TEXT PRIMARY KEY, details TEXT NOT NULL); CREATE TABLE IF NOT EXISTS payment_receipts (network TEXT NOT NULL, tx_hash TEXT NOT NULL, order_id TEXT NOT NULL, UNIQUE(network,tx_hash)); CREATE TABLE IF NOT EXISTS order_access (order_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL);");
if(!db.prepare('SELECT id FROM payment_config WHERE id=1').get())db.prepare('INSERT INTO payment_config VALUES (1,?)').run(JSON.stringify(defaults));
const paymentConfig=()=>({...defaults,...JSON.parse(db.prepare('SELECT value FROM payment_config WHERE id=1').get().value)});
const getPayment=id=>{const row=db.prepare('SELECT details FROM payments WHERE order_id=?').get(id);return row?JSON.parse(row.details):null;};
const getOrder=id=>{const row=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!row)throw Error('Order not found');return {...row,details:JSON.parse(row.details)};};
const putPayment=(id,p)=>db.prepare('INSERT INTO payments VALUES (?,?) ON CONFLICT(order_id) DO UPDATE SET details=excluded.details').run(id,JSON.stringify(p));
const locks=new Set();
async function locked(id,work){if(locks.has(id))throw Error('Payment is being processed. Please retry.');locks.add(id);try{return await work();}finally{locks.delete(id);}}
function markPaid(id,transactionId){const p=getPayment(id);if(p.status==='paid')return;const o=getOrder(id);p.status='paid';p.transactionId=transactionId;p.paidAt=new Date().toISOString();o.details.status='Paid';db.exec('BEGIN');try{putPayment(id,p);db.prepare('UPDATE orders SET details=? WHERE id=?').run(JSON.stringify(o.details),id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
const PAYMENT_RULES_OFF=process.env.PAYMENT_RULES==='off';
const allowedProviders=(config,env,policy)=>{
 const m=methods(config,env);
 const list=Object.keys(m).filter(k=>k==='paypal'||k==='usdt').filter(k=>m[k]);
 if(PAYMENT_RULES_OFF||!policy)return list;
 return list.includes(policy)?[policy]:list;
};
const paymentView=p=>p?{provider:p.provider,mode:p.mode,status:p.status,amount:p.amount,currency:p.currency,network:p.network,transactionId:p.transactionId,paidAt:p.paidAt,url:p.url,address:p.address,usdtAmount:p.usdtAmount,rate:p.rate,submittedHash:p.submittedHash}:null;
const seed={closingTitle:'Make every moment yours.',closingText:'Your own rhythm. Your own signature.',closingLink:'Discover your next classic',footer:'Time well considered.',promise1:'Considered design',promise2:'Made for your everyday',promise3:'Complimentary shipping $150+',brand:'MERIDIAN',announcement:'Complimentary shipping on orders $150+ · Designed for every moment',title:'Time, exceptionally yours.',subtitle:'Considered watches and essential accessories. Designed to go beyond the everyday.',eyebrow:'PRECISION MEETS PERSONALITY',heroImage:'/assets/hero.svg',accent:'#303c38',translations:{de:{closingTitle:'Jeder Moment gehört Ihnen.',closingText:'Ihr Rhythmus. Ihr Stil.',closingLink:'Ihren nächsten Klassiker entdecken',footer:'Zeit, bewusst gestaltet.',promise1:'Durchdachtes Design',promise2:'Für Ihren Alltag',promise3:'Kostenloser Versand ab $150',announcement:'Kostenloser Versand ab $150 · Für jeden Moment',title:'Zeit. Auf Ihre Art.',subtitle:'Ausgewählte Uhren und unverzichtbare Accessoires. Für mehr als nur den Alltag.',eyebrow:'PRÄZISION TRIFFT PERSÖNLICHKEIT'},es:{closingTitle:'Haz tuyo cada momento.',closingText:'Tu ritmo. Tu estilo.',closingLink:'Descubre tu próximo clásico',footer:'El tiempo, bien pensado.',promise1:'Diseño cuidado',promise2:'Para tu día a día',promise3:'Envío gratuito a partir de $150',announcement:'Envío gratuito a partir de $150 · Para cada momento',title:'El tiempo, a tu manera.',subtitle:'Relojes y accesorios esenciales, elegidos con intención. Más allá de lo cotidiano.',eyebrow:'PRECISIÓN CON PERSONALIDAD'}},categories:[{id:'watches',name:'Watches',de:'Uhren',es:'Relojes'},{id:'straps',name:'Watch straps',de:'Armbänder',es:'Correas'},{id:'storage',name:'Cases & storage',de:'Etuis & Aufbewahrung',es:'Estuches'},{id:'care',name:'Tools & care',de:'Werkzeug & Pflege',es:'Herramientas y cuidado'}],sections:[{id:'intro',type:'text',title:'Every second, considered.',text:'Clean lines. Thoughtful details. Discover watches and accessories that make your time feel like your own.',visible:true,de:{title:'Jede Sekunde zählt.',text:'Klare Linien. Durchdachte Details. Entdecken Sie Uhren und Accessoires für Ihren eigenen Rhythmus.'},es:{title:'Cada segundo cuenta.',text:'Líneas limpias. Detalles cuidados. Descubre relojes y accesorios para vivir a tu propio ritmo.'}},{id:'collection',type:'products',title:'Find your next signature.',text:'The considered collection',visible:true,de:{title:'Finden Sie Ihren Stil.',text:'Die ausgewählte Kollektion'},es:{title:'Encuentra tu próximo clásico.',text:'Una colección con intención'}}],products:[{id:'p1',name:'The Classic — Silver',category:'watches',price:189,stock:30,image:'/assets/classic.svg',description:'A clean, understated silhouette for everyday wear. Sample product: confirm specifications with the merchant before ordering.',active:true,badge:'BESTSELLER',de:{name:'The Classic — Silber',description:'Eine klare, dezente Silhouette für jeden Tag. Musterprodukt: Spezifikationen vor der Bestellung beim Händler bestätigen.'},es:{name:'The Classic — Plata',description:'Una silueta limpia y discreta para cada día. Producto de muestra: confirma las especificaciones con el vendedor antes de comprar.'}},{id:'p2',name:'The Chronograph — Noir',category:'watches',price:249,stock:16,image:'/assets/noir.svg',description:'A striking dial with a timeless profile. Sample product; specifications are not yet confirmed.',active:true,badge:'NEW',de:{name:'The Chronograph — Noir',description:'Ein markantes Zifferblatt mit zeitlosem Profil. Musterprodukt; Spezifikationen noch nicht bestätigt.'},es:{name:'The Chronograph — Noir',description:'Una esfera distintiva con un perfil atemporal. Producto de muestra; especificaciones pendientes de confirmar.'}},{id:'p3',name:'Everyday Leather Strap',category:'straps',price:39,stock:50,image:'/assets/strap.svg',description:'Refresh your everyday watch. Sample listing: please confirm lug width and compatibility before ordering.',active:true,badge:'',de:{name:'Lederarmband Everyday',description:'Ein neuer Look für Ihre Uhr. Musterangebot: Bandanstoß und Kompatibilität vor dem Kauf bestätigen.'},es:{name:'Correa de piel Everyday',description:'Renueva tu reloj. Anuncio de muestra: confirma el ancho y la compatibilidad antes de comprar.'}},{id:'p4',name:'Weekend Watch Case',category:'storage',price:59,stock:25,image:'/assets/case.svg',description:'A dedicated place for your favourite timepiece. Sample product; final images and specifications to be supplied.',active:true,badge:'EDITORS’ PICK',de:{name:'Uhrenetui Weekend',description:'Ein fester Platz für Ihre Lieblingsuhr. Musterprodukt; finale Bilder und Spezifikationen folgen.'},es:{name:'Estuche Weekend',description:'Un lugar para tu reloj favorito. Producto de muestra; imágenes y especificaciones finales pendientes.'}}]};
if(!db.prepare('SELECT id FROM content WHERE id=1').get()) db.prepare('INSERT INTO content VALUES (1,?,?)').run(JSON.stringify(seed),JSON.stringify(seed));
const password=process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
if(!process.env.ADMIN_PASSWORD) console.log(`临时管理员密码（重启后变化）: ${password}`);
const salt=randomBytes(16), hash=scryptSync(password,salt,64), sessions=new Map();
const whatsappDefaults={enabled:false,phone:'',messages:{en:'Hi! I would like to know more about your watches.',de:'Hallo! Ich möchte mehr über Ihre Uhren erfahren.',es:'¡Hola! Me gustaría saber más sobre sus relojes.'}};
const content=(field)=>{const c=JSON.parse(db.prepare('SELECT draft,published FROM content WHERE id=1').get()[field]);return{...c,whatsapp:{...whatsappDefaults,...c.whatsapp,messages:{...whatsappDefaults.messages,...c.whatsapp?.messages}}};};
const save=(field,value)=>db.prepare(`UPDATE content SET ${field}=? WHERE id=1`).run(JSON.stringify(value));
// —— 未支付订单过期：释放库存，避免弃单长期占用 ——
function releaseOrderStock(id,reason){
 const o=getOrder(id); if(o.details.stockReleased)return false;
 const c=content('published'),d=content('draft');
 for(const item of o.details.items||[]){
  const p=c.products.find(x=>x.id===item.id); if(p)p.stock+=item.quantity;
  const dp=d.products.find(x=>x.id===item.id); if(dp)dp.stock+=item.quantity;
 }
 o.details.status=reason;o.details.stockReleased=true;o.details.expiredAt=new Date().toISOString();
 db.exec('BEGIN');
 try{
  save('published',c);save('draft',d);
  db.prepare('UPDATE orders SET details=? WHERE id=?').run(JSON.stringify(o.details),id);
  const p=getPayment(id); if(p&&p.status!=='paid'){p.status='expired';putPayment(id,p);}
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return true;
}
function sweepExpiredOrders(){
 if(!orderTTL)return 0;
 const cutoff=new Date(Date.now()-orderTTL).toISOString();let released=0;
 for(const row of db.prepare('SELECT id FROM orders WHERE created<?').all(cutoff)){
  try{
   const o=getOrder(row.id);if(o.details.stockReleased||o.details.status==='Paid')continue;
   const p=getPayment(row.id);
   // 已提交链上哈希 / 已走 PayPal 的订单不自动释放：买家可能已完成付款
   if(p&&(p.status==='paid'||p.status==='awaiting_review'||p.submittedHash||p.provider==='paypal'))continue;
   if(releaseOrderStock(row.id,'Expired — stock released'))released++;
  }catch{}
 }
 return released;
}
const sweepInterval=Math.max(200,Number(process.env.SWEEP_INTERVAL_MS||300000));
setInterval(()=>{try{sweepExpiredOrders()}catch{}} ,sweepInterval).unref();
try{sweepExpiredOrders()}catch{}
// —— 订单确认邮件 ——
function markOrderMail(id,status,error){
 try{const o=getOrder(id);o.details.mail={status,at:new Date().toISOString(),...(error?{error:String(error).slice(0,200)}:{})};db.prepare('UPDATE orders SET details=? WHERE id=?').run(JSON.stringify(o.details),id);}catch{}
}
function queueOrderMail(order,accessToken){
 const mail=currentMailer();
 if(!mail.enabled)return markOrderMail(order.id,'disabled');
 try{
  const brand=content('published').brand||'MERIDIAN';
  const settings=mailSettings();
  const msg=orderEmail({order,accessToken,brand,siteUrl:publicBase,whatsapp:settings.whatsapp||''});
  const recipients=[order.email,...String(settings.notifyEmail||'').split(',').map(s=>s.trim()).filter(Boolean)];
  markOrderMail(order.id,'queued');
  Promise.allSettled(recipients.map(to=>mail.send({to,subject:msg.subject,html:msg.html,text:msg.text})))
   .then(rs=>{const bad=rs.filter(r=>r.status==='rejected');markOrderMail(order.id,bad.length?'failed':'sent',bad.length?bad[0].reason?.message:'');})
   .catch(e=>markOrderMail(order.id,'failed',e.message));
 }catch(e){markOrderMail(order.id,'failed',e.message);}
}
function validate(c){
 if(!c||typeof c!=='object'||!Array.isArray(c.products)||!Array.isArray(c.categories)||!Array.isArray(c.sections)) throw Error('内容格式错误');
 for(const key of ['brand','announcement','title','subtitle','eyebrow','heroImage','accent']) if(typeof c[key]!=='string') throw Error('页面字段不完整');
 if(c.whatsapp!==undefined){const w=c.whatsapp;if(!w||typeof w!=='object'||typeof w.enabled!=='boolean'||typeof w.phone!=='string'||!w.messages||typeof w.messages!=='object')throw Error('WhatsApp 配置格式错误');
 if(!/^[+0-9 ()-]*$/.test(w.phone))throw Error('WhatsApp 号码只允许国际区号和数字');
 const phone=w.phone.replace(/[+ ()-]/g,'');if((phone||w.enabled)&&!/^[1-9][0-9]{6,14}$/.test(phone))throw Error('请填写有效的 WhatsApp 国际号码，例如 +44…，不要填写本地前导 0');
 if(['en','de','es'].some(lang=>typeof w.messages[lang]!=='string'||w.messages[lang].length>1000))throw Error('WhatsApp 预填消息每种语言最多 1000 字符');
 c.whatsapp={enabled:w.enabled,phone,messages:Object.fromEntries(['en','de','es'].map(lang=>[lang,w.messages[lang]]))};
 }
 if(!/^#[0-9a-f]{6}$/i.test(c.accent)) throw Error('主题色需要使用六位十六进制颜色');
 for(const lang of ['de','es']) {
 const page=c.translations?.[lang];if(page&&(typeof page!=='object'||Object.values(page).some(v=>typeof v!=='string')))throw Error('Invalid page translations');
 for(const item of [...c.products,...c.sections])if(item[lang]&&(typeof item[lang]!=='object'||Object.values(item[lang]).some(v=>typeof v!=='string')))throw Error('Invalid translations');
 }
 const unique=(items)=>items.every(x=>typeof x.id==='string'&&x.id.length>0)&&new Set(items.map(x=>x.id)).size===items.length;
 if(!unique(c.categories)||!unique(c.products)||!unique(c.sections)) throw Error('编号必须唯一且不能为空');
 if(c.categories.some(x=>typeof x.name!=='string'||!x.name.trim())) throw Error('分类名称不能为空');
 if(c.categories.some(x=>x.access!==undefined&&!ACCESS_LEVELS.includes(x.access))) throw Error('分类观看等级只能是 all / normal / vip');
 if(c.sections.some(x=>!['text','products'].includes(x.type)||typeof x.title!=='string'||typeof x.text!=='string'||typeof x.visible!=='boolean')) throw Error('区块格式错误');
 const image=(s)=>typeof s==='string'&&(s===''||/^https:\/\//i.test(s)||/^\/[^/]/.test(s));
 if(!image(c.heroImage)) throw Error('图片地址须使用 HTTPS 或站内路径');
 for(const p of c.products){
  if(typeof p.name!=='string'||!p.name.trim()||!Number.isFinite(p.price)||p.price<0||p.price>1000000||!Number.isInteger(p.stock)||p.stock<0||!c.categories.some(x=>x.id===p.category)||!image(p.image)||typeof p.description!=='string'||typeof p.active!=='boolean'||typeof p.badge!=='string') throw Error('请检查商品名称、分类、价格、库存和图片');
  if(p.access!==undefined&&!ACCESS_LEVELS.includes(p.access))throw Error('商品观看等级只能是 all / normal / vip');
  if(p.images!==undefined&&(!Array.isArray(p.images)||p.images.length>8||p.images.some(u=>!image(u)||u==='')))throw Error('图集最多 8 张，且每张须为 HTTPS 或站内路径');
 }
 return c;
}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req,limit=2e6){let str='';for await(const chunk of req){str+=chunk;if(Buffer.byteLength(str)>limit) throw Error('请求过大');}return JSON.parse(str||'{}');}
const auth=(req)=>{const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);return token&&sessions.get(token)>Date.now();};
const attempts=new Map();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hostOnly=h=>{const v=String(h||'').split(',')[0].trim().toLowerCase();return /^[a-z0-9.-]+(:\d+)?$/.test(v)?v:''};
// 反向代理（Nginx/Caddy/1Panel）后 Host 与 X-Forwarded-Host 不一致时，origin 校验会误判 403
function originAllowed(req){
 const origin=req.headers.origin; if(!origin)return true;
 let u; try{u=new URL(origin)}catch{return false}
 if(!['http:','https:'].includes(u.protocol))return false;
 if(publicBase&&u.origin===publicBase)return true;
 const hosts=new Set([hostOnly(req.headers.host),hostOnly(req.headers['x-forwarded-host']),publicBase?new URL(publicBase).host:''].filter(Boolean));
 return hosts.size>0&&hosts.has(u.host.toLowerCase());
}
function securityHeaders(res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('Permissions-Policy','geolocation=(), microphone=(), camera=(), payment=()');
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; form-action 'self' https://www.paypal.com https://www.sandbox.paypal.com; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
 if(publicBase||process.env.COOKIE_SECURE==='true') res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
}
const absURL=u=>/^https:\/\//i.test(u||'')?u:(publicBase&&u?publicBase+u:'');
function seoHead(url,req){
 const c=content('published');
 const id=url.searchParams.get('product');
 const viewer=customerFromReq(req);
 const found=id?c.products.find(p=>p.id===id&&p.active):null;
 const seoMap=categoryAccessMap(c);
 const product=found&&canView(effectiveAccess(found,seoMap),viewer)?found:null;
 const title=product?`${product.name} — ${c.brand}`:`${c.brand} — Watches & Essentials`;
 const desc=String(product?product.description:(c.subtitle||c.announcement||'')).replace(/\s+/g,' ').trim().slice(0,160);
 const canonical=publicBase?publicBase+(product?`/?product=${encodeURIComponent(product.id)}`:'/'):'';
 const image=absURL(product?product.image:c.heroImage);
 const gallery=product?[product.image,...(Array.isArray(product.images)?product.images:[])].map(absURL).filter(Boolean):[];
 const ld=product
  ?{'@context':'https://schema.org','@type':'Product',name:product.name,description:product.description,sku:product.id,brand:{'@type':'Brand',name:c.brand},...(gallery.length?{image:gallery}:{}),offers:{'@type':'Offer',price:String(product.price),priceCurrency:'USD',availability:product.stock>0?'https://schema.org/InStock':'https://schema.org/OutOfStock',...(canonical?{url:canonical}:{})}}
  :{'@context':'https://schema.org','@type':'Store',name:c.brand,description:desc,...(canonical?{url:canonical}:{}),...(image?{image:image}:{}),hasOfferCatalog:{'@type':'OfferCatalog',name:'Collection',itemListElement:c.products.filter(p=>p.active&&canView(effectiveAccess(p,seoMap),viewer)).map(p=>({'@type':'Offer',price:String(p.price),priceCurrency:'USD',itemOffered:{'@type':'Product',name:p.name}}))}};
 return [
  `<meta name="description" content="${esc(desc)}">`,
  `<meta name="robots" content="${url.searchParams.has('preview')||(id&&!product)?'noindex, nofollow':'index, follow'}">`,
  `<meta property="og:type" content="${product?'product':'website'}">`,
  `<meta property="og:site_name" content="${esc(c.brand)}">`,
  `<meta property="og:title" content="${esc(title)}">`,
  `<meta property="og:description" content="${esc(desc)}">`,
  image?`<meta property="og:image" content="${esc(image)}">`:'',
  canonical?`<meta property="og:url" content="${esc(canonical)}">`:'',
  `<meta name="twitter:card" content="summary_large_image">`,
  canonical?`<link rel="canonical" href="${esc(canonical)}">`:'',
  `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g,'\\u003c')}</script>`
 ].filter(Boolean).join('');
}
function renderIndex(url,req){return readFileSync(resolve('public','index.html'),'utf8').replace('</head>',seoHead(url,req)+'</head>');}
function sitemapXML(){
 if(!publicBase)return '';
 const c=content('published'),last=new Date().toISOString().slice(0,10);
 const urls=[`<url><loc>${publicBase}/</loc><lastmod>${last}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
  ...c.products.filter(p=>p.active&&effectiveAccess(p,categoryAccessMap(c))==='all').map(p=>`<url><loc>${publicBase}/?product=${encodeURIComponent(p.id)}</loc><lastmod>${last}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`)];
 return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
}
const server=http.createServer(async(req,res)=>{
 securityHeaders(res);
 const url=new URL(req.url,'http://localhost');
 try{
  if(url.pathname==='/healthz')return json(res,200,{ok:true,uptime:Math.round(process.uptime())});
  if(req.method!=='GET'&&req.method!=='HEAD'&&!originAllowed(req)) return json(res,403,{error:'不允许跨站请求'});
  if(url.pathname==='/api/login'&&req.method==='POST'){
   const ip=req.socket.remoteAddress,now=Date.now(),a=attempts.get(ip)||{n:0,t:now};if(now-a.t>600000){a.n=0;a.t=now;} if(a.n>=10)return json(res,429,{error:'尝试次数过多，请十分钟后再试'});
   const b=await body(req);if(typeof b.password!=='string'||!timingSafeEqual(scryptSync(b.password,salt,64),hash)){a.n++;attempts.set(ip,a);return json(res,401,{error:'密码不正确'});}
   attempts.delete(ip);for(const [k,v] of sessions)if(v<now)sessions.delete(k);const token=randomBytes(32).toString('hex');sessions.set(token,now+8*3600000);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/logout'&&req.method==='POST'){const token=(req.headers.cookie||'').match(/(?:^|;\s*)session=([^;]+)/)?.[1];sessions.delete(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
  if(url.pathname.startsWith('/api/admin')){
   if(!auth(req))return json(res,401,{error:'请先登录后台'});
   const confirmation=url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/confirm-usdt$/);
   if(confirmation&&req.method==='POST')return await locked(confirmation[1],async()=>{const id=confirmation[1],p=getPayment(id),b=await body(req);if(!p||p.provider!=='usdt')throw Error('No USDT payment found');if(p.status==='paid')return json(res,200,{payment:paymentView(p)});if(b.verified!==true||p.status!=='awaiting_review'||transactionHash(b.transactionId)!==p.submittedHash)throw Error('Verify the submitted transaction before confirming');const used=db.prepare('SELECT order_id FROM payment_receipts WHERE network=? AND tx_hash=?').get(p.network,p.submittedHash);if(used)throw Error('This transaction has already been used for another order');db.exec('BEGIN');try{db.prepare('INSERT INTO payment_receipts VALUES (?,?,?)').run(p.network,p.submittedHash,id);p.status='paid';p.transactionId=p.submittedHash;p.paidAt=new Date().toISOString();p.confirmedBy='admin';putPayment(id,p);const o=getOrder(id);o.details.status='Paid';db.prepare('UPDATE orders SET details=? WHERE id=?').run(JSON.stringify(o.details),id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,200,{payment:paymentView(p)});});
   if(url.pathname==='/api/admin/payments'&&req.method==='GET')return json(res,200,{config:paymentConfig(),readiness:readiness(paymentConfig(),process.env)});
   if(url.pathname==='/api/admin/payments'&&req.method==='PUT'){const config=validateConfig(await body(req));db.prepare('UPDATE payment_config SET value=? WHERE id=1').run(JSON.stringify(config));return json(res,200,{config,readiness:readiness(config,process.env)});}
   if(url.pathname==='/api/admin/content'&&req.method==='GET')return json(res,200,content('draft'));
   if(url.pathname==='/api/admin/content'&&req.method==='PUT'){save('draft',validate(await body(req)));return json(res,200,{ok:true});}
   if(url.pathname==='/api/admin/publish'&&req.method==='POST'){save('published',validate(content('draft')));return json(res,200,{ok:true});}
   if(url.pathname==='/api/admin/orders'&&req.method==='GET')return json(res,200,db.prepare('SELECT * FROM orders ORDER BY created DESC').all().map(x=>({...x,details:JSON.parse(x.details),payment:paymentView(getPayment(x.id))})));
   if(url.pathname==='/api/admin/customers'&&req.method==='GET'){
    const q=String(url.searchParams.get('q')||'').trim().toLowerCase();
    const rows=db.prepare('SELECT id,email,name,level,created FROM customers ORDER BY created DESC LIMIT 500').all();
    const list=q?rows.filter(r=>r.email.includes(q)||String(r.name||'').toLowerCase().includes(q)):rows;
    return json(res,200,list.map(r=>({...r,orders:db.prepare("SELECT COUNT(*) n FROM orders WHERE details LIKE ?").get('%'+r.id+'%').n})));
   }
   if(url.pathname.startsWith('/api/admin/customers/')&&req.method==='PUT'){
    const id=decodeURIComponent(url.pathname.split('/').pop());
    const b=await body(req);
    if(!LEVELS.includes(b.level))throw Error('等级只能是 normal 或 vip');
    const row=db.prepare('SELECT id FROM customers WHERE id=?').get(id);
    if(!row)return json(res,404,{error:'用户不存在'});
    db.prepare('UPDATE customers SET level=? WHERE id=?').run(b.level,id);
    return json(res,200,{ok:true,level:b.level});
   }
   if(url.pathname==='/api/admin/analytics'&&req.method==='GET'){
    const span=Math.min(90,Math.max(1,Number(url.searchParams.get('days')||14)));
    const hourly=url.searchParams.get('mode')==='hour';
    const since=dayKey(-(span-1));
    const rows=db.prepare('SELECT day,hour,kind,ref,vid,source FROM events WHERE day>=?').all(since);
    const orders=db.prepare('SELECT created,details FROM orders WHERE created>=?').all(since+'T00:00:00.000Z');
    const products=(content('published').products||[]);
    const nameOf=id=>products.find(x=>x.id===id)?.name||id;

    const bucket={};
    const empty=()=>({pv:0,uv:new Set(),addcarts:0,orders:0,revenue:0,paid:0,payers:new Set()});
    const dayBucket=d=>bucket[d]??(bucket[d]=empty());
    const perDay=[];
    for(let i=span-1;i>=0;i--){const d=dayKey(-i);perDay.push(d);dayBucket(d);}
    const perHour=Array.from({length:24},(_,h)=>({hour:h,pv:0,uv:new Set()}));

    for(const e of rows){
     const b=dayBucket(e.day);
     if(e.kind==='page'){b.pv++;b.uv.add(e.vid);if(hourly&&e.day===dayKey(0)){perHour[e.hour].pv++;perHour[e.hour].uv.add(e.vid);}}
     if(e.kind==='addcart')b.addcarts++;
    }
    const topViews=new Map(),topCarts=new Map();
    for(const e of rows){
     if(e.kind==='product'){topViews.set(e.ref,(topViews.get(e.ref)||0)+1);}
     if(e.kind==='addcart'){topCarts.set(e.ref,(topCarts.get(e.ref)||0)+1);}
    }
    const perProduct=new Map();
    for(const o of orders){
     const d=o.created.slice(0,10),b=dayBucket(d),det=JSON.parse(o.details);
     b.orders++;
     const paid=det.status==='Paid';
     if(paid){b.revenue+=Number(det.total||0);b.paid++;if(det.customerId||det.email)b.payers.add(det.customerId||det.email);}
     for(const it of det.items||[]){const cur=perProduct.get(it.id)||{orders:0,units:0,revenue:0};cur.orders++;cur.units+=it.quantity;if(paid)cur.revenue+=Number(it.price||0)*Number(it.quantity||0);perProduct.set(it.id,cur);}
    }
    const pack=(b)=>({pv:b.pv,uv:b.uv.size,addcarts:b.addcarts,orders:b.orders,revenue:Number(b.revenue.toFixed(2)),paid:b.paid,payers:b.payers.size,conversion:b.uv.size?Number((b.orders/b.uv.size*100).toFixed(2)):0});
    const series=perDay.map(d=>({day:d,...pack(dayBucket(d))}));
    const hours=hourly?perHour.map(h=>({hour:h.hour,pv:h.pv,uv:h.uv.size})):[];
    const totals=series.reduce((a,x)=>({pv:a.pv+x.pv,orders:a.orders+x.orders,revenue:Number((a.revenue+x.revenue).toFixed(2)),addcarts:a.addcarts+x.addcarts,uv:a.uv+x.uv}),{pv:0,orders:0,revenue:0,addcarts:0,uv:0});
    const src={};for(const e of rows)if(e.kind==='page')src[e.source]=(src[e.source]||0)+1;
    const sources=Object.entries(src).map(([k,v])=>({source:k,pv:v,share:totals.pv?Number((v/totals.pv*100).toFixed(1)):0})).sort((a,b)=>b.pv-a.pv);
    const topProducts=[...new Set([...topViews.keys(),...topCarts.keys(),...perProduct.keys()])].map(id=>({id,name:nameOf(id),views:topViews.get(id)||0,addcarts:topCarts.get(id)||0,orders:perProduct.get(id)?.orders||0,units:perProduct.get(id)?.units||0,revenue:Number((perProduct.get(id)?.revenue||0).toFixed(2))})).sort((a,b)=>b.views-a.views||b.orders-a.orders).slice(0,12);
    const today=pack(dayBucket(dayKey(0))),yesterday=pack(dayBucket(dayKey(-1)));
    return json(res,200,{days:span,series,hours,sources,topProducts,totals,today,yesterday});
   }
   if(url.pathname==='/api/admin/mail'&&req.method==='GET')return json(res,200,mailView());
   if(url.pathname==='/api/admin/mail'&&req.method==='PUT'){
    const b=await body(req),cur=mailSettings();
    const provider=String(b.provider||cur.provider||'resend').toLowerCase();
    if(!['resend','postmark','sendgrid','generic','smtp'].includes(provider))throw Error('邮件服务商只能是 resend / postmark / sendgrid / generic / smtp');
    const emailOk=v=>/^\S+@\S+\.\S+$/.test(String(v||'').trim());
    const from=String(b.from??cur.from??'').trim();
    if(from&&!emailOk(from.replace(/^.*</,'').replace(/>.*$/,'')))throw Error('发件地址格式不正确');
    const apiUrl=String(b.apiUrl??cur.apiUrl??'').trim();
    if(provider==='generic'&&!/^https:\/\/\S+$/.test(apiUrl)&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(apiUrl))throw Error('generic 需要 HTTPS 接口地址（本机调试允许 127.0.0.1）');
    const notifyEmail=String(b.notifyEmail??cur.notifyEmail??'').trim();
    if(notifyEmail&&notifyEmail.split(',').map(x=>x.trim()).filter(Boolean).some(x=>!emailOk(x)))throw Error('店主收件地址格式不正确');
    const apiKeyRaw=b.apiKey===undefined?cur.apiKey:String(b.apiKey||'').trim();
    if(provider!=='smtp'&&b.apiKey==='')throw Error('API Key 不能为空；如需清除请先关闭邮件功能');
    const smtpHost=String(b.smtpHost??cur.smtpHost??'').trim();
    const smtpPort=String(b.smtpPort??cur.smtpPort??'587').trim()||'587';
    if(provider==='smtp'){
     if(!smtpHost)throw Error('SMTP 需要服务器地址（如 mail.你的域名.com 或服务商给的 host）');
     if(!/^\d{1,5}$/.test(smtpPort)||Number(smtpPort)<1||Number(smtpPort)>65535)throw Error('SMTP 端口不合法');
    }
    const smtpSecure=(b.smtpSecure===undefined?(String(cur.smtpSecure)==='true'):Boolean(b.smtpSecure))?'true':'false';
    const smtpPassRaw=b.smtpPass===undefined?cur.smtpPass:String(b.smtpPass||'');
    const next={provider,apiKey:apiKeyRaw,from,fromName:String(b.fromName??cur.fromName??'MERIDIAN').trim()||'MERIDIAN',apiUrl,notifyEmail,whatsapp:String(b.whatsapp??cur.whatsapp??'').trim(),smtpHost,smtpPort,smtpSecure,smtpUser:String(b.smtpUser??cur.smtpUser??'').trim(),smtpPass:smtpPassRaw};
    db.prepare('INSERT INTO mail_config (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(next));
    return json(res,200,{ok:true,...mailView()});
   }
   if(url.pathname==='/api/admin/mail/test'&&req.method==='POST'){
    const b=await body(req),mailInst=currentMailer();
    if(!mailInst.enabled)throw Error('邮件未配置：请填写服务商、API Key 与发件地址');
    if(typeof b.to!=='string'||!/^\S+@\S+\.\S+$/.test(b.to))throw Error('收件地址无效');
    const msg=orderEmail({order:{id:'TEST-'+Date.now(),details:{items:[{name:'测试商品',price:1,quantity:1}],total:1,shipping:0,name:'Test Customer',address:'Test street 1',postalCode:'00000',country:'US',phone:'+1 000 000 0000'}},accessToken:'',brand:content('draft').brand||'MERIDIAN',siteUrl:publicBase});
    await mailInst.send({to:b.to,subject:'[测试] '+msg.subject,html:msg.html,text:msg.text});
    return json(res,200,{ok:true});
   }
   if(url.pathname==='/api/admin/uploads'&&req.method==='POST'){
    const b=await body(req,24e6);
    const list=Array.isArray(b.files)?b.files:(typeof b.data==='string'?[b.data]:[]);
    if(!list.length)throw Error('缺少图片数据');
    if(list.length>8)throw Error('一次最多上传 8 张图片');
    const save=(data)=>{
     if(typeof data!=='string'||!data)throw Error('图片数据无效');
     const buf=Buffer.from(data.replace(/^data:[^,]*,/,''),'base64');
     if(!buf.length)throw Error('图片数据无效');
     if(buf.length>5*1024*1024)throw Error('单张图片不能超过 5MB');
     const kind=buf[0]===0x89&&buf.toString('ascii',1,4)==='PNG'?'png':buf[0]===0xff&&buf[1]===0xd8?'jpg':buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP'?'webp':'';
     if(!kind)throw Error('只支持 PNG / JPEG / WebP 图片');
     const name=createHash('sha256').update(buf).digest('hex').slice(0,32)+'.'+kind;
     writeFileSync(join(uploadDir,name),buf);
     return '/uploads/'+name;
    };
    const urls=list.map(save);
    return json(res,201,{url:urls[0],urls});
   }
  }
  if(url.pathname==='/api/payments/methods'&&req.method==='GET')return json(res,200,methods(paymentConfig(),process.env));
  if(url.pathname==='/api/payments/paypal/webhook'&&req.method==='POST'){
   const event=await body(req);await verifyPayPalWebhook(event,req.headers,paymentConfig(),process.env);
   if(event.event_type==='PAYMENT.CAPTURE.COMPLETED'){const providerId=event.resource?.supplementary_data?.related_ids?.order_id;const row=db.prepare("SELECT order_id FROM payments WHERE json_extract(details,'$.provider')='paypal' AND json_extract(details,'$.providerId')=?").get(providerId||'');if(row)await locked(row.order_id,async()=>{const p=getPayment(row.order_id);if(p.status!=='paid'){const transaction=await capturePayPal(p,row.order_id,process.env);if(transaction)markPaid(row.order_id,transaction);}});}
   return json(res,200,{ok:true});
  }
  const paymentRoute=url.pathname.match(/^\/api\/orders\/([^/]+)\/(payment|capture|transaction)$/);
  if(paymentRoute){
   const id=paymentRoute[1],token=req.headers.authorization?.replace(/^Bearer /,'');const access=db.prepare('SELECT token_hash FROM order_access WHERE order_id=?').get(id);
   if(!token||!access||digest(token)!==access.token_hash)return json(res,403,{error:'Order access denied'});
   if(req.method==='GET'&&paymentRoute[2]==='payment'){const o=getOrder(id),policy=o.details.paymentPolicy||null;return json(res,200,{id,total:o.details.total,currency:o.details.currency,policy,allowed:allowedProviders(paymentConfig(),process.env,policy),payment:paymentView(getPayment(id))});}
   if(req.method==='POST')return await locked(id,async()=>{
    const existing=getPayment(id),o=getOrder(id);
    if(paymentRoute[2]==='transaction'){if(!existing||existing.provider!=='usdt')throw Error('No USDT payment found');if(existing.status==='paid')return json(res,200,{payment:paymentView(existing)});const b=await body(req);existing.submittedHash=transactionHash(b.transactionId);existing.status='awaiting_review';existing.submittedAt=new Date().toISOString();putPayment(id,existing);return json(res,200,{payment:paymentView(existing)});}

    if(paymentRoute[2]==='capture'){if(!existing||existing.provider!=='paypal')throw Error('No PayPal checkout found');if(existing.status!=='paid'){const transaction=await capturePayPal(existing,id,process.env);if(transaction)markPaid(id,transaction);}return json(res,200,{payment:paymentView(getPayment(id))});}
    const b=await body(req);if(!['paypal','usdt'].includes(b.provider))throw Error('Unknown payment method');
    if(existing){if(existing.provider!==b.provider)throw Error('This order already has a payment method');return json(res,200,{payment:paymentView(existing)});}
    if(!methods(paymentConfig(),process.env)[b.provider])throw Error('Payment method is not configured');
    const policy=o.details.paymentPolicy||null;
    if(!allowedProviders(paymentConfig(),process.env,policy).includes(b.provider))throw Error(policy==='usdt'?'VIP 商品仅支持 USDT 支付':'该订单仅支持 PayPal 支付');
    const p=await createCheckout(o,paymentConfig(),process.env,b.provider);putPayment(id,p);return json(res,201,{payment:paymentView(p)});
   });
  }
  if(url.pathname==='/api/auth/register'&&req.method==='POST'){
   const b=await body(req);const email=String(b.email||'').trim().toLowerCase();
   if(!/^\S+@\S+\.\S+$/.test(email))throw Error('邮箱格式不正确');
   if(typeof b.password!=='string'||b.password.length<8)throw Error('密码至少 8 位');
   if(b.password.length>200)throw Error('密码过长');
   if(db.prepare('SELECT 1 FROM customers WHERE email=?').get(email))return json(res,409,{error:'该邮箱已注册，请直接登录'});
   const id='C'+randomBytes(8).toString('hex'),name=String(b.name||'').slice(0,80);
   db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?)').run(id,email,name,hashPass(b.password),'normal',new Date().toISOString());
   setCustomerCookie(res,id);
   return json(res,201,{email,level:'normal',name});
  }
  if(url.pathname==='/api/auth/login'&&req.method==='POST'){
   const ip='c:'+req.socket.remoteAddress,now=Date.now(),a=attempts.get(ip)||{n:0,t:now};
   if(now-a.t>600000){a.n=0;a.t=now;}
   if(a.n>=10)return json(res,429,{error:'尝试次数过多，请十分钟后再试'});
   const b=await body(req),email=String(b.email||'').trim().toLowerCase();
   const row=db.prepare('SELECT id,email,name,level,pass FROM customers WHERE email=?').get(email);
   if(!row||typeof b.password!=='string'||!checkPass(b.password,row.pass)){a.n++;attempts.set(ip,a);return json(res,401,{error:'邮箱或密码不正确'});}
   attempts.delete(ip);
   setCustomerCookie(res,row.id);
   return json(res,200,{email:row.email,name:row.name,level:row.level});
  }
  if(url.pathname==='/api/auth/logout'&&req.method==='POST'){
   const token=(req.headers.cookie||'').match(/(?:^|;\s*)meridian_customer=([^;]+)/)?.[1];
   if(token)db.prepare('DELETE FROM customer_sessions WHERE token=?').run(digest(token));
   res.setHeader('Set-Cookie',`meridian_customer=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);
   return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/auth/me'&&req.method==='GET'){
   const viewer=customerFromReq(req);
   return viewer?json(res,200,viewer):json(res,401,{error:'未登录'});
  }
  if(url.pathname==='/api/track'&&req.method==='POST'){
   const b=await body(req);
   const kind=['product','category','addcart'].includes(b.kind)?b.kind:'';
   if(!kind)return json(res,204,{});
   const vid=visitorId(req,res);
   trackEvent(kind,{ref:String(b.id||'').slice(0,64),vid,source:sourceOf(req)});
   return json(res,204,{});
  }
  if(url.pathname==='/api/store'&&req.method==='GET'){
   const viewer=customerFromReq(req);
   const c=content(url.searchParams.has('preview')&&auth(req)?'draft':'published');
   const catMap=categoryAccessMap(c);
   c.products=c.products.filter(p=>p.active&&canView(effectiveAccess(p,catMap),viewer)).map(p=>({...p,access:effectiveAccess(p,catMap),locked:false}));
   c.categories=(c.categories||[]).filter(x=>canView(catMap.get(x.id),viewer));
   c.viewer=viewer?{email:viewer.email,level:viewer.level,name:viewer.name}:null;
   return json(res,200,c);
  }
  if(url.pathname.startsWith('/api/products/')&&req.method==='GET'){
   const id=decodeURIComponent(url.pathname.slice('/api/products/'.length));
   const viewer=customerFromReq(req);
   const p=content('published').products.find(x=>x.id===id&&x.active);
   if(!p)return json(res,404,{error:'商品不存在或已下架'});
   const access=effectiveAccess(p,categoryAccessMap(content('published')));
   if(!canView(access,viewer))return json(res,403,{error:'此商品仅限 VIP 会员浏览',access,loggedIn:Boolean(viewer),level:viewer?.level||null});
   return json(res,200,{...p,access,locked:false});
  }
  if(url.pathname==='/api/orders'&&req.method==='POST'){
   const b=await body(req);if(typeof b.email!=='string'||!/^\S+@\S+\.\S+$/.test(b.email)||typeof b.country!=='string'||!b.country.trim()||typeof b.postalCode!=='string'||!b.postalCode.trim())throw Error('Email, country and postal code are required');
   if(!b.name?.trim()||!b.phone?.trim()||!b.address?.trim()||!Array.isArray(b.items)||!b.items.length||b.items.length>100)return json(res,400,{error:'Please complete your shipping information and select a product'});
   if([b.name,b.phone,b.address].some(x=>typeof x!=='string'||x.length>500))throw Error('Shipping information is too long');
   const c=content('published'),draft=content('draft'),seen=new Set();let total=0,hasVipItem=false;
   const viewer=customerFromReq(req),catMap=categoryAccessMap(c);const items=b.items.map(i=>{const p=c.products.find(p=>p.id===i.id&&p.active);if(seen.has(i.id)||!p||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>p.stock)throw Error('A product is unavailable or has insufficient stock. Please refresh and try again.');const itemAccess=effectiveAccess(p,catMap);if(!canView(itemAccess,viewer))throw Error('该商品仅限指定等级会员购买，请登录相应等级账号');if(itemAccess==='vip')hasVipItem=true;seen.add(i.id);total+=Math.round(p.price*100)*i.quantity;p.stock-=i.quantity;const d=draft.products.find(x=>x.id===p.id);if(d)d.stock=Math.max(0,d.stock-i.quantity);return{id:p.id,name:p.name,price:p.price,quantity:i.quantity};});
   const shipping=total>=15000?0:1200;const details={...(customerFromReq(req)?{customerId:customerFromReq(req).id}:{}),paymentPolicy:PAYMENT_RULES_OFF?null:(hasVipItem?'usdt':'paypal'),country:String(b.country||'').slice(0,100),postalCode:String(b.postalCode||'').slice(0,40),email:String(b.email||'').slice(0,200),currency:'USD',name:b.name.trim(),phone:b.phone.trim(),address:b.address.trim(),items,total:(total+shipping)/100,shipping:shipping/100,status:'Awaiting confirmation — unpaid'};const id='MY'+Date.now()+randomBytes(3).toString('hex');
   const accessToken=randomBytes(32).toString('hex');
   db.exec('BEGIN');try{save('published',c);save('draft',draft);db.prepare('INSERT INTO orders VALUES (?,?,?)').run(id,new Date().toISOString(),JSON.stringify(details));db.prepare('INSERT INTO order_access VALUES (?,?)').run(id,digest(accessToken));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}queueOrderMail({id,...details},accessToken);return json(res,201,{id,...details,accessToken});
  }
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'不支持此方法'});
  if(url.pathname==='/robots.txt'){res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','public, max-age=3600');return res.end(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n${publicBase?`Sitemap: ${publicBase}/sitemap.xml\n`:''}`);}
  if(url.pathname==='/sitemap.xml'){const xml=sitemapXML();if(!xml){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type','application/xml; charset=utf-8');res.setHeader('Cache-Control','public, max-age=3600');return res.end(xml);}
  const upload=url.pathname.match(/^\/uploads\/([a-f0-9]{32}\.(?:png|jpg|webp))$/);
  if(upload){
   const f=resolve(uploadDir,upload[1]);
   try{if(!statSync(f).isFile())throw Error();}catch{res.writeHead(404);return res.end('Not found');}
   res.setHeader('Content-Type',upload[1].endsWith('.png')?'image/png':upload[1].endsWith('.jpg')?'image/jpeg':'image/webp');
   res.setHeader('Cache-Control','public, max-age=31536000, immutable');
   return res.end(readFileSync(f));
  }
  const font=url.pathname.match(/^\/fonts\/(cardo|poppins)-(300|400|500|600|700)\.woff2$/);
  if(font){
   const f=resolve('public','fonts',font[1]+'-'+font[2]+'.woff2');
   try{if(!statSync(f).isFile())throw Error();}catch{res.writeHead(404);return res.end('Not found');}
   res.setHeader('Content-Type','font/woff2');
   res.setHeader('Cache-Control','public, max-age=31536000, immutable');
   return res.end(readFileSync(f));
  }
  const file=url.pathname==='/admin'?'admin.html':url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!['index.html','admin.html','app.js','admin.js','style.css','fonts.css','theme-tandorio.css','assets/hero.svg','assets/classic.svg','assets/noir.svg','assets/strap.svg','assets/case.svg'].includes(file)){res.writeHead(404);return res.end('Not found');}
  if(file==='index.html'){
   if(req.method==='GET'){try{const vid=visitorId(req,res);trackEvent('page',{vid,source:sourceOf(req)});}catch{}}
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-cache');return res.end(renderIndex(url,req));
  }
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[extname(file)]);res.end(readFileSync(resolve('public',file)));
 }catch(e){json(res,400,{error:e.message||'请求失败'});}
});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log('MERIDIAN 商城已启动，端口 '+(process.env.PORT||3000)));

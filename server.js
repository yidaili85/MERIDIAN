import {defaults, digest, readiness, methods, validateConfig, createCheckout, capturePayPal, verifyPayPalWebhook, transactionHash} from './payments.js';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const dir = process.env.DATA_DIR || './data'; mkdirSync(dir,{recursive:true});
const db = new DatabaseSync(resolve(dir,'store.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY, draft TEXT NOT NULL, published TEXT NOT NULL); CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created TEXT NOT NULL, details TEXT NOT NULL);');
db.exec("CREATE TABLE IF NOT EXISTS payment_config (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS payments (order_id TEXT PRIMARY KEY, details TEXT NOT NULL); CREATE TABLE IF NOT EXISTS payment_receipts (network TEXT NOT NULL, tx_hash TEXT NOT NULL, order_id TEXT NOT NULL, UNIQUE(network,tx_hash)); CREATE TABLE IF NOT EXISTS order_access (order_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL);");
if(!db.prepare('SELECT id FROM payment_config WHERE id=1').get())db.prepare('INSERT INTO payment_config VALUES (1,?)').run(JSON.stringify(defaults));
const paymentConfig=()=>({...defaults,...JSON.parse(db.prepare('SELECT value FROM payment_config WHERE id=1').get().value)});
const getPayment=id=>{const row=db.prepare('SELECT details FROM payments WHERE order_id=?').get(id);return row?JSON.parse(row.details):null;};
const getOrder=id=>{const row=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!row)throw Error('Order not found');return {...row,details:JSON.parse(row.details)};};
const putPayment=(id,p)=>db.prepare('INSERT INTO payments VALUES (?,?) ON CONFLICT(order_id) DO UPDATE SET details=excluded.details').run(id,JSON.stringify(p));
const locks=new Set();
async function locked(id,work){if(locks.has(id))throw Error('Payment is being processed. Please retry.');locks.add(id);try{return await work();}finally{locks.delete(id);}}
function markPaid(id,transactionId){const p=getPayment(id);if(p.status==='paid')return;const o=getOrder(id);p.status='paid';p.transactionId=transactionId;p.paidAt=new Date().toISOString();o.details.status='Paid';db.exec('BEGIN');try{putPayment(id,p);db.prepare('UPDATE orders SET details=? WHERE id=?').run(JSON.stringify(o.details),id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
const paymentView=p=>p?{provider:p.provider,mode:p.mode,status:p.status,amount:p.amount,currency:p.currency,network:p.network,transactionId:p.transactionId,paidAt:p.paidAt,url:p.url,address:p.address,usdtAmount:p.usdtAmount,rate:p.rate,submittedHash:p.submittedHash}:null;
const seed={closingTitle:'Make every moment yours.',closingText:'Your own rhythm. Your own signature.',closingLink:'Discover your next classic',footer:'Time well considered.',promise1:'Considered design',promise2:'Made for your everyday',promise3:'Complimentary shipping $150+',brand:'MERIDIAN',announcement:'Complimentary shipping on orders $150+ · Designed for every moment',title:'Time, exceptionally yours.',subtitle:'Considered watches and essential accessories. Designed to go beyond the everyday.',eyebrow:'PRECISION MEETS PERSONALITY',heroImage:'/assets/hero.svg',accent:'#303c38',translations:{de:{closingTitle:'Jeder Moment gehört Ihnen.',closingText:'Ihr Rhythmus. Ihr Stil.',closingLink:'Ihren nächsten Klassiker entdecken',footer:'Zeit, bewusst gestaltet.',promise1:'Durchdachtes Design',promise2:'Für Ihren Alltag',promise3:'Kostenloser Versand ab $150',announcement:'Kostenloser Versand ab $150 · Für jeden Moment',title:'Zeit. Auf Ihre Art.',subtitle:'Ausgewählte Uhren und unverzichtbare Accessoires. Für mehr als nur den Alltag.',eyebrow:'PRÄZISION TRIFFT PERSÖNLICHKEIT'},es:{closingTitle:'Haz tuyo cada momento.',closingText:'Tu ritmo. Tu estilo.',closingLink:'Descubre tu próximo clásico',footer:'El tiempo, bien pensado.',promise1:'Diseño cuidado',promise2:'Para tu día a día',promise3:'Envío gratuito a partir de $150',announcement:'Envío gratuito a partir de $150 · Para cada momento',title:'El tiempo, a tu manera.',subtitle:'Relojes y accesorios esenciales, elegidos con intención. Más allá de lo cotidiano.',eyebrow:'PRECISIÓN CON PERSONALIDAD'}},categories:[{id:'watches',name:'Watches',de:'Uhren',es:'Relojes'},{id:'straps',name:'Watch straps',de:'Armbänder',es:'Correas'},{id:'storage',name:'Cases & storage',de:'Etuis & Aufbewahrung',es:'Estuches'},{id:'care',name:'Tools & care',de:'Werkzeug & Pflege',es:'Herramientas y cuidado'}],sections:[{id:'intro',type:'text',title:'Every second, considered.',text:'Clean lines. Thoughtful details. Discover watches and accessories that make your time feel like your own.',visible:true,de:{title:'Jede Sekunde zählt.',text:'Klare Linien. Durchdachte Details. Entdecken Sie Uhren und Accessoires für Ihren eigenen Rhythmus.'},es:{title:'Cada segundo cuenta.',text:'Líneas limpias. Detalles cuidados. Descubre relojes y accesorios para vivir a tu propio ritmo.'}},{id:'collection',type:'products',title:'Find your next signature.',text:'The considered collection',visible:true,de:{title:'Finden Sie Ihren Stil.',text:'Die ausgewählte Kollektion'},es:{title:'Encuentra tu próximo clásico.',text:'Una colección con intención'}}],products:[{id:'p1',name:'The Classic — Silver',category:'watches',price:189,stock:30,image:'/assets/classic.svg',description:'A clean, understated silhouette for everyday wear. Sample product: confirm specifications with the merchant before ordering.',active:true,badge:'BESTSELLER',de:{name:'The Classic — Silber',description:'Eine klare, dezente Silhouette für jeden Tag. Musterprodukt: Spezifikationen vor der Bestellung beim Händler bestätigen.'},es:{name:'The Classic — Plata',description:'Una silueta limpia y discreta para cada día. Producto de muestra: confirma las especificaciones con el vendedor antes de comprar.'}},{id:'p2',name:'The Chronograph — Noir',category:'watches',price:249,stock:16,image:'/assets/noir.svg',description:'A striking dial with a timeless profile. Sample product; specifications are not yet confirmed.',active:true,badge:'NEW',de:{name:'The Chronograph — Noir',description:'Ein markantes Zifferblatt mit zeitlosem Profil. Musterprodukt; Spezifikationen noch nicht bestätigt.'},es:{name:'The Chronograph — Noir',description:'Una esfera distintiva con un perfil atemporal. Producto de muestra; especificaciones pendientes de confirmar.'}},{id:'p3',name:'Everyday Leather Strap',category:'straps',price:39,stock:50,image:'/assets/strap.svg',description:'Refresh your everyday watch. Sample listing: please confirm lug width and compatibility before ordering.',active:true,badge:'',de:{name:'Lederarmband Everyday',description:'Ein neuer Look für Ihre Uhr. Musterangebot: Bandanstoß und Kompatibilität vor dem Kauf bestätigen.'},es:{name:'Correa de piel Everyday',description:'Renueva tu reloj. Anuncio de muestra: confirma el ancho y la compatibilidad antes de comprar.'}},{id:'p4',name:'Weekend Watch Case',category:'storage',price:59,stock:25,image:'/assets/case.svg',description:'A dedicated place for your favourite timepiece. Sample product; final images and specifications to be supplied.',active:true,badge:'EDITORS’ PICK',de:{name:'Uhrenetui Weekend',description:'Ein fester Platz für Ihre Lieblingsuhr. Musterprodukt; finale Bilder und Spezifikationen folgen.'},es:{name:'Estuche Weekend',description:'Un lugar para tu reloj favorito. Producto de muestra; imágenes y especificaciones finales pendientes.'}}]};
if(!db.prepare('SELECT id FROM content WHERE id=1').get()) db.prepare('INSERT INTO content VALUES (1,?,?)').run(JSON.stringify(seed),JSON.stringify(seed));
const password=process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
if(!process.env.ADMIN_PASSWORD) console.log(`临时管理员密码（重启后变化）: ${password}`);
const salt=randomBytes(16), hash=scryptSync(password,salt,64), sessions=new Map();
const content=(field)=>JSON.parse(db.prepare('SELECT draft,published FROM content WHERE id=1').get()[field]);
const save=(field,value)=>db.prepare(`UPDATE content SET ${field}=? WHERE id=1`).run(JSON.stringify(value));
function validate(c){
 if(!c||typeof c!=='object'||!Array.isArray(c.products)||!Array.isArray(c.categories)||!Array.isArray(c.sections)) throw Error('内容格式错误');
 for(const key of ['brand','announcement','title','subtitle','eyebrow','heroImage','accent']) if(typeof c[key]!=='string') throw Error('页面字段不完整');
 if(!/^#[0-9a-f]{6}$/i.test(c.accent)) throw Error('主题色需要使用六位十六进制颜色');
 for(const lang of ['de','es']) {
 const page=c.translations?.[lang];if(page&&(typeof page!=='object'||Object.values(page).some(v=>typeof v!=='string')))throw Error('Invalid page translations');
 for(const item of [...c.products,...c.sections])if(item[lang]&&(typeof item[lang]!=='object'||Object.values(item[lang]).some(v=>typeof v!=='string')))throw Error('Invalid translations');
 }
 const unique=(items)=>items.every(x=>typeof x.id==='string'&&x.id.length>0)&&new Set(items.map(x=>x.id)).size===items.length;
 if(!unique(c.categories)||!unique(c.products)||!unique(c.sections)) throw Error('编号必须唯一且不能为空');
 if(c.categories.some(x=>typeof x.name!=='string'||!x.name.trim())) throw Error('分类名称不能为空');
 if(c.sections.some(x=>!['text','products'].includes(x.type)||typeof x.title!=='string'||typeof x.text!=='string'||typeof x.visible!=='boolean')) throw Error('区块格式错误');
 const image=(s)=>typeof s==='string'&&(s===''||/^https:\/\//i.test(s)||/^\/[^/]/.test(s));
 if(!image(c.heroImage)) throw Error('图片地址须使用 HTTPS 或站内路径');
 for(const p of c.products) if(typeof p.name!=='string'||!p.name.trim()||!Number.isFinite(p.price)||p.price<0||p.price>1000000||!Number.isInteger(p.stock)||p.stock<0||!c.categories.some(x=>x.id===p.category)||!image(p.image)||typeof p.description!=='string'||typeof p.active!=='boolean'||typeof p.badge!=='string') throw Error('请检查商品名称、分类、价格、库存和图片');
 return c;
}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let str='';for await(const chunk of req){str+=chunk;if(Buffer.byteLength(str)>2e6) throw Error('请求过大');}return JSON.parse(str||'{}');}
const auth=(req)=>{const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);return token&&sessions.get(token)>Date.now();};
const attempts=new Map();
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
 const url=new URL(req.url,'http://localhost');
 try{
  if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`) return json(res,403,{error:'不允许跨站请求'});
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
   if(req.method==='GET'&&paymentRoute[2]==='payment'){const o=getOrder(id);return json(res,200,{id,total:o.details.total,currency:o.details.currency,payment:paymentView(getPayment(id))});}
   if(req.method==='POST')return await locked(id,async()=>{
    const existing=getPayment(id),o=getOrder(id);
    if(paymentRoute[2]==='transaction'){if(!existing||existing.provider!=='usdt')throw Error('No USDT payment found');if(existing.status==='paid')return json(res,200,{payment:paymentView(existing)});const b=await body(req);existing.submittedHash=transactionHash(b.transactionId);existing.status='awaiting_review';existing.submittedAt=new Date().toISOString();putPayment(id,existing);return json(res,200,{payment:paymentView(existing)});}

    if(paymentRoute[2]==='capture'){if(!existing||existing.provider!=='paypal')throw Error('No PayPal checkout found');if(existing.status!=='paid'){const transaction=await capturePayPal(existing,id,process.env);if(transaction)markPaid(id,transaction);}return json(res,200,{payment:paymentView(getPayment(id))});}
    const b=await body(req);if(!['paypal','usdt'].includes(b.provider))throw Error('Unknown payment method');
    if(existing){if(existing.provider!==b.provider)throw Error('This order already has a payment method');return json(res,200,{payment:paymentView(existing)});}
    if(!methods(paymentConfig(),process.env)[b.provider])throw Error('Payment method is not configured');
    const p=await createCheckout(o,paymentConfig(),process.env,b.provider);putPayment(id,p);return json(res,201,{payment:paymentView(p)});
   });
  }
  if(url.pathname==='/api/store'&&req.method==='GET'){const c=content(url.searchParams.has('preview')&&auth(req)?'draft':'published');c.products=c.products.filter(p=>p.active);return json(res,200,c);}
  if(url.pathname==='/api/orders'&&req.method==='POST'){
   const b=await body(req);if(typeof b.email!=='string'||!/^\S+@\S+\.\S+$/.test(b.email)||typeof b.country!=='string'||!b.country.trim()||typeof b.postalCode!=='string'||!b.postalCode.trim())throw Error('Email, country and postal code are required');
   if(!b.name?.trim()||!b.phone?.trim()||!b.address?.trim()||!Array.isArray(b.items)||!b.items.length||b.items.length>100)return json(res,400,{error:'Please complete your shipping information and select a product'});
   if([b.name,b.phone,b.address].some(x=>typeof x!=='string'||x.length>500))throw Error('Shipping information is too long');
   const c=content('published'),draft=content('draft'),seen=new Set();let total=0;
   const items=b.items.map(i=>{const p=c.products.find(p=>p.id===i.id&&p.active);if(seen.has(i.id)||!p||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>p.stock)throw Error('A product is unavailable or has insufficient stock. Please refresh and try again.');seen.add(i.id);total+=Math.round(p.price*100)*i.quantity;p.stock-=i.quantity;const d=draft.products.find(x=>x.id===p.id);if(d)d.stock=Math.max(0,d.stock-i.quantity);return{id:p.id,name:p.name,price:p.price,quantity:i.quantity};});
   const shipping=total>=15000?0:1200;const details={country:String(b.country||'').slice(0,100),postalCode:String(b.postalCode||'').slice(0,40),email:String(b.email||'').slice(0,200),currency:'USD',name:b.name.trim(),phone:b.phone.trim(),address:b.address.trim(),items,total:(total+shipping)/100,shipping:shipping/100,status:'Awaiting confirmation — unpaid'};const id='MY'+Date.now()+randomBytes(3).toString('hex');
   const accessToken=randomBytes(32).toString('hex');
   db.exec('BEGIN');try{save('published',c);save('draft',draft);db.prepare('INSERT INTO orders VALUES (?,?,?)').run(id,new Date().toISOString(),JSON.stringify(details));db.prepare('INSERT INTO order_access VALUES (?,?)').run(id,digest(accessToken));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,201,{id,...details,accessToken});
  }
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'不支持此方法'});
  const file=url.pathname==='/admin'?'admin.html':url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!['index.html','admin.html','app.js','admin.js','style.css','assets/hero.svg','assets/classic.svg','assets/noir.svg','assets/strap.svg','assets/case.svg'].includes(file)){res.writeHead(404);return res.end('Not found');}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[extname(file)]);res.end(readFileSync(resolve('public',file)));
 }catch(e){json(res,400,{error:e.message||'请求失败'});}
});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log('MERIDIAN 商城已启动，端口 '+(process.env.PORT||3000)));


// ---------- 兼容层：HTTP 非安全上下文没有 crypto.randomUUID / clipboard ----------
function uuid(){
  try{if(window.crypto&&typeof crypto.randomUUID==='function')return uuid();}catch{}
  const b=new Uint8Array(16);
  if(window.crypto&&crypto.getRandomValues)crypto.getRandomValues(b);
  else for(let i=0;i<16;i++)b[i]=Math.floor(Math.random()*256);
  b[6]=(b[6]&0x0f)|0x40; b[8]=(b[8]&0x3f)|0x80;
  const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
async function copyText(text){
  try{
    if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return true;}
  }catch{}
  try{
    const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');
    ta.style.position='fixed';ta.style.top='-1000px';document.body.append(ta);
    ta.select();ta.setSelectionRange(0,text.length);
    const ok=document.execCommand('copy');ta.remove();return ok;
  }catch{return false;}
}
const root=document.querySelector('#admin'),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let content,tab='dashboard',editLang='en',dirty=false,prodPage=1,prodOpen=new Set(),prodSel=new Set(),prodQuery='',prodCat='all',batchOpen=false;const PROD_PER=10;
async function api(path,options){const r=await fetch(path,options),d=await r.json();if(!r.ok)throw Error(d.error);return d;}
function toast(s){const t=document.querySelector('#toast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3500);}
function login(){root.innerHTML=`<div class="login"><a class="logo" href="/">MERIDIAN</a><p class="eyebrow">MERCHANT STUDIO</p><h1>欢迎回到工作室</h1><p>管理商品，打造你的品牌体验。</p><form id="login"><label>管理员密码<input type="password" name="password" required autocomplete="current-password"></label><label class="remember"><input type="checkbox" name="remember" value="1" checked> 在这台设备上保持登录 30 天</label><button class="button full">登录后台 →</button><p class="form-error" role="alert"></p></form><a href="/">← 返回商城</a></div>`;document.querySelector('#login').onsubmit=async e=>{e.preventDefault();try{await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify((()=>{const f=Object.fromEntries(new FormData(e.target));return {password:f.password,remember:f.remember==='1'};})())});await load();}catch(err){document.querySelector('.form-error').textContent=err.message;}};}
async function load(){try{content=await api('/api/admin/content');content.whatsapp??={enabled:false,phone:'',messages:{en:'',de:'',es:''}};dirty=false;render();}catch{login();}}
const input=(label,key,value,type='text')=>`<label>${label}<input type="${type}" data-key="${key}" value="${esc(value)}" ${type==='number'?'min="0" step="any"':''}></label>`;
const area=(label,key,value)=>`<label>${label}<textarea data-key="${key}" rows="3">${esc(value)}</textarea></label>`;
function pageData(){return editLang==='en'?content:(content.translations??={})[editLang]??=(({}));}
const LANG_LABEL={en:'English',de:'Deutsch',es:'Español'};
function localData(x){return editLang==='en'?x:(x[editLang]??={});}
function render(){root.innerHTML=`<aside class="sidebar"><a href="/" class="logo">${esc(content.brand)}</a><p class="eyebrow">MERCHANT STUDIO</p><a href="/" class="side-home" target="_blank" rel="noopener">← 返回商城首页</a>${[['dashboard','▦','数据看板'],['page','◈','页面设计'],['sitemap','◎','站点地图'],['policies','§','政策页面'],['products','▧','商品管理'],['categories','☷','商品分类'],['orders','▤','订单记录'],['payments','◇','支付设置'],['shipping','⛟','运费设置'],['mail','✉','通知邮件'],['customers','◉','用户管理'],['account','⚿','账号安全']].map(([id,icon,label])=>`<button data-tab="${id}" class="${tab===id?'active':''}">${icon}　${label}</button>`).join('')}<a href="/" target="_blank" rel="noopener">查看已发布商城 ↗</a><button id="logout">退出登录</button><p class="side-version" id="side-version"></p></aside><div class="studio"><div class="studio-top"><div><p class="eyebrow">YOUR BRAND, YOUR WAY</p><h1>${{dashboard:'数据看板',page:'页面设计',sitemap:'站点地图',policies:'政策页面',products:'商品管理',categories:'商品分类',orders:'订单记录',payments:'支付设置',shipping:'运费设置',mail:'通知邮件',customers:'用户管理',account:'账号安全'}[tab]}</h1><p class="muted">${tab==='dashboard'?'流量、加购、订单与单品浏览量的实时汇总，数据来自本机访问日志与订单库。':tab==='policies'?'隐私政策、服务条款、配送与退换政策。发布后自动出现在前台页脚，并提交到 sitemap。':tab==='sitemap'?'给搜索引擎的站点地图：只收录游客可见的商品，VIP / 会员专属商品不会写入。发布后自动更新。':tab==='orders'?'PayPal 由服务端确认付款；USDT 须人工核对链上记录后确认，买家提交哈希不代表到账。':tab==='mail'?'邮件设置保存后立即生效，不需要发布。':tab==='payments'?'支付设置保存后立即生效，独立于页面草稿。':tab==='shipping'?'运费规则保存后立即生效；已下单的订单保留当时算出的运费，可以在订单里单独改。':tab==='account'?'后台密码保存在数据库里，改完立即生效，不需要再 SSH 去 config.env 里找密码。':tab==='customers'?'会员等级修改后立即生效。':'编辑保存在草稿中，发布后才会显示在商城。'}</p></div><div class="actions"><a class="button outline" href="/" target="_blank" rel="noopener">← 商城首页</a>${!['dashboard','payments','orders','mail','customers','sitemap','account','shipping'].includes(tab)?`<a class="button outline" href="/?preview=1" target="_blank" rel="noopener">预览已保存草稿 ↗</a><button class="button outline" id="save">保存草稿</button><button class="button" id="publish">保存并发布 ↗</button>`:''}</div></div><div class="studio-toolbar"><span id="save-state">${dirty?'● 有未保存更改':'✓ 草稿已载入'}</span>${!['dashboard','orders','payments','mail','customers','sitemap','shipping'].includes(tab)?`<label>编辑内容语言 <select id="edit-lang"><option value="en">English</option><option value="de">Deutsch</option><option value="es">Español</option></select></label>`:''}</div><div id="editor"></div></div>`;
 root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render();});document.querySelector('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'});login();};if(document.querySelector('#edit-lang')){document.querySelector('#edit-lang').value=editLang;document.querySelector('#edit-lang').onchange=e=>{editLang=e.target.value;render();};}if(document.querySelector('#save'))document.querySelector('#save').onclick=()=>save(false);if(document.querySelector('#publish'))document.querySelector('#publish').onclick=()=>save(true);editor();}
function changed(){dirty=true;document.querySelector('#save-state').textContent='● 有未保存更改';}
async function save(publish){const buttons=[...document.querySelectorAll('#save,#publish')];buttons.forEach(b=>b.disabled=true);try{await api('/api/admin/content',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(content)});if(publish)await api('/api/admin/publish',{method:'POST'});dirty=false;document.querySelector('#save-state').textContent=publish?'✓ 已发布':'✓ 草稿已保存';toast(publish?'已发布，商城内容已更新':'草稿已保存');}catch(e){toast(e.message);}finally{buttons.forEach(b=>b.disabled=false);}}
function bind(container,obj){container.querySelectorAll('[data-key]').forEach(el=>el.oninput=()=>{obj[el.dataset.key]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;changed();});}

// ---------- 数据看板 ----------
let dashDays=14,dashMode='day';
function pct(a,b){if(!b)return a?100:0;return Number(((a-b)/b*100).toFixed(1));}
function delta(cur,prev){const d=pct(cur,prev);if(!prev&&!cur)return '<span class="delta flat">—</span>';const cls=d>0?'up':d<0?'down':'flat';const sign=d>0?'+':'';return `<span class="delta ${cls}">${sign}${d}% 较昨日</span>`;}
function lineChart(series,{w=820,h=200}={}){
 const pad=26,max=Math.max(1,...series.map(s=>Math.max(s.pv,s.uv)));
 const step=series.length>1?(w-pad*2)/(series.length-1):0;
 const x=i=>pad+i*step,y=v=>h-pad-(v/max)*(h-pad*2);
 const path=key=>series.map((s,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ');
 const area=`M${x(0)},${h-pad} `+series.map((s,i)=>`L${x(i).toFixed(1)},${y(s.pv).toFixed(1)}`).join(' ')+` L${x(series.length-1)},${h-pad} Z`;
 const grid=[0,.25,.5,.75,1].map(f=>`<line x1="${pad}" x2="${w-pad}" y1="${(h-pad-f*(h-pad*2)).toFixed(1)}" y2="${(h-pad-f*(h-pad*2)).toFixed(1)}" class="grid"/>`).join('');
 const labels=series.map((s,i)=>(i%Math.ceil(series.length/7)===0||i===series.length-1)?`<text x="${x(i).toFixed(1)}" y="${h-6}" class="axis">${s.day?s.day.slice(5):(String(s.hour).padStart(2,'0')+':00')}</text>`:'').join('');
 return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="访客趋势">${grid}<path d="${area}" class="area"/><path d="${path('pv')}" class="line pv"/><path d="${path('uv')}" class="line uv"/>${labels}</svg>`;
}
async function dashboard(el){
 el.innerHTML='<p class="muted">正在统计…</p>';
 let d;
 try{d=await api('/api/admin/analytics?days='+dashDays+(dashMode==='hour'?'&mode=hour':''));}
 catch(e){el.innerHTML=`<p class="form-error">${esc(e.message)}</p>`;return;}
 const t=d.today,y=d.yesterday;
 const cards=[
  ['今日访客',t.uv,delta(t.uv,y.uv)],
  ['浏览量',t.pv,delta(t.pv,y.pv)],
  ['加购次数',t.addcarts,delta(t.addcarts,y.addcarts)],
  ['今日订单',t.orders,delta(t.orders,y.orders)+`<span class="delta flat">转化率 ${t.conversion}%</span>`],
  ['付款人数',t.payers,delta(t.payers,y.payers)],
  ['销售额',`$${t.revenue.toFixed(2)}`,delta(t.revenue,y.revenue)],
 ];
 const series=dashMode==='hour'?d.hours:d.series;
 const maxOrders=Math.max(1,...d.series.map(x=>x.orders));
 const orderBars=d.series.map(x=>`<div class="bar-col" title="${x.day} · ${x.orders} 单 · $${x.revenue}"><div class="bar" style="height:${Math.round(x.orders/maxOrders*100)}%"></div><span>${x.day.slice(5)}</span></div>`).join('');
 const srcRows=d.sources.length?d.sources.map(s=>`<div class="src-row"><span class="src-name">${({direct:'直接访问',search:'搜索引擎',social:'社交媒体',email:'邮件',referral:'外部链接'})[s.source]||s.source}</span><div class="src-bar"><i style="width:${s.share}%"></i></div><span class="src-val">${s.pv} · ${s.share}%</span></div>`).join(''):'<p class="muted">还没有流量数据。</p>';
 const prodRows=d.topProducts.length?d.topProducts.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.views}</td><td>${p.addcarts}</td><td>${p.orders}</td><td>$${p.revenue.toFixed(2)}</td></tr>`).join(''):'<tr><td colspan="5" class="muted">暂无单品数据</td></tr>';
 el.innerHTML=`
 <div class="kpi-grid">${cards.map(([label,val,extra])=>`<div class="kpi"><p class="kpi-label">${label}</p><strong>${val}</strong>${extra}</div>`).join('')}</div>
 <section class="panel">
  <div class="panel-heading"><h2>访客趋势</h2><div class="seg">${[7,14,30].map(n=>`<button data-days="${n}" class="${dashDays===n?'on':''}">${n} 天</button>`).join('')}<button data-mode="day" class="${dashMode==='day'?'on':''}">按天</button><button data-mode="hour" class="${dashMode==='hour'?'on':''}">今日分时</button></div></div>
  <div class="legend"><span class="dot pv"></span>浏览量 PV<span class="dot uv"></span>访客 UV</div>
  ${lineChart(series)}
  <p class="muted">区间合计：浏览量 ${d.totals.pv} · 加购 ${d.totals.addcarts} · 订单 ${d.totals.orders} · 销售额 $${d.totals.revenue.toFixed(2)}</p>
 </section>
 <div class="dash-2col">
  <section class="panel"><div class="panel-heading"><h2>单量趋势</h2><span class="muted">按天</span></div><div class="bars">${orderBars}</div></section>
  <section class="panel"><div class="panel-heading"><h2>客户来源</h2><span class="muted">按访问</span></div>${srcRows}</section>
 </div>
 <section class="panel"><div class="panel-heading"><h2>单品浏览量</h2><span class="muted">近 ${dashDays} 天</span></div>
  <table class="data-table"><thead><tr><th>商品</th><th>浏览</th><th>加购</th><th>订单</th><th>销售额</th></tr></thead><tbody>${prodRows}</tbody></table>
 </section>`;
 el.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{dashDays=Number(b.dataset.days);dashboard(el);});
 el.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{dashMode=b.dataset.mode;dashboard(el);});
}

function editor(){const el=document.querySelector('#editor');if(tab==='dashboard'){dashboard(el);return;}if(tab==='policies'){
 const pages=content.pages||(content.pages=[]);
 const l=editLang==='en'?null:editLang;
 el.innerHTML=`<div class="panel-heading"><p>这四个页面会自动挂到前台页脚，并写进 sitemap。正文用空行分段；方括号里的占位内容请换成你自己的公司信息。</p><button class="button" id="new-page">＋ 添加页面</button></div>
 ${pages.map((pg,i)=>{const lv=l?(pg[l]??={}):pg;return `<section class="panel policy-editor" data-i="${i}">
   <div class="panel-heading"><h2>/${esc(pg.id)}</h2><div class="prod-bar-actions"><a class="button outline mini" href="/${esc(pg.id)}" target="_blank" rel="noopener">预览 ↗</a><button class="del" data-del-page="${i}">删除</button></div></div>
   <label>页面地址（小写字母、数字、连字符）<input data-page="id" value="${esc(pg.id)}" maxlength="40"></label>
   <div class="localized"><label>标题<input data-key="title" value="${esc(lv.title??'')}" maxlength="140"></label><label>正文（空行分段）<textarea data-key="body" rows="14">${esc(lv.body??'')}</textarea></label></div>
  </section>`;}).join('')}`;
 el.querySelectorAll('.policy-editor').forEach(sec=>{
  const pg=pages[+sec.dataset.i];
  sec.querySelector('[data-page=id]').oninput=e=>{pg.id=e.target.value.replace(/[^a-z0-9-]/g,'').toLowerCase();changed();};
  bind(sec.querySelector('.localized'), l?(pg[l]??={}):pg);
 });
 el.querySelectorAll('[data-del-page]').forEach(b=>b.onclick=()=>{if(!confirm('删除这个页面？'))return;pages.splice(+b.dataset.delPage,1);changed();editor();});
 document.querySelector('#new-page').onclick=()=>{pages.push({id:'new-page-'+pages.length,title:'New page',body:''});changed();editor();};
 return;
}
if(tab==='sitemap'){el.innerHTML='<p class="muted">正在生成…</p>';api('/api/admin/sitemap').then(d=>{
  el.innerHTML=`<section class="panel"><div class="panel-heading"><h2>sitemap.xml</h2><div class="prod-bar-actions"><button class="button outline mini" id="sm-refresh">刷新</button><button class="button outline mini" id="sm-download">下载</button></div></div>
   <p class="muted">站点地图只收录<strong>游客可见</strong>的页面与商品。标记为「会员」或「VIP」的商品，以及这些等级下的分类，都不会写入——避免搜索引擎把受限商品暴露给普通访客。</p>
   <div class="sm-stat"><div><span>收录网址</span><strong>${d.count}</strong></div><div><span>公开商品</span><strong>${d.products.length}</strong></div><div><span>已排除受限商品</span><strong>${d.excluded}</strong></div></div>
   ${d.url?`<label>提交给搜索引擎的地址<div class="link-row"><input readonly value="${esc(d.url)}"><button type="button" id="sm-copy">复制</button><a class="button outline mini" href="${esc(d.url)}" target="_blank" rel="noopener">打开 ↗</a></div></label>`:'<p class="muted">未设置 PUBLIC_BASE_URL，无法生成绝对地址。请在服务器配置里填写站点域名后重启。</p>'}
   <label>内容预览（只读）<textarea class="xml-preview" readonly rows="12">${esc((d.xml||'').replace(/></g,'>\n<'))}</textarea></label>
   ${d.products.length?`<p class="muted">已收录：${d.products.map(p=>esc(p.name)).join(' · ')}</p>`:''}
  </section>`;
  const copy=el.querySelector('#sm-copy');if(copy)copy.onclick=async()=>{const v=el.querySelector('.link-row input').value;try{await copyText(v);toast('已复制');}catch{toast('复制失败，请手动选择');}};
  const dl=el.querySelector('#sm-download');if(dl)dl.onclick=()=>{const blob=new Blob([d.xml||''],{type:'application/xml'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='sitemap.xml';a.click();URL.revokeObjectURL(a.href);};
  el.querySelector('#sm-refresh').onclick=()=>editor();
 }).catch(e=>{el.innerHTML=`<p class="muted">${esc(e.message)}</p>`;});return;}
if(tab==='page'){const p=pageData();el.innerHTML=`<section class="panel"><h2>品牌与首页</h2><p class="muted">英文为默认内容，未填写的翻译会显示英文。图片使用 HTTPS 地址；首页图片与品牌设置为三种语言共用。</p><div id="global" class="form-grid">${input('品牌名称','brand',content.brand)}${input('主题色','accent',content.accent,'color')}${input('首页主图 URL','heroImage',content.heroImage)}<label class="check">上传首页主图（PNG/JPG/WebP ≤5MB，建议 1600×1200 以上）<input type="file" accept="image/png,image/jpeg,image/webp" data-hero-upload></label></div><div class="favicon-editor"><p class="muted">站点图标（favicon：浏览器标签页 / 收藏夹 / 手机桌面）。建议 512×512 正方形 PNG 或 SVG；留空或点「恢复默认」使用 MERIDIAN 默认图标。</p><div class="favicon-row"><img id="favicon-preview" src="${esc(content.favicon||'/assets/favicon.svg')}" alt="站点图标预览"><input data-key="favicon" class="favicon-url" placeholder="/assets/favicon.svg 或 https://…" value="${esc(content.favicon||'')}"><label class="check file-check">上传图标<input type="file" accept="image/png,image/jpeg,image/webp" data-favicon-upload></label><button type="button" class="button outline mini" data-favicon-reset>恢复默认</button></div></div><div id="local" class="form-grid">${input('顶部公告','announcement',p.announcement??'')}${input('主视觉眉题','eyebrow',p.eyebrow??'')}${input('首页标题','title',p.title??'')}${area('首页副标题','subtitle',p.subtitle??'')}${input('服务文案 1','promise1',p.promise1??'')}${input('服务文案 2','promise2',p.promise2??'')}${input('服务文案 3','promise3',p.promise3??'')}${input('底部展示标题','closingTitle',p.closingTitle??'')}${area('底部展示文案','closingText',p.closingText??'')}${input('底部链接文字','closingLink',p.closingLink??'')}${input('页脚文案','footer',p.footer??'')}</div></section><section class="panel"><h2>WhatsApp 悬浮联系按钮</h2><p class="muted">按钮固定在前台右下角，滚动时保持可见。填写国际号码并启用后，保存草稿可预览，发布后客户才能看到。</p><div id="whatsapp-global"><label class="check"><input type="checkbox" data-key="enabled" ${content.whatsapp.enabled?'checked':''}>显示 WhatsApp 联系按钮</label>${input('WhatsApp 号码（含国家区号，例如 +44…）','phone',content.whatsapp.phone,'tel')}</div><div id="whatsapp-local">${area('客户打开聊天时的预填消息（当前语言）','message',content.whatsapp.messages[editLang])}</div></section><section class="panel"><div class="panel-heading"><h2>页面区块</h2><div><button id="add-text" class="button outline">＋ 图文区块</button> <button id="add-products" class="button outline" ${content.sections.some(s=>s.type==='products')?'disabled':''}>＋ 商品区块</button></div></div><p class="muted">可编辑区块文案、显示状态与顺序。商品区块最多一个。</p><div id="sections"></div></section>`;const favUp=document.querySelector('[data-favicon-upload]');if(favUp)favUp.onchange=async()=>{const f=favUp.files&&favUp.files[0];if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type))return toast('只支持 PNG / JPEG / WebP');if(f.size>2*1024*1024)return toast('图标建议小于 2MB');try{const data=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=()=>rej(Error('读取失败'));fr.readAsDataURL(f);});const r=await fetch('/api/admin/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});const j=await r.json();if(!r.ok)throw Error(j.error||'上传失败');content.favicon=j.url;changed();editor();toast('图标已上传，保存并发布后生效');}catch(e){toast(e.message);}};const favReset=document.querySelector('[data-favicon-reset]');if(favReset)favReset.onclick=()=>{delete content.favicon;changed();editor();toast('已恢复默认图标');};const favInput=document.querySelector('[data-key=favicon]');if(favInput)favInput.oninput=e=>{const img=document.querySelector('#favicon-preview');if(img)img.src=e.target.value||'/assets/favicon.svg';};const heroUp=document.querySelector('[data-hero-upload]');if(heroUp)heroUp.onchange=async()=>{const f=heroUp.files&&heroUp.files[0];if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type))return toast('只支持 PNG / JPEG / WebP');if(f.size>5*1024*1024)return toast('图片不能超过 5MB');try{const data=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=()=>rej(Error('读取失败'));fr.readAsDataURL(f);});const r=await fetch('/api/admin/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});const j=await r.json();if(!r.ok)throw Error(j.error||'上传失败');content.heroImage=j.url;changed();editor();toast('首页主图已上传');}catch(e){toast(e.message);}};
bind(document.querySelector('#global'),content);bind(document.querySelector('#local'),p);bind(document.querySelector('#whatsapp-global'),content.whatsapp);document.querySelector('#whatsapp-local textarea').oninput=e=>{content.whatsapp.messages[editLang]=e.target.value;changed();};const list=document.querySelector('#sections');content.sections.forEach((s,i)=>{const d=document.createElement('div');d.className='section-editor';const l=localData(s);d.innerHTML=`<div class="panel-heading"><strong>${s.type==='text'?'文字区块':'商品列表'}</strong><div><button data-up ${i===0?'disabled':''}>↑</button><button data-down ${i===content.sections.length-1?'disabled':''}>↓</button><button data-delete>删除</button></div></div><label class="check"><input data-visible type="checkbox" ${s.visible?'checked':''}>显示区块</label>${input('标题','title',l.title??'')}${area('正文 / 副标题','text',l.text??'')}`;list.append(d);bind(d,l);d.querySelector('[data-visible]').onchange=e=>{s.visible=e.target.checked;changed();};d.querySelector('[data-up]').onclick=()=>{[content.sections[i-1],content.sections[i]]=[s,content.sections[i-1]];changed();editor();};d.querySelector('[data-down]').onclick=()=>{[content.sections[i+1],content.sections[i]]=[s,content.sections[i+1]];changed();editor();};d.querySelectorAll('[data-copy-cat]').forEach(b=>b.onclick=async()=>{const input=b.closest('.link-row').querySelector('input');try{await copyText(input.value);toast('链接已复制');}catch{input.select();document.execCommand('copy');toast('链接已复制');}});d.querySelector('[data-delete]').onclick=()=>{content.sections.splice(i,1);changed();editor();};});const add=type=>{content.sections.push({id:uuid(),type,title:'New section',text:'',visible:true});changed();editor();};document.querySelector('#add-text').onclick=()=>add('text');document.querySelector('#add-products').onclick=()=>add('products');}
 if(tab==='products'){
 const q=prodQuery.trim().toLowerCase();
 const matched=content.products.filter(p=>{
  if(prodCat!=='all'&&p.category!==prodCat)return false;
  if(!q)return true;
  const cat=(content.categories.find(c=>c.id===p.category)||{}).name||'';
  const hay=[p.name,p.badge,p.id,cat,p.de&&p.de.name,p.es&&p.es.name,String(p.price)].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
 });
 const total=content.products.length,shown=matched.length,pages=Math.max(1,Math.ceil(shown/PROD_PER));if(prodPage>pages)prodPage=pages;
 const pageItems=matched.slice((prodPage-1)*PROD_PER,prodPage*PROD_PER);
 const selItems=content.products.filter(p=>prodSel.has(p.id));
 const catName=id=>(content.categories.find(c=>c.id===id)||{}).name||'—';
 const lvName=p=>({vip:'VIP',normal:'会员'}[p.access]||'公开');
 const priceCell=p=>Number(p.compareAt||0)>Number(p.price)?`<strong>$${Number(p.price).toFixed(2)}</strong><br><s class="muted">$${Number(p.compareAt).toFixed(2)}</s>`:`$${Number(p.price||0).toFixed(2)}`;
 const editorRow=p=>{
  const l=localData(p);
  return `<tr class="editor-row"><td colspan="9"><div class="product-form"><img src="${esc(p.image)}" alt="商品预览"><div>
   <div class="localized">${editLang!=='en'?`<p class="tr-hint">正在编辑 <strong>${LANG_LABEL[editLang]}</strong> 译文：填了这里，前台切到该语言就显示这段；留空自动回退英文。<button type="button" class="mini" data-copy-en="name">名称从英文复制</button><button type="button" class="mini" data-copy-en="description">描述从英文复制</button></p>`:''}${input('商品名称','name',l.name??'')}${area('商品描述','description',l.description??'')}</div>
   <div class="shared form-grid">
    ${input('售价 USD（前台显示）','price',p.price,'number')}
    ${input('原价 USD（划线价，留空无折扣）','compareAt',p.compareAt||'','number')}
    ${input('库存（整数）','stock',p.stock,'number')}
    ${input('图片 URL','image',p.image)}
    <label class="check">上传图片（PNG/JPG/WebP，≤5MB）<input type="file" accept="image/png,image/jpeg,image/webp" data-upload></label>
    <div class="gallery-editor"><p class="muted">图集（最多 8 张，可多选上传）</p><div class="gallery-thumbs">${(p.images||[]).map((u,i)=>`<figure><img src="${esc(u)}" alt=""><button type="button" data-rm="${i}" aria-label="移除">×</button><button type="button" data-main="${i}">设为主图</button></figure>`).join('')}</div><label class="check">添加图集图片<input type="file" accept="image/png,image/jpeg,image/webp" multiple data-upload-multi></label></div>
    ${input('标签（共用）','badge',p.badge)}
    <label>分类<select data-key="category">${content.categories.map(c=>`<option value="${esc(c.id)}" ${p.category===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
    <div class="spec-grid"><p class="muted spec-title">规格（只填你要展示的，留空的不会显示）</p>
     ${[['caseSize','表径（如 40 mm）'],['movement','机芯（如 Japanese quartz）'],['waterResistance','防水（如 5 ATM）'],['lugWidth','表带宽度（如 20 mm）'],['crystal','表镜（如 Sapphire）'],['weight','重量（如 78 g）']].map(([k,label])=>`<label>${label}<input data-spec="${k}" maxlength="120" value="${esc((p.specs||{})[k]||'')}"></label>`).join('')}
    </div>
    <label>观看等级<select data-key="access"><option value="all" ${(p.access||'all')==='all'?'selected':''}>公开 · 所有人可见</option><option value="normal" ${p.access==='normal'?'selected':''}>登录会员 · 普通用户及以上</option><option value="vip" ${p.access==='vip'?'selected':''}>VIP 会员专属</option></select></label>
    <label>商品链接<div class="link-row"><input readonly value="${location.origin}/?product=${encodeURIComponent(p.id)}"><button type="button" data-copy-link>复制</button></div></label>
    <label class="check"><input type="checkbox" data-key="active" ${p.active?'checked':''}>上架商品（前台显示）</label>
   </div></div></div></td></tr>`;
 };
 el.innerHTML=`<div class="panel-heading"><p>共 ${total} 件商品，每页 ${PROD_PER} 件。价格以 USD 计价，订单使用服务器核定的价格与库存。</p><button class="button" id="new-product">＋ 添加商品</button></div>
 <div class="prod-bar">
  <div class="prod-bar-actions">
   <input id="prod-search" class="prod-search" type="search" placeholder="搜索名称 / 标签 / 编号 / 分类" value="${esc(prodQuery)}">
   <select id="prod-cat" class="mini">${`<option value="all">全部分类</option>`+content.categories.map(c=>`<option value="${esc(c.id)}" ${prodCat===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
   <span class="muted">${q||prodCat!=='all'?`筛选出 ${shown} 件 / 共 ${total} 件`:`共 ${total} 件`}</span>
  </div>
  <div class="prod-bar-actions"><button class="button outline" id="prev-page" ${prodPage<=1?'disabled':''}>← 上一页</button><span class="muted">第 ${prodPage}/${pages} 页</span><button class="button outline" id="next-page" ${prodPage>=pages?'disabled':''}>下一页 →</button></div>
 </div>
 <div class="prod-bar">
  <div class="prod-bar-actions"><button class="button outline" id="batch-on" ${prodSel.size?'':'disabled'}>批量上架</button><button class="button outline" id="batch-off" ${prodSel.size?'':'disabled'}>批量下架</button><button class="button outline" id="batch-edit" ${prodSel.size?'':'disabled'}>批量改价 / 权限</button><button class="button outline" id="batch-del" ${prodSel.size?'':'disabled'}>批量删除</button><span class="muted">已选 ${prodSel.size}</span></div>
 </div>
 ${batchOpen&&prodSel.size?`<div class="panel batch-panel"><h3>批量修改 ${prodSel.size} 件商品</h3><div class="form-grid">
   <label>统一售价 USD<input id="batch-price" type="number" min="0" step="0.01" placeholder="留空不改"></label>
   <label>统一原价 USD<input id="batch-compare" type="number" min="0" step="0.01" placeholder="留空不改，填 0 清除划线价"></label>
   <label>统一观看权限<select id="batch-access"><option value="">不改</option><option value="all">公开</option><option value="normal">会员</option><option value="vip">VIP</option></select></label>
   <label>把英文名称/描述复制到${LANG_LABEL[editLang]}（只填充未翻译的）<button type="button" class="button outline mini" id="batch-copy-lang">应用到 ${prodSel.size} 件</button></label>
   <label>统一上架状态<select id="batch-active"><option value="">不改</option><option value="1">上架</option><option value="0">下架</option></select></label>
  </div><div class="batch-actions"><button class="button" id="batch-apply">应用到 ${prodSel.size} 件</button><button class="button outline" id="batch-cancel">取消</button></div></div>`:''}
 <div class="panel prod-table-wrap"><table class="prod-table"><thead><tr><th class="c-check"><input type="checkbox" id="check-all" ${pageItems.length&&pageItems.every(p=>prodSel.has(p.id))?'checked':''}></th><th>图片</th><th>名称</th><th>价格</th><th>库存</th><th>分类</th><th>权限</th><th>状态</th><th class="c-ops">操作</th></tr></thead><tbody>
 ${pageItems.map(p=>`<tr class="${prodOpen.has(p.id)?'open':''}">
  <td class="c-check"><input type="checkbox" data-sel="${esc(p.id)}" ${prodSel.has(p.id)?'checked':''}></td>
  <td><a href="/?product=${encodeURIComponent(p.id)}" target="_blank" rel="noopener" title="在新标签打开商品页"><img class="thumb" src="${esc(p.image)}" alt="" loading="lazy"></a></td>
  <td><a class="prod-name-link" href="/?product=${encodeURIComponent(p.id)}" target="_blank" rel="noopener" title="在新标签打开商品页"><strong>${esc(p.name||'新商品')}</strong></a>${p.badge?`<br><small class="muted">${esc(p.badge)}</small>`:''}${editLang!=='en'&&!(p[editLang]&&p[editLang].name)?`<br><small class="miss-tr">缺${LANG_LABEL[editLang]}译文</small>`:''}</td>
  <td>${priceCell(p)}</td>
  <td>${Number(p.stock||0)}</td>
  <td>${esc(catName(p.category))}</td>
  <td><select class="mini" data-access="${esc(p.id)}"><option value="all" ${(p.access||'all')==='all'?'selected':''}>公开</option><option value="normal" ${p.access==='normal'?'selected':''}>会员</option><option value="vip" ${p.access==='vip'?'selected':''}>VIP</option></select></td>
  <td><button class="pill ${p.active?'on':''}" data-active="${esc(p.id)}">${p.active?'显示中':'已关闭'}</button></td>
  <td class="c-ops"><button class="button outline mini" data-edit="${esc(p.id)}">${prodOpen.has(p.id)?'收起':'编辑'}</button><a class="mini-link" href="/?product=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">预览 ↗</a><button class="del" data-del="${esc(p.id)}">删除</button></td>
 </tr>${prodOpen.has(p.id)?editorRow(p):''}`).join('')}
 </tbody></table>${pageItems.length?'':`<p class="muted" style="padding:24px">${q||prodCat!=='all'?'没有符合条件的商品，试试换个关键词或分类。':'还没有商品，点右上角「添加商品」。'}</p>`}</div>`;

 const go=n=>{prodPage=Math.max(1,Math.min(pages,n));editor();};
 const search=document.querySelector('#prod-search');
 search.oninput=()=>{prodQuery=search.value;prodPage=1;const pos=search.selectionStart;editor();const el2=document.querySelector('#prod-search');if(el2){el2.focus();try{el2.setSelectionRange(pos,pos);}catch{}}};
 document.querySelector('#prod-cat').onchange=e=>{prodCat=e.target.value;prodPage=1;editor();};
 document.querySelector('#prev-page').onclick=()=>go(prodPage-1);
 document.querySelector('#next-page').onclick=()=>go(prodPage+1);
 document.querySelector('#check-all').onchange=e=>{pageItems.forEach(p=>e.target.checked?prodSel.add(p.id):prodSel.delete(p.id));editor();};
 el.querySelectorAll('[data-sel]').forEach(cb=>cb.onchange=()=>{cb.checked?prodSel.add(cb.dataset.sel):prodSel.delete(cb.dataset.sel);editor();});
 el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const id=b.dataset.edit;prodOpen.has(id)?prodOpen.delete(id):prodOpen.add(id);editor();});
 el.querySelectorAll('[data-active]').forEach(b=>b.onclick=()=>{const p=content.products.find(x=>x.id===b.dataset.active);p.active=!p.active;changed();editor();});
 el.querySelectorAll('[data-access]').forEach(sel=>sel.onchange=()=>{const p=content.products.find(x=>x.id===sel.dataset.access);p.access=sel.value;changed();editor();});
 el.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{const id=b.dataset.del;if(!confirm('确定从草稿删除此商品？'))return;content.products=content.products.filter(x=>x.id!==id);prodSel.delete(id);prodOpen.delete(id);changed();editor();});
 document.querySelector('#batch-on').onclick=()=>{content.products.forEach(p=>{if(prodSel.has(p.id))p.active=true;});changed();editor();};
 document.querySelector('#batch-off').onclick=()=>{content.products.forEach(p=>{if(prodSel.has(p.id))p.active=false;});changed();editor();};
 document.querySelector('#batch-edit').onclick=()=>{batchOpen=true;editor();};
 document.querySelector('#batch-cancel')?.addEventListener('click',()=>{batchOpen=false;editor();});
 document.querySelector('#batch-copy-lang')?.addEventListener('click',()=>{
   if(editLang==='en')return toast('当前编辑语言是 English，无需复制');
   let n=0;
   for(const p of content.products){if(!prodSel.has(p.id))continue;const l=p[editLang]||(p[editLang]={});if(l.name)continue;l.name=p.name||'';if(!l.description)l.description=p.description||'';n++;}
   changed();editor();toast(n?`已为 ${n} 件商品填入 ${LANG_LABEL[editLang]}（沿用英文，可再逐条修改）`:'选中商品都已经有译文了');
  });
  document.querySelector('#batch-apply')?.addEventListener('click',()=>{
  const priceRaw=document.querySelector('#batch-price').value.trim();
  const cmpRaw=document.querySelector('#batch-compare').value.trim();
  const access=document.querySelector('#batch-access').value;
  const active=document.querySelector('#batch-active').value;
  if(!priceRaw&&!cmpRaw&&!access&&!active)return toast('没有要修改的内容');
  const price=priceRaw===''?null:Number(priceRaw),cmp=cmpRaw===''?null:Number(cmpRaw);
  if(price!==null&&(!Number.isFinite(price)||price<0))return toast('售价必须是非负数字');
  if(cmp!==null&&(!Number.isFinite(cmp)||cmp<0))return toast('原价必须是非负数字');
  let cleared=0;
  selItems.forEach(p=>{
   if(price!==null)p.price=price;
   if(cmp!==null){if(cmp===0)delete p.compareAt;else p.compareAt=cmp;}
   if(Number(p.compareAt||0)&&Number(p.compareAt)<=Number(p.price)){delete p.compareAt;cleared++;}
   if(access)p.access=access;
   if(active==='1')p.active=true;else if(active==='0')p.active=false;
  });
  batchOpen=false;changed();editor();
  toast(`已修改 ${selItems.length} 件${cleared?`（${cleared} 件原价低于售价，已清除划线价）`:''}`);
 });
 document.querySelector('#batch-del').onclick=()=>{if(!confirm(`确定删除选中的 ${prodSel.size} 件商品？`))return;content.products=content.products.filter(p=>!prodSel.has(p.id));prodSel.clear();changed();editor();};
 document.querySelector('#new-product').onclick=()=>{if(!content.categories.length)return toast('请先添加商品分类');content.products.unshift({id:uuid(),name:'New product',description:'',price:0,stock:0,image:'',badge:'',category:content.categories[0].id,access:'all',active:true});prodPage=1;changed();editor();toast('已添加，默认上架。填好名称/价格/图片后点「保存并发布」');};

 // 行内编辑器绑定
 pageItems.filter(p=>prodOpen.has(p.id)).forEach(p=>{
  const row=el.querySelector(`[data-access="${p.id}"]`)?.closest('tr')?.nextElementSibling;
  if(!row||!row.classList.contains('editor-row'))return;
  const l=localData(p);
  bind(row.querySelector('.localized'),l);
  bind(row.querySelector('.shared'),p);
  row.querySelectorAll('[data-spec]').forEach(inp=>inp.oninput=()=>{p.specs=p.specs||{};const v=inp.value.trim();if(v)p.specs[inp.dataset.spec]=v;else delete p.specs[inp.dataset.spec];if(!Object.keys(p.specs).length)delete p.specs;changed();});
  row.querySelectorAll('[data-copy-link]').forEach(b=>b.onclick=async()=>{const input=b.closest('.link-row').querySelector('input');try{await copyText(input.value);toast('链接已复制');}catch{input.select();document.execCommand('copy');toast('链接已复制');}});
  row.querySelectorAll('[data-copy-en]').forEach(btn=>btn.onclick=()=>{
   const key=btn.dataset.copyEn;const val=p[key]||'';
   if(!val)return toast('英文内容为空，无法复制');
   if(l[key]&&l[key]!==val&&!confirm('这里已经有译文，确定用英文覆盖吗？'))return;
   l[key]=val;
   const box=row.querySelector('.localized');
   bind(box,l);changed();
   const field=box.querySelector(`[data-key="${key}"]`);if(field){field.value=val;field.focus();}
   toast(`已复制英文${key==='name'?'名称':'描述'}，可继续修改成${LANG_LABEL[editLang]}`);
  });
  const up=row.querySelector('[data-upload]');
  if(up)up.onchange=async()=>{const f=up.files&&up.files[0];if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type))return toast('只支持 PNG / JPEG / WebP');if(f.size>5*1024*1024)return toast('图片不能超过 5MB');try{const data=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=()=>rej(Error('读取失败'));fr.readAsDataURL(f);});const r=await fetch('/api/admin/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});const j=await r.json();if(!r.ok)throw Error(j.error||'上传失败');p.image=j.url;changed();editor();toast('图片已上传');}catch(e){toast(e.message);}};
  const multi=row.querySelector('[data-upload-multi]');
  if(multi)multi.onchange=async()=>{const files=[...(multi.files||[])];if(!files.length)return;p.images=p.images||[];const room=8-p.images.length;if(files.length>room)return toast('图集最多 8 张，还能加 '+room+' 张');try{const datas=await Promise.all(files.map(f=>new Promise((res,rej)=>{if(!['image/png','image/jpeg','image/webp'].includes(f.type))return rej(Error('只支持 PNG / JPEG / WebP'));if(f.size>5*1024*1024)return rej(Error('单张不能超过 5MB'));const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=()=>rej(Error('读取失败'));fr.readAsDataURL(f);})));const r=await fetch('/api/admin/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:datas})});const j=await r.json();if(!r.ok)throw Error(j.error||'上传失败');p.images=p.images.concat(j.urls);changed();editor();toast('已添加 '+j.urls.length+' 张');}catch(e){toast(e.message);}};
  row.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{p.images.splice(+b.dataset.rm,1);if(!p.images.length)delete p.images;changed();editor();});
  row.querySelectorAll('[data-main]').forEach(b=>b.onclick=()=>{const idx=+b.dataset.main,url=p.images[idx],old=p.image;p.images.splice(idx,1);if(old)p.images.push(old);p.image=url;changed();editor();});
 });
}
if(tab==='categories'){el.innerHTML=`<section class="panel"><div class="panel-heading"><h2>分类导航</h2><button class="button" id="new-category">＋ 添加分类</button></div><p class="muted">分类名称支持三种语言。删除前需先移动该分类内的商品。</p><div id="category-list"></div></section>`;content.categories.forEach((c,i)=>{const d=document.createElement('div');d.className='category-row';d.innerHTML=`${input('English','name',c.name)}${input('Deutsch','de',c.de||'')}${input('Español','es',c.es||'')}<label>观看等级<select data-key="access"><option value="all" ${(c.access||'all')==='all'?'selected':''}>公开 · 所有人</option><option value="normal" ${c.access==='normal'?'selected':''}>登录会员</option><option value="vip" ${c.access==='vip'?'selected':''}>VIP 专属</option></select></label><label>分类链接<div class="link-row"><input readonly value="${location.origin}/?category=${encodeURIComponent(c.id)}"><button type="button" data-copy-cat>复制</button></div></label><button data-delete>删除</button>`;document.querySelector('#category-list').append(d);bind(d,c);d.querySelector('[data-delete]').onclick=()=>{if(content.products.some(p=>p.category===c.id))return toast('此分类仍有商品，请先移动或删除商品');content.categories.splice(i,1);changed();editor();};});document.querySelector('#new-category').onclick=()=>{content.categories.push({id:uuid(),name:'New category',de:'',es:''});toast('已添加分类，改好名称后点「保存并发布」');setTimeout(()=>{const rows=document.querySelectorAll('#category-list .category-row');const last=rows[rows.length-1];if(last){last.scrollIntoView({block:'center'});const i=last.querySelector('input');i&&i.select();}},120);changed();editor();};}
 if(tab==='customers'){
  el.innerHTML=`<section class="panel"><div class="panel-heading"><h2>用户管理</h2><input id="customer-search" type="search" placeholder="搜索邮箱或姓名"></div><p class="muted">等级说明：普通用户可看「公开」与「登录会员」商品；VIP 用户可看全部，包括「VIP 专属」商品。改等级立即生效，用户下次刷新页面即可看到。</p><div id="customer-list">正在加载…</div></section>`;
  const renderCustomers=async(q='')=>{
   const list=document.querySelector('#customer-list');
   try{
    const rows=await api('/api/admin/customers'+(q?'?q='+encodeURIComponent(q):''));
    list.innerHTML=rows.length?rows.map(c=>`<div class="customer-row"><div><strong>${esc(c.name||c.email)}</strong><p class="muted">${esc(c.email)} · 注册 ${esc(new Date(c.created).toLocaleDateString())} · 订单 ${c.orders}</p></div><label class="level-picker">等级 <select data-level="${esc(c.id)}"><option value="normal" ${c.level==='normal'?'selected':''}>普通用户</option><option value="vip" ${c.level==='vip'?'selected':''}>VIP 用户</option></select></label></div>`).join(''):'<p class="muted">还没有注册用户。</p>';
    list.querySelectorAll('[data-level]').forEach(sel=>sel.onchange=async()=>{
     try{await api('/api/admin/customers/'+encodeURIComponent(sel.dataset.level),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({level:sel.value})});toast('等级已更新');}
     catch(e){toast(e.message);renderCustomers(q);}
    });
   }catch(e){list.textContent=e.message;}
  };
  renderCustomers();
  let timer;
  document.querySelector('#customer-search').oninput=e=>{clearTimeout(timer);const v=e.target.value.trim();timer=setTimeout(()=>renderCustomers(v),250);};
 }
 if(tab==='mail'){
  el.innerHTML=`<section class="panel"><div class="panel-heading"><h2>通知邮件</h2><span class="muted" id="mail-state">读取中…</span></div>
  <p class="muted">客户下单后自动发送订单确认邮件，可同时抄送店主。支持 SMTP（自有邮箱，如企业邮箱 / CraneMail）或 HTTP 邮件服务（Resend / Postmark / SendGrid / 自建）。密钥保存在本机数据库，界面只显示末四位。</p>
  <div class="form-grid">
   <label>发送方式<select id="mail-provider">
     <option value="smtp">SMTP（自有邮箱）</option>
     <option value="resend">Resend</option>
     <option value="postmark">Postmark</option>
     <option value="sendgrid">SendGrid</option>
     <option value="generic">自建 / 兼容端点</option>
   </select></label>
   <label>发件地址<input id="mail-from" type="email" placeholder="orders@yourdomain.com"></label>
   <label>发件人名称<input id="mail-from-name" placeholder="MERIDIAN"></label>
   <label>店主收件（逗号分隔）<input id="mail-notify" placeholder="owner@example.com"></label>
   <label>WhatsApp 客服号<input id="mail-whatsapp" placeholder="+8613800000000"></label>
  </div>
  <div id="mail-smtp-wrap">
   <p class="muted" style="margin:14px 0 6px">SMTP 参数（服务商面板可查：465=SSL，587=STARTTLS）</p>
   <div class="form-grid">
    <label>服务器地址<input id="mail-smtp-host" placeholder="mail.yourdomain.com"></label>
    <label>端口<input id="mail-smtp-port" inputmode="numeric" placeholder="465"></label>
    <label>账号<input id="mail-smtp-user" placeholder="orders@yourdomain.com" autocomplete="off"></label>
    <label>密码 / 应用专用密码<input id="mail-smtp-pass" type="password" autocomplete="new-password" placeholder="留空表示不修改"></label>
   </div>
   <label class="check" style="grid-column:1/-1;margin-top:6px"><input id="mail-smtp-secure" type="checkbox"> 直接用 SSL/TLS（465 勾选；587 不勾，自动 STARTTLS）</label>
  </div>
  <div id="mail-key-wrap">
   <div class="form-grid"><label>API Key<input id="mail-key" type="password" autocomplete="new-password" placeholder="留空表示不修改"></label></div>
  </div>
  <div id="mail-url-wrap"><div class="form-grid"><label>接口地址（generic 必填）<input id="mail-url" placeholder="https://your-endpoint/send"></label></div></div>
  <div class="actions"><button class="button" id="mail-save">保存邮件设置</button></div>
  <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
  <div class="form-grid"><label>测试收件地址<input id="mail-test-to" type="email" placeholder="you@example.com"></label></div>
  <button class="button outline" id="mail-test">发送测试邮件</button><p class="muted" id="mail-result"></p></section>`;
  const q=x=>document.querySelector(x);
  const syncMode=()=>{
   const p=q('#mail-provider').value;
   q('#mail-smtp-wrap').style.display=p==='smtp'?'':'none';
   q('#mail-key-wrap').style.display=p==='smtp'?'none':'';
   q('#mail-url-wrap').style.display=p==='generic'?'':'none';
  };
  q('#mail-provider').onchange=syncMode;
  const fill=m=>{
   q('#mail-provider').value=m.provider||'smtp';
   q('#mail-from').value=m.from||'';
   q('#mail-from-name').value=m.fromName||'MERIDIAN';
   q('#mail-notify').value=(m.notify||[]).join(', ');
   q('#mail-whatsapp').value=m.whatsapp||'';
   q('#mail-url').value=m.apiUrl||'';
   q('#mail-smtp-host').value=m.smtpHost||'';
   q('#mail-smtp-port').value=m.smtpPort||'587';
   q('#mail-smtp-user').value=m.smtpUser||'';
   q('#mail-smtp-secure').checked=Boolean(m.smtpSecure);
   q('#mail-smtp-pass').value='';
   q('#mail-smtp-pass').placeholder=m.smtpPassSet?'已保存，留空不修改':'邮箱密码或应用专用密码';
   q('#mail-key').value='';
   q('#mail-key').placeholder=m.apiKeySet?('已保存 '+m.apiKeyHint+'，留空不修改'):'粘贴 API Key';
   q('#mail-state').innerHTML=m.enabled
    ? '<strong style="color:#1f9d55">已配置，可发送</strong>'
    : '<strong style="color:#b45309">未完成配置</strong>（订单仍可创建，只是不发邮件）';
   syncMode();
  };
  api('/api/admin/mail').then(fill).catch(e=>{q('#mail-state').textContent=e.message;syncMode();});
  q('#mail-save').onclick=async()=>{
   const btn=q('#mail-save');btn.disabled=true;
   const payload={provider:q('#mail-provider').value,from:q('#mail-from').value.trim(),fromName:q('#mail-from-name').value.trim(),apiUrl:q('#mail-url').value.trim(),notifyEmail:q('#mail-notify').value.trim(),whatsapp:q('#mail-whatsapp').value.trim(),
    smtpHost:q('#mail-smtp-host').value.trim(),smtpPort:q('#mail-smtp-port').value.trim()||'587',smtpSecure:q('#mail-smtp-secure').checked,smtpUser:q('#mail-smtp-user').value.trim()};
   const key=q('#mail-key').value.trim();if(key)payload.apiKey=key;
   const pass=q('#mail-smtp-pass').value;if(pass)payload.smtpPass=pass;
   try{const m=await api('/api/admin/mail',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});fill(m);toast('邮件设置已保存');}
   catch(e){toast(e.message);}
   btn.disabled=false;
  };
  q('#mail-test').onclick=async()=>{
   const to=q('#mail-test-to').value.trim(),out=q('#mail-result');
   out.textContent='发送中…';
   try{const r=await fetch('/api/admin/mail/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to})});const j=await r.json();if(!r.ok)throw Error(j.error||'发送失败');out.textContent='已发送，请查收（含垃圾箱）。';}
   catch(e){out.textContent=e.message;}
  };
 }
 if(tab==='orders'){el.innerHTML='<p>正在加载订单…</p>';Promise.all([api('/api/admin/orders'),api('/api/admin/shipping').catch(()=>({config:null}))]).then(([orders,ship])=>{if(tab!=='orders')return;const SCFG=ship&&ship.config;const descRule=r=>{if(!r)return '未记录（旧订单）';if(r.mode==='percent')return `商品金额 ${r.percent}%`;if(r.mode==='flat')return `固定 $${(Number(r.flat||0)/100).toFixed(2)}`;if(r.mode==='free')return '免运费';return `满 $${(Number(r.freeOver||0)/100).toFixed(2)} 免邮，否则 $${(Number(r.flat||0)/100).toFixed(2)}`;};const drift=o=>{const r=o.details.shippingRule;if(!SCFG||!r)return false;return r.mode!==SCFG.mode||(r.mode==='percent'&&Number(r.percent)!==Number(SCFG.percent))||((r.mode==='flat')&&Number(r.flat)!==Number(SCFG.flat))||(Number(r.freeOver||0)!==Number(SCFG.freeOver||0));};el.innerHTML=orders.length?`<p class=\"muted\">当前默认运费规则：${esc(descRule(SCFG))}（在「运费设置」里修改）</p>`+orders.map(o=>`<section class="panel"><div class="panel-heading"><h2>${esc(o.id)}</h2><strong>$${o.details.total.toFixed(2)} USD</strong></div><p class="muted">${esc(new Date(o.created).toLocaleString())} · ${esc(o.details.status)}</p><p>${esc(o.details.name)} · ${esc(o.details.email)} · ${esc(o.details.phone)}</p><p>${esc(o.details.address)} · ${esc(o.details.postalCode)} · ${esc(o.details.country)}</p>${o.payment?`<div class="payment-instructions"><p>支付方式：${esc(o.payment.provider.toUpperCase())} · ${esc(o.payment.status)}</p>${o.payment.provider==='usdt'?`<p>网络：${esc(o.payment.network.toUpperCase())} · 应到账 ${esc(o.payment.usdtAmount)} USDT</p><p>钱包：<code>${esc(o.payment.address)}</code></p><p>买家提交：<code>${esc(o.payment.submittedHash||'未提交')}</code></p>${o.payment.status==='awaiting_review'?`<button class="button" data-confirm="${esc(o.id)}" data-hash="${esc(o.payment.submittedHash)}">核实到账并确认收款</button>`:''}`:''}${o.payment.transactionId?`<p>已确认交易：${esc(o.payment.transactionId)}</p>`:''}</div>`:''}${o.details.items.map(i=>`<p>${esc(i.name)} × ${i.quantity} <span class="muted">$${i.price.toFixed(2)}</span></p>`).join('')}${drift(o)?`<div class="drift-note">此单运费按下单时的规则（${esc(descRule(o.details.shippingRule))}）计算，当前默认规则是 ${esc(descRule(SCFG))}。<button class="button outline mini" data-apply-ship="${esc(o.id)}">按当前规则重算</button></div>`:''}<div class="trk-box"><p class="muted">运费：商品小计 $${(o.details.items||[]).reduce((n,i)=>n+i.price*i.quantity,0).toFixed(2)} · 当前运费 $${(Number(o.details.shipping||0)/100).toFixed(2)} · 总计 $${Number(o.details.total||0).toFixed(2)}</p><div class="trk-row"><select data-ship-mode data-pct="${o.details.shippingRule?o.details.shippingRule.percent:8}" data-flat="${o.details.shippingRule?(Number(o.details.shippingRule.flat||0)/100):12}"><option value="auto" ${(!o.details.shippingRule||o.details.shippingRule.mode==='auto')?'selected':''}>按默认规则</option><option value="percent" ${o.details.shippingRule&&o.details.shippingRule.mode==='percent'?'selected':''}>商品金额百分比</option><option value="flat" ${o.details.shippingRule&&o.details.shippingRule.mode==='flat'?'selected':''}>固定金额</option><option value="free" ${o.details.shippingRule&&o.details.shippingRule.mode==='free'?'selected':''}>免运费</option></select><input data-ship-value type="number" min="0" step="0.1" value="${o.details.shippingRule&&o.details.shippingRule.mode==='percent'?o.details.shippingRule.percent:(o.details.shippingRule?Number(o.details.shippingRule.flat||0)/100:'')}" placeholder="百分比 % 或 金额 USD"><button class="button outline" data-save-ship="${esc(o.id)}">重算运费</button></div><p class="muted">百分比模式下填数字（如 8 = 8%）；固定金额模式下填 USD（如 12）。</p></div><div class="trk-box"><p class="muted">物流单号（填了买家就能在「我的订单」里看到，并可点开承运商官网追踪）</p><div class="trk-row"><select data-trk-carrier>${['','4PX','AliExpress','YunExpress','DHL','Deutsche Post','DPD','UPS','USPS','FedEx','Other'].map(c=>`<option value="${c}" ${o.details.tracking&&o.details.tracking.carrier===c?'selected':''}>${c||'选择承运商'}</option>`).join('')}</select><input data-trk-number placeholder="例如 CX123456789DE" value="${esc(o.details.tracking&&o.details.tracking.number||'')}"><button class="button outline" data-save-trk="${esc(o.id)}">保存单号</button></div>${o.details.tracking&&o.details.tracking.number?`<p class="muted">当前：${esc(o.details.tracking.carrier||'—')} · ${esc(o.details.tracking.number)}</p>`:''}</div></section>`).join(''):'<section class="panel empty">暂时还没有订单。</section>';el.querySelectorAll('[data-confirm]').forEach(btn=>btn.onclick=async()=>{if(!confirm('请先在对应网络的区块浏览器中核实：USDT 合约真实、交易成功且达到所需确认数、收款钱包与订单一致、实际到账金额足额，并确认此交易未用于其他订单。确认已全部核实？'))return;btn.disabled=true;try{await api('/api/admin/orders/'+encodeURIComponent(btn.dataset.confirm)+'/confirm-usdt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({verified:true,transactionId:btn.dataset.hash})});toast('收款已确认');editor();}catch(e){toast(e.message);btn.disabled=false;}});el.querySelectorAll('[data-apply-ship]').forEach(btn=>btn.onclick=async()=>{
  if(!SCFG)return toast('当前规则读取失败');
  btn.disabled=true;
  try{await api('/api/admin/orders/'+encodeURIComponent(btn.dataset.applyShip)+'/shipping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rule:SCFG})});toast('已按当前规则重算');editor();}
  catch(e){toast(e.message);btn.disabled=false;}
 });
 el.querySelectorAll('[data-ship-mode]').forEach(sel=>sel.onchange=()=>{
  const box=sel.closest('.trk-box'),inp=box.querySelector('[data-ship-value]');
  if(!inp)return;
  if(sel.value==='percent'){inp.value=sel.dataset.pct||'';inp.placeholder='百分比 %（如 8）';}
  else if(sel.value==='flat'){inp.value=sel.dataset.flat||'';inp.placeholder='金额 USD（如 12）';}
  else {inp.value='';inp.placeholder=sel.value==='free'?'免运费':'按默认规则';}
 });
 el.querySelectorAll('[data-save-ship]').forEach(btn=>btn.onclick=async()=>{
  const box=btn.closest('.trk-box');
  const mode=box.querySelector('[data-ship-mode]').value;
  const raw=Number(box.querySelector('[data-ship-value]').value||0);
  const rule=mode==='percent'?{mode,percent:raw}:mode==='flat'?{mode,flat:Math.round(raw*100)}:{mode};
  btn.disabled=true;
  try{await api('/api/admin/orders/'+encodeURIComponent(btn.dataset.saveShip)+'/shipping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rule})});toast('运费已重算');editor();}
  catch(e){toast(e.message);btn.disabled=false;}
 });
 el.querySelectorAll('[data-save-trk]').forEach(btn=>btn.onclick=async()=>{
  const box=btn.closest('.trk-box');
  const carrier=box.querySelector('[data-trk-carrier]').value;
  const number=box.querySelector('[data-trk-number]').value.trim();
  btn.disabled=true;
  try{await api('/api/admin/orders/'+encodeURIComponent(btn.dataset.saveTrk)+'/tracking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({carrier,number})});toast(number?'物流单号已保存':'物流单号已清除');editor();}
  catch(e){toast(e.message);btn.disabled=false;}
 });}).catch(e=>el.textContent=e.message);}
 if(tab==='payments')paymentEditor(el);
 if(tab==='shipping')shippingEditor(el);
 if(tab==='account'){
  el.innerHTML=`<section class="panel"><h2>后台密码</h2><p class="muted">密码保存在本机数据库里，改完立即生效。以后忘了密码也不用 SSH 翻 config.env——直接用浏览器改。</p>
  <div id="acct-info" class="muted">正在读取…</div>
  <form id="pw-form" class="form-grid"><label class="span-2">当前密码<input type="password" name="current" required autocomplete="current-password"></label><label>新密码（至少 10 位）<input type="password" name="next" required minlength="10" autocomplete="new-password"></label><label>再输一次<input type="password" name="confirm" required minlength="10" autocomplete="new-password"></label><button class="button span-2">保存新密码</button></form>
  <p class="form-error" role="alert"></p></section>
  <section class="panel"><h2>登录状态</h2><p class="muted">默认登录保持 8 小时；勾选「保持登录 30 天」的设备不会被自动登出。改密码会让所有设备立即失效，需要重新登录。</p><p class="muted">如果连当前密码也不记得：在部署目录执行 <code>node scripts/reset-password.js</code>（或在后面直接跟新密码）即可，不需要重启服务。</p></section>`;
  api('/api/admin/account').then(a=>{const box=document.querySelector('#acct-info');if(box)box.textContent=`当前密码来源：${a.passwordSource==='database'?'数据库（已在后台修改过）':'config.env 初始密码'} · 常规登录保持 ${a.sessionHours} 小时 · 保持登录 ${a.rememberDays} 天`;}).catch(()=>{});
  const f=document.querySelector('#pw-form');if(f)f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));const err=document.querySelector('.form-error');err.textContent='';if(d.next!==d.confirm){err.textContent='两次输入的新密码不一致';return;}try{await api('/api/admin/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current:d.current,next:d.next})});toast('密码已修改，请用新密码重新登录');setTimeout(()=>{try{localStorage.removeItem('meridian-admin');}catch{}location.reload();},1200);}catch(ex){err.textContent=ex.message;}};
 }
}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});load();

async function shippingEditor(el){
 el.innerHTML='<p>正在读取运费设置…</p>';
 try{
  const {config}=await api('/api/admin/shipping');
  el.innerHTML=`<section class="panel"><h2>运费规则</h2>
  <p class="muted">默认规则用于新订单。已下单的订单保留当时的运费，可在「订单记录」里逐单调整。</p>
  <div class="grid2">
   <label>计算方式
    <select id="ship-mode">
     <option value="auto" ${config.mode==='auto'?'selected':''}>满额免邮 + 固定运费（旧规则）</option>
     <option value="percent" ${config.mode==='percent'?'selected':''}>按商品金额百分比</option>
     <option value="flat" ${config.mode==='flat'?'selected':''}>每单固定运费</option>
     <option value="free" ${config.mode==='free'?'selected':''}>全部包邮</option>
    </select>
   </label>
   <label>固定运费（USD）<input id="ship-flat" type="number" min="0" step="0.01" value="${(config.flat/100).toFixed(2)}"></label>
   <label>百分比（%）<input id="ship-percent" type="number" min="0" max="100" step="0.1" value="${config.percent}"></label>
   <label>免邮门槛（USD，填 0 = 不启用）<input id="ship-freeover" type="number" min="0" step="0.01" value="${(config.freeOver/100).toFixed(2)}"></label>
  </div>
  <p class="muted" id="ship-preview"></p><p class="muted" id="ship-warn" style="display:none;color:#a8452c">提醒：首页顶部公告（页面设计 → 公告文案）现在写的是「满 $150 免邮」。改成百分比或固定运费后，记得去那里改这一行，别让客户以为免邮。</p>
  <button class="button" id="ship-save">保存运费规则</button>
  </section>`;
  const read=()=>({mode:el.querySelector('#ship-mode').value,flat:Math.round(Number(el.querySelector('#ship-flat').value||0)*100),percent:Number(el.querySelector('#ship-percent').value||0),freeOver:Math.round(Number(el.querySelector('#ship-freeover').value||0)*100)});
  const preview=()=>{
   const c=read();const fmt=n=>'$'+(n/100).toFixed(2);
   const calc=t=>{const cents=Math.round(t*100);if(c.mode==='free')return 0;if(c.mode==='percent'){if(c.freeOver>0&&cents>=c.freeOver)return 0;return Math.round(cents*c.percent/100);}if(c.mode==='flat'){if(c.freeOver>0&&cents>=c.freeOver)return 0;return c.flat;}return c.freeOver>0&&cents>=c.freeOver?0:c.flat;};
   const samples=[50,189,300].map(t=>`订单 ${fmt(t*100)} → 运费 ${calc(t)?fmt(calc(t)):'免运费'}`);
   el.querySelector('#ship-preview').innerHTML=samples.join(' ｜ ')+(c.mode==='percent'?`<br>例：商品总额 $189 按 ${c.percent}% 收 ${fmt(Math.round(18900*c.percent/100))}`:'');
  };
  ['#ship-mode','#ship-flat','#ship-percent','#ship-freeover'].forEach(s=>{const n=el.querySelector(s);if(n)n.oninput=preview;if(n)n.onchange=preview;});
  preview();
  const warn=el.querySelector('#ship-warn');
  const fields={mode:el.querySelector('#ship-mode'),flat:el.querySelector('#ship-flat'),percent:el.querySelector('#ship-percent'),freeOver:el.querySelector('#ship-freeover')};
  const syncFields=()=>{
   const m=fields.mode.value;
   const set=(node,on)=>{if(!node)return;node.disabled=!on;node.style.opacity=on?'1':'0.45';node.style.background=on?'#fff':'#f2f0ea';};
   set(fields.percent,m==='percent');
   set(fields.flat,m==='flat'||m==='auto');
   set(fields.freeOver,m!=='free');
   if(warn){
    const fo=Number(fields.freeOver.value||0);
    const freeText=fo>0?`当前免邮门槛 $${fo.toFixed(2)}`:'当前不设免邮门槛（任何订单都收运费）';
    if(m==='free'){warn.style.display='none';}
    else{
     warn.style.display='block';
     warn.innerHTML=`提醒：首页顶部公告（页面设计 → 公告文案）写的是「满 $150 免邮」，但${freeText}。${fo===0?'客户会以为免邮却仍被收运费，务必去改那行公告，或在免邮门槛里填 150。':'若与公告不一致，请去那一行同步文案。'}`;
    }
   }
  };
  el.querySelector('#ship-mode').onchange=()=>{preview();syncFields();};
  el.querySelector('#ship-freeover').oninput=()=>{preview();syncFields();};
  syncFields();
  el.querySelector('#ship-save').onclick=async e=>{
   e.target.disabled=true;
   try{const r=await api('/api/admin/shipping',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(read())});toast('运费规则已保存');shippingEditor(el);}
   catch(err){toast(err.message);e.target.disabled=false;}
  };
 }catch(e){el.textContent=e.message;}
}
async function paymentEditor(el){el.innerHTML='<p>正在读取支付配置…</p>';try{const state=await api('/api/admin/payments');if(tab!=='payments')return;const c=state.config,r=state.readiness;el.innerHTML=`<form id="payment-settings"><section class="panel"><h2>付款方式如何分配</h2><p class="muted">规则写在服务端，按买家的会员等级决定：<strong>普通会员和游客只能用 PayPal</strong>；<strong>VIP 会员的订单只能用 USDT</strong>。另外，订单里只要包含 VIP 专属商品，整单强制 USDT（防止有人用 PayPal 付掉会员商品）。下单时会把规则快照进订单，之后改会员等级不影响历史订单。</p></section><section class="panel"><h2>PayPal 官方收银台</h2><label class="check"><input name="paypalEnabled" type="checkbox" ${c.paypalEnabled?'checked':''}>启用 PayPal</label><label>运行环境<select name="paypalMode"><option value="sandbox">Sandbox 测试环境</option><option value="live">Live 正式环境</option></select></label><div class="form-grid"><label>Client ID<input name="paypalClientId" value="${esc(c.paypalClientId||'')}" spellcheck="false" autocomplete="off" placeholder="AeA1Q...（PayPal 开发者后台的 Client ID）"></label><label>Secret${c.paypalClientSecretSet?'（已保存 '+esc(c.paypalClientSecretMask)+'，留空表示不修改）':''}<input name="paypalClientSecret" type="password" value="" spellcheck="false" autocomplete="new-password" placeholder="${c.paypalClientSecretSet?'留空表示保持原密钥':'粘贴 Secret，保存后只显示末四位'}"></label></div><label>Webhook ID<input name="paypalWebhookId" value="${esc(c.paypalWebhookId||'')}" spellcheck="false" autocomplete="off" placeholder="PayPal 里创建 Webhook 后得到的长串 ID"></label>${c.paypalClientSecretSet?'<label class="check"><input name="clearPaypalSecret" type="checkbox">删除已保存的 Secret（换账号时用）</label>':''}<p class="muted">凭证保存在数据库里（<code>payment_config</code>），页面只显示 Secret 末四位；也可以用服务器环境变量 PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID 覆盖（环境变量优先于数据库）。</p><ul><li>客户端 ID 与密钥：${r.paypalCredentials?'已保存（尚不代表授权验证通过）':'未配置'}</li><li>Webhook ID：${r.paypalWebhook?'已保存':'未配置'}</li><li>公开 HTTPS 网站地址：${r.publicURL?'已配置':'未配置'}</li></ul><p class="muted">Webhook 地址：你的 HTTPS 域名 + /api/payments/paypal/webhook；订阅 PAYMENT.CAPTURE.COMPLETED。切换 Sandbox / Live 时需同步替换对应环境的凭证和 Webhook ID。</p></section><section class="panel"><h2>USDT 钱包直收 · 人工核账</h2><label class="check"><input name="usdtEnabled" type="checkbox" ${c.usdtEnabled?'checked':''}>启用 USDT</label><div class="form-grid"><label>收款网络<select name="usdtNetwork"><option value="trc20">TRC20 — Tron</option><option value="erc20">ERC20 — Ethereum</option></select></label><label>报价比例（1 USD 对应多少 USDT）<input name="usdtRate" type="number" min="0.000001" max="100" step="0.000001" required value="${esc(c.usdtRate)}"></label></div><label>收款钱包地址<input name="usdtAddress" value="${esc(c.usdtAddress)}" spellcheck="false" autocomplete="off"></label><p class="muted">仅填写公开收款地址，绝不填写助记词或私钥。报价比例由商家设置，不是实时市场汇率；每张支付单固定保存创建时的钱包、网络和金额，后续修改设置不影响旧支付单。</p><p class="muted">买家提交交易哈希后，请在订单记录中人工核实真实 USDT 合约、网络、收款地址、实际到账金额和确认数，再确认收款。后台不会自动验证链上到账。错误网络或地址可能造成资金损失。</p></section><button class="button">保存支付设置</button><p class="form-error" role="alert"></p></form>`;const form=document.querySelector('#payment-settings');form.elements.paypalMode.value=c.paypalMode;form.elements.usdtNetwork.value=c.usdtNetwork;form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('button');btn.disabled=true;try{await api('/api/admin/payments',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({paypalEnabled:form.elements.paypalEnabled.checked,paypalMode:form.elements.paypalMode.value,usdtEnabled:form.elements.usdtEnabled.checked,usdtNetwork:form.elements.usdtNetwork.value,usdtAddress:form.elements.usdtAddress.value.trim(),usdtRate:Number(form.elements.usdtRate.value),paypalClientId:form.elements.paypalClientId.value.trim(),paypalClientSecret:form.elements.paypalClientSecret.value,paypalWebhookId:form.elements.paypalWebhookId.value.trim(),clearPaypalSecret:!!(form.elements.clearPaypalSecret&&form.elements.clearPaypalSecret.checked)})});toast('支付设置已保存，立即生效');await paymentEditor(el);}catch(err){form.querySelector('.form-error').textContent=err.message;}finally{btn.disabled=false;}};}catch(e){el.textContent=e.message;}}

// ---------- 前后端版本一致性检查 ----------
async function versionCheck(){
 const meta=(n)=>document.querySelector(`meta[name="${n}"]`)?.content||'';
 const local=meta('meridian-build');
 let v=null;
 try{v=await (await fetch('/api/version',{cache:'no-store'})).json();}catch{return;}
 const sv=document.querySelector('#side-version');
 if(sv&&v)sv.textContent=(local?`界面 ${local.slice(0,6)} · `:'')+`服务 ${String(v.build).slice(0,6)}`;
 if(!local||!v||local!==v.build){
  if(document.querySelector('#meridianVersionBanner'))return;
  const bar=document.createElement('div');bar.id='meridianVersionBanner';
  bar.innerHTML=`<strong>版本不一致：浏览器拿到的是新界面，服务器还在跑旧进程。</strong><span>保存 / 发布 / 新增分类都会失败。请在服务器执行 <code>cd ~/meridian-store && git pull && MERIDIAN_ALLOW_ROOT=1 bash install.sh</code> 重启服务，然后按 Ctrl+Shift+R。</span>`;
  document.body.prepend(bar);
 }
}
setTimeout(versionCheck,400);setTimeout(versionCheck,1800);

// ---------- 前端错误捕获 + 自检 ----------
window.__errs=[];
function showErrorBar(msg){
  let bar=document.querySelector('#meridianErrorBar');
  if(!bar){bar=document.createElement('div');bar.id='meridianErrorBar';document.body.prepend(bar);}
  bar.innerHTML=`<strong>后台脚本报错（把这段发给技术支持）</strong><span></span><button>关闭</button>`;
  bar.querySelector('span').textContent=String(msg).slice(0,400);
  bar.querySelector('button').onclick=()=>bar.remove();
}
window.addEventListener('error',e=>{window.__errs.push(e.message);showErrorBar(e.message);});
window.addEventListener('unhandledrejection',e=>{const m=e.reason&&e.reason.message||e.reason;window.__errs.push(String(m));showErrorBar(m);});
async function selfCheck(){
  const box=document.createElement('div');
  box.id='selfCheckBox';
  box.innerHTML=`<div class="sc-head"><strong>自检</strong><button>关闭</button></div><div class="sc-body">正在检查…</div>`;
  document.body.append(box);
  box.querySelector('button').onclick=()=>box.remove();
  const body=box.querySelector('.sc-body');
  const rows=[];
  const meta=(n)=>document.querySelector(`meta[name="${n}"]`)?.content||'';
  let srv={};
  try{srv=await (await fetch('/api/version',{cache:'no-store'})).json();}catch{}
  rows.push(['界面版本',meta('meridian-build').slice(0,8)||'未知']);
  rows.push(['服务版本',String(srv.build||'').slice(0,8)||'取不到']);
  rows.push(['版本一致',meta('meridian-build')===srv.build?'✓':'✗ 需要重启服务']);
  for(const path of ['/api/admin/analytics?days=7','/api/admin/content','/api/admin/customers','/api/admin/orders','/api/admin/payments','/api/admin/mail','/api/admin/sitemap']){
    let st='—';
    try{const r=await fetch(path,{cache:'no-store'});st=r.status+(r.ok?' ✓':' ✗');
      if(!r.ok){const t=await r.text();st+=' '+t.slice(0,80);}
    }catch(e){st='网络错误 '+e.message;}
    rows.push([path.replace('/api/admin/',''),st]);
  }
  rows.push(['前端错误',window.__errs.length?window.__errs.slice(-3).join(' / '):'无']);
  rows.push(['商品/分类',`${(content.products||[]).length} / ${(content.categories||[]).length}`]);
  try{
   const st=await (await fetch('/api/store?'+Date.now(),{cache:'no-store'})).json();
   const sh=st.shipping||{};
   const sample=(t)=>{const cents=Math.round(t*100);if(sh.mode==='free')return 0;if(sh.mode==='percent'){if(sh.freeOver>0&&cents>=sh.freeOver)return 0;return Math.round(cents*(sh.percent||0)/100);}if(sh.freeOver>0&&cents>=sh.freeOver)return 0;return Number(sh.flat||0);};
   const label=sh.mode==='percent'?`商品金额 ${sh.percent}%`:sh.mode==='flat'?`固定 $${(sh.flat/100).toFixed(2)}`:sh.mode==='free'?'全部包邮':`满 $${(sh.freeOver/100).toFixed(2)} 免邮，否则 $${(sh.flat/100).toFixed(2)}`;
   rows.push(['前台运费规则',`${label}${sh.freeOver>0?`（满 $${(sh.freeOver/100).toFixed(2)} 免邮）`:''} · 例 $189 → ${sample(189)?'$'+(sample(189)/100).toFixed(2):'免运费'}`]);
  }catch(e){rows.push(['前台运费规则','读取失败 '+e.message]);}

  body.innerHTML=rows.map(([k,v])=>`<div class="sc-row"><span>${k}</span><code>${String(v).replace(/</g,'&lt;')}</code></div>`).join('');
}
function ensureSelfCheck(){
  if(document.querySelector('#selfcheck'))return;
  const actions=document.querySelector('.studio-top .actions');
  if(!actions)return;
  const b=document.createElement('button');b.id='selfcheck';b.className='button outline';b.textContent='自检';b.onclick=selfCheck;actions.append(b);
}
setInterval(ensureSelfCheck,800);

/* AFAQ SYRIA dynamic geography and project gallery. Browser-local IndexedDB storage. */
(function(){
'use strict';
var DB='afaq-syria-data-v1',STORE='records',db,provinceNames=['دمشق','ريف دمشق','حلب','حمص','حماة','اللاذقية','طرطوس','إدلب','دير الزور','الرقة','الحسكة','درعا','السويداء','القنيطرة'],sectors=['العقارات والأراضي','الطرق والبنية التحتية','الطاقة البحرية','الطاقة النظيفة','الزراعة','الثروة الحيوانية','الثروة السمكية','التصنيع والتبريد'],provinceId=null,cityId=null;
function $(s,r){return (r||document).querySelector(s)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function uid(){return 'afq-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)}
function openDB(){return new Promise(function(ok,no){var q=indexedDB.open(DB,1);q.onupgradeneeded=function(){q.result.createObjectStore(STORE,{keyPath:'id'})};q.onsuccess=function(){ok(q.result)};q.onerror=function(){no(q.error)}})}
function all(){return new Promise(function(ok,no){var q=db.transaction(STORE).objectStore(STORE).getAll();q.onsuccess=function(){ok(q.result||[])};q.onerror=function(){no(q.error)}})}
function put(v){return new Promise(function(ok,no){var q=db.transaction(STORE,'readwrite').objectStore(STORE).put(v);q.onsuccess=function(){ok(v)};q.onerror=function(){no(q.error)}})}
function del(id){return new Promise(function(ok,no){var q=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);q.onsuccess=function(){ok()};q.onerror=function(){no(q.error)}})}
function toast(s){if(window.showToast)window.showToast(s);else alert(s)}
function go(){document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active')});$('#geographyView').classList.add('active');document.querySelectorAll('.nav button').forEach(function(b){b.classList.toggle('active',b.id==='navGeography')});$('#pageTitle').textContent='المحافظات والمدن والمشاريع';$('#sidebar').classList.remove('open');history.replaceState(null,'','#geography');render()}
function setup(){
var nav=$('.nav'),content=$('.content');if(!nav||!content)return;
if(!$('#navGeography')){var b=document.createElement('button');b.id='navGeography';b.innerHTML='<span class="ico">🗺️</span>المحافظات والمدن';b.onclick=go;var label=Array.from(nav.querySelectorAll('.nav-label')).find(function(x){return x.textContent.indexOf('إدارة الأعمال')>=0});nav.insertBefore(b,label?label.nextSibling:null)}
if(!$('#geographyView')){var v=document.createElement('section');v.id='geographyView';v.className='view';v.innerHTML='<div class="view-head"><div><h2>المحافظات والمدن والمشاريع</h2><p>افتح حقيبة المحافظة ثم المدينة، وأضف المشاريع والصور والبيانات الاستثمارية.</p></div><button class="btn gold" id="addProvince">＋ إضافة محافظة</button></div><div class="geo-layout"><aside class="panel geo-list"><b>المحافظات السورية</b><div id="provinceList"></div></aside><div><div id="geoCrumb" class="geo-crumb">اختر محافظة</div><div id="geoContent" class="panel">اختر محافظة لعرض المدن والمشاريع.</div></div></div>';content.appendChild(v)}
$('#addProvince').onclick=function(){dialog('إضافة محافظة',[['name','اسم المحافظة']],async function(d){await put({id:uid(),type:'province',name:d.name});provinceId=null;render()})};
}
async function render(){
var data=await all(),ps=data.filter(function(x){return x.type==='province'}),cities=data.filter(function(x){return x.type==='city'}),projects=data.filter(function(x){return x.type==='project'});
if(!provinceId&&ps.length)provinceId=ps[0].id;
$('#provinceList').innerHTML=ps.map(function(p){return '<button class="geo-province '+(provinceId===p.id?'selected':'')+'" data-p="'+p.id+'">▣　'+esc(p.name)+'　›</button>'}).join('')||'<p>لا توجد محافظات</p>';
$('#provinceList').querySelectorAll('[data-p]').forEach(function(b){b.onclick=function(){provinceId=b.dataset.p;cityId=null;render()}});
var p=ps.find(function(x){return x.id===provinceId});if(!p){$('#geoContent').textContent='أضف محافظة للبدء.';return}
var cs=cities.filter(function(c){return c.parentId===p.id});$('#geoCrumb').textContent='سوريا　›　'+p.name;
if(!cityId){$('#geoContent').innerHTML='<div class="geo-toolbar"><h3>حقيبة محافظة '+esc(p.name)+'</h3><button class="btn gold" id="addCity">＋ إضافة مدينة / منطقة</button></div><div class="geo-cards">'+(cs.map(function(c){return '<button class="geo-card" data-c="'+c.id+'"><span>🏙️</span><b>'+esc(c.name)+'</b><small>'+projects.filter(function(x){return x.cityId===c.id}).length+' مشروع</small><i>فتح الحقيبة ←</i></button>'}).join('')||'<p class="empty">لا توجد مدن. أضف مدينة لبدء تنظيم المشاريع.</p>')+'</div>';
$('#addCity').onclick=function(){dialog('إضافة مدينة / منطقة',[['name','اسم المدينة أو المنطقة'],['description','وصف مختصر']],async function(d){await put({id:uid(),type:'city',parentId:p.id,name:d.name,description:d.description});render()})};
$('#geoContent').querySelectorAll('[data-c]').forEach(function(b){b.onclick=function(){cityId=b.dataset.c;render()}});
}else{
var c=cs.find(function(x){return x.id===cityId});if(!c){cityId=null;return render()}var list=projects.filter(function(x){return x.cityId===c.id});
$('#geoCrumb').textContent='سوريا　›　'+p.name+'　›　'+c.name;
$('#geoContent').innerHTML='<div class="geo-toolbar"><div><h3>حقيبة '+esc(c.name)+'</h3><small>'+esc(p.name)+'</small></div><div><button class="btn ghost" id="backCities">← المدن</button> <button class="btn gold" id="addProjectGeo">＋ مشروع جديد</button></div></div><div class="geo-projects">'+(list.map(function(x){return '<article class="geo-project"><b>'+esc(x.name)+'</b><p>'+esc(x.sector)+' · '+esc(x.area||'المساحة غير محددة')+' · '+esc(x.budget||'التكلفة غير محددة')+'</p><p>'+esc(x.description||'')+'</p><div class="geo-images">'+(x.images||[]).map(function(src){return '<img src="'+src+'" alt="صورة المشروع">' }).join('')+'</div><div class="geo-actions"><button class="btn ghost" data-photo="'+x.id+'">＋ إضافة صور</button><button class="btn ghost" data-delete="'+x.id+'">حذف</button></div></article>'}).join('')||'<p class="empty">لا توجد مشاريع مسجلة في هذه المدينة.</p>')+'</div>';
$('#backCities').onclick=function(){cityId=null;render()};
$('#addProjectGeo').onclick=function(){dialog('إضافة مشروع استثماري',[['name','اسم المشروع'],['sector','القطاع','select'],['area','المساحة / النطاق'],['budget','التكلفة التقديرية'],['status','الحالة','select-status'],['description','وصف المشروع','textarea']],async function(d){await put(Object.assign({id:uid(),type:'project',cityId:c.id,provinceId:p.id,images:[]},d));render()})};
$('#geoContent').querySelectorAll('[data-photo]').forEach(function(b){b.onclick=function(){upload(b.dataset.photo)}});
$('#geoContent').querySelectorAll('[data-delete]').forEach(function(b){b.onclick=async function(){if(confirm('حذف هذا المشروع؟')){await del(b.dataset.delete);render()}}});
}
}
function dialog(title,fields,save){
var m=document.createElement('div');m.className='modal open';m.innerHTML='<div class="modal-box"><div class="modal-head"><h3>'+esc(title)+'</h3><button class="close">✕</button></div><form class="geo-form">'+fields.map(function(f){var n=f[0],label=f[1],type=f[2]||'text',opts=type==='select'?sectors:type==='select-status'?['فرصة استثمارية','قيد الدراسة','قيد التخطيط','قيد التنفيذ','مكتمل']:[];if(type==='textarea')return '<label class="field">'+esc(label)+'<textarea name="'+n+'" rows="3"></textarea></label>';if(type==='select'||type==='select-status')return '<label class="field">'+esc(label)+'<select name="'+n+'">'+opts.map(function(o){return '<option>'+esc(o)+'</option>'}).join('')+'</select></label>';return '<label class="field">'+esc(label)+'<input name="'+n+'" required></label>'}).join('')+'<div class="modal-actions"><button class="btn gold">حفظ</button><button type="button" class="btn ghost cancel">إلغاء</button></div></form></div>';document.body.appendChild(m);function close(){m.remove()}$('.close',m).onclick=close;$('.cancel',m).onclick=close;$('.geo-form',m).onsubmit=async function(e){e.preventDefault();await save(Object.fromEntries(new FormData(e.target)));close();toast('تم الحفظ على هذا الجهاز')}}
async function upload(id){var input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;input.onchange=async function(){var a=await all(),x=a.find(function(r){return r.id===id});if(!x)return;x.images=x.images||[];for(var f of input.files){var data=await new Promise(function(ok,no){var r=new FileReader();r.onload=function(){ok(r.result)};r.onerror=no;r.readAsDataURL(f)});x.images.push(data)}await put(x);render();toast('تم حفظ الصور محلياً')};input.click()}
function addStyles(){var s=document.createElement('style');s.textContent=':root{--paper:#071522;--ink:#edf2f5;--muted:#aab8c2;--line:#29404c}body{background:#071522;color:#edf2f5}.topbar,.stat,.panel,.module-card,.trade-card,.api-card,.portfolio-photo,.modal-box{background:#102b40;color:#edf2f5;border-color:#29404c}.topbar{border-color:#29404c}.page-title,.view-head h2,.panel h3,.module-card h3{color:#f0d18b}.stat strong,.quick{color:#f0d18b}.quick,.toolbar input,.toolbar select,.field input,.field select,.field textarea{background:#0b2030;color:#edf2f5;border-color:#36505f}th{background:#0b2030;color:#d6c28e}td,th{border-color:#29404c}.geo-layout{display:grid;grid-template-columns:250px 1fr;gap:14px}.geo-list{padding:14px}.geo-list>b{color:#f0d18b}.geo-province{display:block;width:100%;text-align:right;background:transparent;color:#edf2f5;border:0;padding:11px;border-radius:8px}.geo-province.selected,.geo-province:hover{background:#d9b15f22;color:#f0d18b}.geo-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}.geo-toolbar h3{color:#f0d18b;margin:0}.geo-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.geo-card{display:flex;flex-direction:column;align-items:flex-start;gap:7px;background:#0b2030;color:#edf2f5;border:1px solid #29404c;border-radius:10px;padding:16px;text-align:right}.geo-card:hover{border-color:#d9b15f}.geo-card small,.geo-card i{color:#d9b15f}.geo-project{padding:15px;border:1px solid #29404c;border-radius:10px;margin:10px 0;background:#0b2030}.geo-project p{font-size:12px;color:#b9c7d0}.geo-images{display:flex;gap:8px;overflow:auto}.geo-images img{width:100px;height:75px;object-fit:cover;border-radius:7px}.geo-actions{display:flex;gap:8px;margin-top:10px}.geo-form{display:grid;gap:10px}.geo-form textarea{background:#0b2030;color:#edf2f5;border:1px solid #36505f;border-radius:8px;padding:10px}@media(max-width:800px){.geo-layout{grid-template-columns:1fr}.geo-cards{grid-template-columns:repeat(2,1fr)}}@media(max-width:480px){.geo-cards{grid-template-columns:1fr}}';document.head.appendChild(s)}
function market(){var top=$('.top-right');if(!top)return;var box=document.createElement('div');box.className='market-mini';box.innerHTML='₿ BTC <b>سعر السوق</b>';top.insertBefore(box,top.firstChild);fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true').then(function(r){if(!r.ok)throw Error();return r.json()}).then(function(d){box.innerHTML='₿ BTC <b>$'+Number(d.bitcoin.usd).toLocaleString('en-US')+'</b> <span class="'+(d.bitcoin.usd_24h_change>=0?'market-up':'market-down')+'">'+(d.bitcoin.usd_24h_change>=0?'↑':'↓')+Number(d.bitcoin.usd_24h_change).toFixed(2)+'%</span> ◆ ETH <b>$'+Number(d.ethereum.usd).toLocaleString('en-US')+'</b>'}).catch(function(){box.textContent='₿ أسعار العملات غير متاحة حالياً'})}
async function start(){try{db=await openDB();var a=await all();if(!a.some(function(x){return x.type==='province'})){for(var n of provinceNames)await put({id:uid(),type:'province',name:n})}setup();addStyles();await render();market()}catch(e){console.error(e);toast('تعذر تشغيل وحدة المحافظ والمدن')}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
/* Investment portfolio briefcase workspaces */
(function(){
'use strict';
var bagKey='afaq-investment-briefcases-v1';
function bags(){try{return JSON.parse(localStorage.getItem(bagKey)||'{}')}catch(e){return {}}}
function saveBags(v){localStorage.setItem(bagKey,JSON.stringify(v))}
function current(i){var a=bags();if(!a[i])a[i]={projects:[]};if(!a[i].projects)a[i].projects=[];return {all:a,bag:a[i]}}
function safe(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function renderProjects(i){
 var root=document.getElementById('bagProjectsList');if(!root)return;var b=current(i).bag;
 document.getElementById('bagProjectCount').textContent=b.projects.length+' مشروع';
 root.innerHTML=b.projects.map(function(p,n){return '<article class="bag-project-card"><h4>'+safe(p.name)+'</h4><p>الموقع: '+safe(p.location||'غير محدد')+' · الميزانية: '+safe(p.budget||'غير محددة')+'</p><p>الحالة: '+safe(p.status||'قيد الدراسة')+'</p><p>'+safe(p.details||'لا توجد تفاصيل إضافية')+'</p><button class="btn ghost" type="button" data-bag-delete="'+n+'">حذف المشروع</button></article>'}).join('')||'<p class="empty">لا توجد مشاريع داخل هذه الحقيبة بعد. استخدم نموذج الإضافة أعلاه.</p>';
 root.querySelectorAll('[data-bag-delete]').forEach(function(btn){btn.onclick=function(){var d=current(i);d.bag.projects.splice(Number(btn.dataset.bagDelete),1);saveBags(d.all);renderProjects(i)}});
}
function workspace(i,p){
 var v=document.getElementById('portfolioGalleryView');if(!v||document.getElementById('briefcaseWorkspace'))return;
 var host=document.createElement('div');host.id='briefcaseWorkspace';host.innerHTML=
 '<div class="briefcase-grid">'+
 '<section class="panel"><div class="panel-head"><h3>📁 معلومات الحقيبة الاستثمارية</h3><small>ملف مستقل لكل محفظة</small></div>'+
 '<form id="bagInfoForm" class="bag-form">'+
 '<label class="field">اسم المحفظة<input name="name" maxlength="100"></label>'+
 '<label class="field">الموقع / المحافظة<input name="location" placeholder="مثال: دمشق، سوريا"></label>'+
 '<label class="field">الهدف الاستثماري<input name="objective" placeholder="الهدف من المحفظة"></label>'+
 '<label class="field">حجم الاستثمار التقديري<input name="budget" placeholder="القيمة والعملة"></label>'+
 '<label class="field">حالة المحفظة<select name="status"><option>قيد الدراسة</option><option>جاهزة للاستثمار</option><option>قيد التنفيذ</option><option>مكتملة</option><option>متوقفة</option></select></label>'+
 '<label class="field">المدة المتوقعة<input name="timeline" placeholder="مثال: 24 شهراً"></label>'+
 '<label class="field full">الوصف والتفاصيل<textarea name="description" rows="4" placeholder="نبذة عن الفرصة، المساحة، المتطلبات، العوائد المتوقعة والملاحظات"></textarea></label>'+
 '<button class="btn gold full" type="submit">حفظ معلومات الحقيبة</button></form></section>'+
 '<section class="panel"><div class="panel-head"><h3>🏗️ المشاريع والفرص داخل الحقيبة</h3><small id="bagProjectCount">0 مشروع</small></div>'+
 '<form id="bagProjectForm" class="bag-form">'+
 '<label class="field">اسم المشروع<input name="name" required placeholder="اسم المشروع"></label>'+
 '<label class="field">المدينة / الموقع<input name="location" placeholder="المدينة أو المنطقة"></label>'+
 '<label class="field">الميزانية التقديرية<input name="budget" placeholder="القيمة والعملة"></label>'+
 '<label class="field">الحالة<input name="status" placeholder="قيد الدراسة"></label>'+
 '<label class="field full">تفاصيل المشروع<textarea name="details" rows="3" placeholder="المساحة، المتطلبات، الشركاء، الملاحظات..."></textarea></label>'+
 '<button class="btn gold full" type="submit">＋ إضافة مشروع إلى الحقيبة</button></form><div id="bagProjectsList" class="bag-projects-list"></div></section>'+
 '</div><section class="panel"><div class="panel-head"><h3>🖼️ معرض صور الحقيبة</h3><small>الصور المرجعية الخاصة بالمحفظة</small></div></section>';
 var toolbar=v.querySelector('.portfolio-toolbar');toolbar.insertAdjacentElement('afterend',host);
 var d=current(i),form=host.querySelector('#bagInfoForm');
 ['name','location','objective','budget','status','timeline','description'].forEach(function(k){form.elements[k].value=d.bag[k]||(k==='name'?p.name:k==='status'?'قيد الدراسة':'')});
 form.onsubmit=function(e){e.preventDefault();var z=current(i);['name','location','objective','budget','status','timeline','description'].forEach(function(k){z.bag[k]=form.elements[k].value.trim()});saveBags(z.all);document.getElementById('galleryTitle').textContent='📁 '+z.bag.name;toast('تم حفظ بيانات الحقيبة على هذا الجهاز')};
 var pf=host.querySelector('#bagProjectForm');pf.onsubmit=function(e){e.preventDefault();var z=current(i),o=Object.fromEntries(new FormData(pf));z.bag.projects.unshift(o);saveBags(z.all);pf.reset();renderProjects(i);toast('تمت إضافة المشروع إلى الحقيبة')};
 renderProjects(i);
}
function toast(s){if(window.showToast)window.showToast(s)}
function styles(){if(document.getElementById('briefcaseStyles'))return;var st=document.createElement('style');st.id='briefcaseStyles';st.textContent=
 '.briefcase-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}.briefcase-grid .panel{min-width:0}.bag-form{display:grid;grid-template-columns:1fr 1fr;gap:11px}.bag-form .field.full,.bag-form button.full{grid-column:1/-1}.bag-form textarea{width:100%;background:#0b2030;color:#edf2f5;border:1px solid #36505f;border-radius:8px;padding:10px;font:inherit}.bag-projects-list{display:grid;gap:10px;margin-top:14px}.bag-project-card{padding:13px;border:1px solid #294958;border-radius:10px;background:#0b2030}.bag-project-card h4{margin:0 0 7px;color:#f0d18b}.bag-project-card p{font-size:12px;color:#c2cdd4;line-height:1.7;margin:4px 0}.portfolio-card .module-card p:last-child{color:#d9b15f!important}@media(max-width:760px){.briefcase-grid{grid-template-columns:1fr}.bag-form{grid-template-columns:1fr}.bag-form .field.full,.bag-form button.full{grid-column:auto}}';
 document.head.appendChild(st)}
function init(){
 styles();
 if(typeof window.render==='function'&&!window.render.__briefcase){var oldRender=window.render;window.render=function(){oldRender();document.querySelectorAll('[data-portfolio] .module-card p:last-child').forEach(function(x){x.textContent='📁 فتح الحقيبة الاستثمارية ←'})};window.render.__briefcase=true;window.render()}
 if(typeof window.openPortfolio==='function'&&!window.openPortfolio.__briefcase){var oldOpen=window.openPortfolio;window.openPortfolio=function(i){oldOpen(i);var p=window.portfolios?window.portfolios[i]:null;if(!p){try{p=portfolios[i]}catch(e){}}if(p)workspace(i,p)};window.openPortfolio.__briefcase=true}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
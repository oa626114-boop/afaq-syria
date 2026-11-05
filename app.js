const toast=document.getElementById('toast');let toastTimer;
const $=id=>document.getElementById(id);
function notify(m){toast.textContent=m;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),3500)}
let apiBase=localStorage.getItem('afaqWalletApi')||'', token=sessionStorage.getItem('afaqWalletToken')||'';
$('apiBase').value=apiBase;
async function api(path,options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(token) headers.Authorization='Bearer '+token;
  const res=await fetch(apiBase.replace(/\/+$/,'')+path,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.ok===false) throw new Error(data.error||'تعذر الاتصال بالخادم');
  return data;
}
function showAuth(logged){
  $('loginPanel').hidden=logged;$('accountBar').hidden=!logged;
  document.querySelectorAll('.balance-card,.stats,.mining-card,.quick,.activity').forEach(e=>e.style.opacity=logged?'1':'.45');
  document.querySelectorAll('.mine-btn,[data-action]').forEach(e=>e.disabled=!logged);
}
async function refresh(){
 const d=await api('/api/wallet/summary');
 document.querySelector('.balance').innerHTML=(Number(d.balance_units)/1000000).toFixed(6)+' <small>AFAQ</small>';
 const active=d.mining.active;
 document.querySelector('.stat:nth-child(2) b').textContent=active?'نشط':'متوقف';
 document.querySelector('.stat:nth-child(2) small').textContent=d.mining.enabled?'مكافآت داخلية':'بانتظار تفعيل الإدارة';
 $('mineButton').textContent=active?'إيقاف التعدين واستلام المكافأة':'ابدأ التعدين';
 $('mineButton').disabled=!d.mining.enabled;
 $('memberLabel').textContent='رقم العضوية: '+d.member_id;
 showAuth(true);
}
$('loginButton').addEventListener('click',async()=>{
 apiBase=$('apiBase').value.trim().replace(/\/+$/,'');
 if(!/^https:\/\//i.test(apiBase)){notify('أدخل رابط API صحيحاً يبدأ بـ HTTPS');return}
 localStorage.setItem('afaqWalletApi',apiBase);
 $('loginButton').disabled=true;
 try{
  const d=await api('/api/member/login',{method:'POST',body:JSON.stringify({login:$('loginId').value.trim(),password:$('loginPassword').value})});
  token=d.token;sessionStorage.setItem('afaqWalletToken',token);
  $('loginPassword').value='';await refresh();notify('تم تسجيل الدخول والتحقق من حساب آفاق سوريا');
 }catch(e){notify(e.message)}finally{$('loginButton').disabled=false}
});
$('logoutButton').addEventListener('click',async()=>{
 try{await api('/api/member/logout',{method:'POST'})}catch{}
 token='';sessionStorage.removeItem('afaqWalletToken');showAuth(false);notify('تم تسجيل الخروج');
});
$('mineButton').addEventListener('click',async()=>{
 $('mineButton').disabled=true;
 try{
  const active=$('mineButton').textContent.includes('إيقاف');
  const d=await api(active?'/api/wallet/mining/stop':'/api/wallet/mining/start',{method:'POST',body:'{}'});
  if(d.reward_units!==undefined)notify('تم إنهاء جلسة التعدين. المكافأة: '+(d.reward_units/1000000).toFixed(6)+' AFAQ');
  else notify('بدأت جلسة التعدين على الخادم');
  await refresh();
 }catch(e){notify(e.message)}finally{$('mineButton').disabled=false}
});
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>notify('هذه الخدمة ستُفعّل بعد استكمال مراجعة الأمان وسجل القيود.')));
showAuth(false);
if(token&&apiBase){refresh().catch(()=>{token='';sessionStorage.removeItem('afaqWalletToken');showAuth(false)})}
if('serviceWorker'in navigator) addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

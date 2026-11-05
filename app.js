const toast = document.getElementById('toast');
let toastTimer;
function notify(message){
  toast.textContent=message;toast.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),3200);
}
document.getElementById('mineButton').addEventListener('click',()=>{
  notify('سيتم تفعيل التعدين بعد تجهيز خادم AFAQ والتحقق من عضويتك.');
});
document.querySelectorAll('[data-action]').forEach(button=>{
  button.addEventListener('click',()=>{
    const labels={send:'التحويلات ستتاح بعد ربط الخادم والتحقق من الرصيد.',receive:'سيتم إنشاء عنوان استقبال آمن بعد تفعيل المحفظة.',history:'سيظهر سجل العمليات بعد ربط قاعدة البيانات.',security:'إعدادات الأمان ستتاح بعد تفعيل تسجيل الدخول.'};
    notify(labels[button.dataset.action]||'هذه الوظيفة قيد التجهيز.');
  });
});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}

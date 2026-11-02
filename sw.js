const CACHE='afaq-syria-shell-v10';
const FILES=['./','./index.html','./payment.html','./manifest.webmanifest','./icon.svg','./afaq-enhancements.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);if(u.origin!==location.origin)return;
 const isPage=e.request.mode==='navigate'||u.pathname.endsWith('.html')||u.pathname.endsWith('/');
 e.respondWith(isPage
  ? fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request).then(c=>c||caches.match('./index.html')))
  : caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(x=>x.put(e.request,copy));}return r;}))
 );
});

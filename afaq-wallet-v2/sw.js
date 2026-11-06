const CACHE = 'afaq-wallet-shell-v7';;;
const FILES = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(FILES.map(file => cache.add(file)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('afaq-wallet-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put('./index.html', response.clone());
        return response;
      } catch { return (await caches.match(request)) || (await caches.match('./index.html')) || Response.error(); }
    })()); return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request); if (cached) return cached;
    try { const response = await fetch(request); if (response.ok) (await caches.open(CACHE)).put(request, response.clone()); return response; }
    catch { return Response.error(); }
  })());
});
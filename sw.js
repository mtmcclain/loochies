/* Minimal offline cache for Loochies */
const CACHE_NAME = 'loochies-v1';
const OFFLINE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // Only cache GET from same-origin
        try {
          if (req.method === 'GET' && new URL(req.url).origin === location.origin) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(()=>{});
          }
        } catch {}
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});


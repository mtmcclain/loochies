/* Loochies Service Worker
 * v5: bump cache, network-first for HTML/JS, never cache sw.js
 */
const CACHE_NAME = 'loochies-v5';
const OFFLINE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
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
  const url = new URL(req.url);
  // Never intercept the service worker itself
  if (url.pathname.endsWith('sw.js')) return;

  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.includes('text/html');
  const isJS = url.pathname.endsWith('.js') || (event.request.destination === 'script');

  // Network-first for HTML and JS so updates are seen immediately.
  if (isHTML || isJS) {
    event.respondWith(
      fetch(req).then((resp) => {
        // cache a copy for offline
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(()=>{});
        return resp;
      }).catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // fallback to index for navigation
        if (isHTML) return caches.match('./index.html');
        throw new Error('Offline');
      })
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (req.method === 'GET' && url.origin === location.origin) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(()=>{});
        }
        return resp;
      });
    })
  );
});


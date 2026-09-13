const CACHE_NAME = 'quickclip-v2.2-cache';
const STATIC_ASSETS = [
  '/',
  '/static/css/style.css',
  '/static/js/crypto.js',
  '/static/js/app.js',
  '/static/js/webrtc.js',
  '/static/js/altcha.js',
  '/static/js/qrcode.min.js',
  '/static/manifest.json',
  '/static/assets/logo-mark.png',
  '/static/assets/favicon-32.png',
  '/static/assets/favicon-64.png',
  '/static/assets/icon-192.png',
  '/static/assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests for static assets, not API endpoints or WebSockets
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch background update
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});

const CACHE_NAME = 'reyo-pack-shell-v1';
const SHELL = ['/offline.html', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.url.includes('/api/') || request.url.includes('supabase.co')) return;
  event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
});

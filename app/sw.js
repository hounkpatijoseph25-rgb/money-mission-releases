/* Genere par tools/sync-legacy.mjs. Ne pas modifier a la main. */
const VERSION = "steadypath-accounts-20261017-v1";
const CACHE = 'money-mission-' + VERSION;
// Coquille de l'application. Le moteur OCR (vendor/ocr, 14 Mo) en est volontairement exclu :
// il n'est mis en cache qu'a la premiere utilisation du scan de recus.
const SHELL = ['./', 'index.html', 'legacy.js', 'style.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'account.css', 'assets/steadypath.js', 'assets/index-DEN-giK1.css'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation : on sert la coquille, l'application se rend toute seule.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch { return (await caches.match('index.html')) ?? Response.error(); }
    })());
    return;
  }

  // Moteur OCR : fichiers volumineux et immuables, donc cache d'abord, mise en cache a la demande.
  if (url.pathname.includes('/vendor/ocr/')) {
    event.respondWith((async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
      return response;
    })());
    return;
  }

  // Le reste : on sert le cache tout de suite et on rafraichit en arriere-plan.
  event.respondWith((async () => {
    const hit = await caches.match(request);
    const network = fetch(request).then(async response => {
      if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
      return response;
    }).catch(() => hit ?? Response.error());
    return hit ?? network;
  })());
});

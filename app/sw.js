// =========================
// SERVICE WORKER – Lehrfahrer PWA
// =========================
// Strategie:
//   App-Shell   → Cache-First (immer sofort aus Cache)
//   API-Calls   → Network-First, Cache als Offline-Fallback
//   CDN-Libs    → Cache-First nach erstem Laden

const CACHE_APP = 'lehrfahrer-app-v21025';
const CACHE_API  = 'lehrfahrer-api-v1';

// App-Shell einschließlich der bereits verwendeten Kartenbibliotheken
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css?v=V2.1.025',
  './js/app.js?v=V2.1.025',
  './js/map.js?v=V2.1.025',
  './js/debug-helper.js?v=V2.1.025',
  'https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js',
  'https://unpkg.com/pmtiles@3/dist/pmtiles.js',
  './glyphs/Noto%20Sans%20Bold/0-255.pbf',
  './glyphs/Noto%20Sans%20Bold/256-511.pbf',
  './glyphs/Noto%20Sans%20Bold/8192-8447.pbf',
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate – alte Caches aufräumen ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_APP && k !== CACHE_API)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API-Anfragen: Network-first, Cache als Fallback
  if (url.pathname.includes('/api/')) {
    event.respondWith(networkFirstAPI(event.request));
    return;
  }

  // OpenFreeMap-Kacheln: Cache-first (nach erstem Laden offline verfügbar)
  if (url.hostname === 'tiles.openfreemap.org') {
    if (url.searchParams.get('lf-online-check') === '1') {
      event.respondWith(networkOnlyMapCheck(event.request));
      return;
    }
    event.respondWith(cacheFirstTile(event.request));
    return;
  }

  // OSM-Kacheln (Fallback): Cache-first
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(cacheFirstTile(event.request));
    return;
  }

  // App-Shell + CDN-Libs: Cache-first
  event.respondWith(cacheFirstApp(event.request));
});

async function networkFirstAPI(request) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(CACHE_API);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(
      JSON.stringify({ ok: false, error: 'Offline – kein Cache vorhanden.' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function cacheFirstApp(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_APP);
    cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline – Ressource nicht im Cache.', { status: 503 });
  }
}

async function cacheFirstTile(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Im Hintergrund cachen – blockiert die Antwort NICHT
      caches.open(CACHE_APP).then(cache => cache.put(request, response.clone()));
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── Nachricht von der App – Route manuell cachen ─────────────
async function networkOnlyMapCheck(request) {
  try {
    return await fetch(request, { cache: 'no-store' });
  } catch {
    return new Response('', { status: 503 });
  }
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data && event.data.type === 'CACHE_ROUTE') {
    const { url, data } = event.data;
    caches.open(CACHE_API).then(cache => {
      const response = new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      });
      cache.put(url, response);
    });
  }
});

// =========================
// SERVICE WORKER – Lehrfahrer PWA
// =========================
// Strategie:
//   App-Shell   → Cache-First (immer sofort aus Cache)
//   API-Calls   → nur Netzwerk; Offline-Linien liegen im mandantengeprüften IndexedDB
//   CDN-Libs    → Cache-First nach erstem Laden

const CACHE_APP = 'lehrfahrer-app-v21065-259fd3153c5f-4fdc2e444274';

// App-Shell einschließlich der bereits verwendeten Kartenbibliotheken
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css?v=V2.1.063-4fdc2e444274',
  './js/app.js?v=V2.1.065-259fd3153c5f',
  '../js/tenant-cache-boundary.js?v=6f1f3c95d4c9',
  './js/map.js?v=V2.1.063',
  './js/local-bus-routing-storage.js',
  './js/debug-helper.js?v=c6059d9a1163',
  './js/local-bus-router.js?v=V2.1.063',
  './js/local-bus-router.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js',
  './glyphs/Noto%20Sans%20Bold/0-255.pbf',
  './glyphs/Noto%20Sans%20Bold/256-511.pbf',
  './glyphs/Noto%20Sans%20Bold/8192-8447.pbf',
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// ── Activate – alte Caches aufräumen ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_APP)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API-Antworten enthalten Mandantendaten und werden nie gemeinsam gecacht.
  if (url.pathname.includes('/api/')) {
    // Der Verbindungscheck muss den Server erreichen und darf keinen API-Cache lesen.
    if (url.pathname.endsWith('/api/list_cities.php') && url.searchParams.has('lf-connection-check')) {
      event.respondWith(fetch(event.request));
      return;
    }
    event.respondWith(fetch(event.request));
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

  // Nur bekannte statische App-Shell-Ressourcen duerfen in den globalen Cache.
  const shellUrls = APP_SHELL.map(path => new URL(path, self.registration.scope).href);
  if (shellUrls.includes(url.href)) {
    event.respondWith(cacheFirstApp(event.request));
    return;
  }
  event.respondWith(fetch(event.request));
});

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

});

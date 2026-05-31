// =========================
// APP LOGIC – Lehrfahrer PWA
// =========================

const API_BASE = '../api';
const DB_NAME  = 'lehrfahrer-offline';
const DB_VER   = 1;

let db          = null;
let currentRoute = null;
let gpsActive   = false;
let pmtilesUrl  = null; // gesetzt wenn lokale PMTiles-Datei geladen wurde
let gpsFirstFixTimer = null;

// Nav-Zustand
let navActive    = false;
let navFirstFix  = false;
let navTurns     = [];
let navCumDists  = [];
let navStopDists = [];

// Simulations-Zustand
let simTimer     = null;
let simRunning   = false;

// ── DOM-Referenzen ───────────────────────────────────────────
const citySelect       = document.getElementById('citySelect');
const lineSelect       = document.getElementById('lineSelect');
const saveOfflineBtn   = document.getElementById('saveOfflineBtn');
const offlineBadge     = document.getElementById('offlineBadge');
const gpsBtn           = document.getElementById('gpsBtn');
const settingsBtn      = document.getElementById('settingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsOverlay  = document.getElementById('settingsOverlay');
const panelHandle      = document.getElementById('panelHandle');
const panelCloseBtn    = document.getElementById('panelCloseBtn');
const panel            = document.getElementById('panel');
const panelTitle       = document.getElementById('panelTitle');
const panelMeta        = document.getElementById('panelMeta');
const stopList         = document.getElementById('stopList');
const tileStatus       = document.getElementById('tileStatus');
const loadLocalTilesBtn= document.getElementById('loadLocalTilesBtn');
const tilesFileInput   = document.getElementById('tilesFileInput');
const clearOfflineCacheBtn = document.getElementById('clearOfflineCacheBtn');
const offlineRouteList = document.getElementById('offlineRouteList');

// Nav-DOM-Referenzen
const navBtn        = document.getElementById('navBtn');
const navHud        = document.getElementById('navHud');
const navArrowEl    = document.getElementById('navArrow');
const navDistEl     = document.getElementById('navDist');
const navLabelEl    = document.getElementById('navLabel');
const navStopNameEl = document.getElementById('navStopName');
const navStopDistEl = document.getElementById('navStopDist');
const navSpeedEl    = document.getElementById('navSpeed');

// Simulations-DOM-Referenzen
const simBtn         = document.getElementById('simBtn');
const simSpeedSelect = document.getElementById('simSpeedSelect');
const simChip        = document.getElementById('simChip');
const simChipLabel   = document.getElementById('simChipLabel');
const simChipFill    = document.getElementById('simChipFill');
const simStopBtn     = document.getElementById('simStopBtn');

// ── Start ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  registerServiceWorker();
  await openDB();
  initMap();
  bindEvents();
  detectOffline();
  await loadCities();
});

// ── Service Worker ───────────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.warn('SW-Registrierung fehlgeschlagen:', err));
  }
}

// ── IndexedDB ────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('routes')) {
        d.createObjectStore('routes', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror   = () => reject(req.error);
  });
}

function dbPut(key, data) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('routes', 'readwrite');
    const req = tx.objectStore('routes').put({ key, data, savedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbGet(key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('routes', 'readonly');
    const req = tx.objectStore('routes').get(key);
    req.onsuccess = () => resolve(req.result?.data ?? null);
    req.onerror   = () => reject(req.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('routes', 'readonly');
    const req = tx.objectStore('routes').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('routes', 'readwrite');
    const req = tx.objectStore('routes').delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Offline-Erkennung (per echtem Fetch-Test, nicht navigator.onLine) ────────
function detectOffline() {
  async function checkOnline() {
    try {
      await fetch('../api/list_cities.php', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(4000) });
      offlineBadge.classList.add('hidden');
    } catch {
      offlineBadge.classList.remove('hidden');
    }
  }
  window.addEventListener('online',  checkOnline);
  window.addEventListener('offline', () => offlineBadge.classList.remove('hidden'));
  checkOnline();
}

// ── Events binden ────────────────────────────────────────────
function bindEvents() {
  citySelect.addEventListener('change', onCityChange);
  lineSelect.addEventListener('change', onLineChange);
  saveOfflineBtn.addEventListener('click', saveCurrentRouteOffline);

  gpsBtn.addEventListener('click', toggleGPS);
  settingsBtn.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', e => {
    if (e.target === settingsOverlay) closeSettings();
  });

  panelHandle.addEventListener('click', togglePanel);
  if (panelCloseBtn) panelCloseBtn.addEventListener('click', () => setPanelOpen(false));

  loadLocalTilesBtn.addEventListener('click', () => tilesFileInput.click());
  tilesFileInput.addEventListener('change', onTilesFileSelected);
  clearOfflineCacheBtn.addEventListener('click', clearAllOfflineRoutes);

  navBtn.addEventListener('click', () => {
    if (navActive) stopNavigation();
    else startNavigation();
  });

  simBtn.addEventListener('click', () => {
    if (simRunning) stopSimulation(false);
    else startSimulation();
  });
  simStopBtn.addEventListener('click', stopSimulation);
}

// ── Städte laden ─────────────────────────────────────────────
async function loadCities() {
  try {
    const res  = await fetch(`${API_BASE}/list_cities.php`);
    const json = await res.json();
    if (!json.ok || !json.cities.length) return;

    json.cities.forEach(city => {
      const opt = document.createElement('option');
      opt.value       = city;
      opt.textContent = capitalizeCity(city);
      citySelect.appendChild(opt);
    });

    // Einzige Stadt automatisch vorwählen
    if (json.cities.length === 1) {
      citySelect.value = json.cities[0];
      await loadLines(json.cities[0]);
    }
  } catch (err) {
    console.warn('Städte laden fehlgeschlagen:', err);
  }
}

async function onCityChange() {
  lineSelect.innerHTML = '<option value="">Linie …</option>';
  lineSelect.disabled  = true;
  saveOfflineBtn.disabled = true;
  if (!citySelect.value) return;
  await loadLines(citySelect.value);
}

// ── Linien laden ─────────────────────────────────────────────
async function loadLines(city) {
  try {
    const res  = await fetch(`${API_BASE}/list_lines.php?city=${encodeURIComponent(city)}`);
    const json = await res.json();
    if (!json.ok || !json.lines.length) {
      lineSelect.innerHTML = '<option value="">Keine Linien vorhanden</option>';
      return;
    }

    lineSelect.innerHTML = '<option value="">Linie wählen …</option>';
    json.lines.forEach(line => {
      const opt      = document.createElement('option');
      opt.value      = JSON.stringify({ fileBase: line.fileBase || line.id, lineFolder: line.lineFolder || null });
      opt.textContent = `${line.lineName || line.id}${line.routeName ? ' · ' + line.routeName : ''}`;
      lineSelect.appendChild(opt);
    });

    lineSelect.disabled = false;
  } catch (err) {
    console.warn('Linien laden fehlgeschlagen:', err);
  }
}

async function onLineChange() {
  saveOfflineBtn.disabled = true;
  currentRoute = null;
  if (!lineSelect.value) return;

  const { fileBase, lineFolder } = JSON.parse(lineSelect.value);
  const city = citySelect.value;

  await loadAndShowRoute(city, fileBase, lineFolder);
}

// ── Route laden und anzeigen ─────────────────────────────────
async function loadAndShowRoute(city, fileBase, lineFolder) {
  const key = `${city}/${lineFolder || ''}/${fileBase}`;

  // Erst offline-Cache prüfen
  let data = null;
  try { data = await dbGet(key); } catch {}

  // Dann Server versuchen
  if (!data) {
    try {
      let url = `${API_BASE}/load_line.php?city=${encodeURIComponent(city)}&line=${encodeURIComponent(fileBase)}`;
      if (lineFolder) url += `&lineFolder=${encodeURIComponent(lineFolder)}`;

      const res  = await fetch(url);
      const json = await res.json();
      if (json.ok && json.line) {
        data = json.line;
      }
    } catch (err) {
      console.warn('Route laden fehlgeschlagen:', err);
    }
  }

  if (!data) {
    stopList.innerHTML = '<p class="hint">Route nicht verfügbar – auch offline nicht gespeichert.</p>';
    return;
  }

  currentRoute = { city, fileBase, lineFolder, key, data };
  saveOfflineBtn.disabled = false;

  displayRoute(data);
}

// ── Route darstellen ─────────────────────────────────────────
function displayRoute(data) {
  // Karte
  if (data.routePoints && data.routePoints.length) {
    showRoute(data.routePoints);
  }
  if (data.stops && data.stops.length) {
    showStops(data.stops, (i, stop) => {
      flyToStop(stop);
      highlightStopInList(i);
    });
  }

  // Panel-Header
  panelTitle.textContent = data.lineName  || 'Route';
  panelMeta.textContent  = data.routeName || '';

  // Haltestellenliste
  renderStopList(data.stops || []);
  setPanelOpen(true);

  // Navi-Button + Sim-Button freischalten
  navBtn.classList.remove('hidden');
  simBtn.classList.remove('hidden');
}

function renderStopList(stops) {
  if (!stops.length) {
    stopList.innerHTML = '<p class="hint">Keine Haltestellen vorhanden.</p>';
    return;
  }

  stopList.innerHTML = '';
  stops.forEach((stop, i) => {
    const item = document.createElement('div');
    item.className   = 'stop-item';
    item.dataset.idx = i;

    item.innerHTML = `
      <span class="stop-index">${i + 1}</span>
      <span class="stop-dot-icon"></span>
      <span class="stop-name">${stop.name}</span>
      ${stop.minuteFromStart > 0
        ? `<span class="stop-minute">+${stop.minuteFromStart} min</span>`
        : ''}
    `;

    item.addEventListener('click', () => {
      flyToStop(stop);
      highlightStopInList(i);
    });

    stopList.appendChild(item);
  });
}

function highlightStopInList(index) {
  document.querySelectorAll('.stop-item').forEach((el, i) => {
    el.style.background = i === index ? 'var(--surface2)' : '';
  });
  const target = stopList.querySelector(`[data-idx="${index}"]`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Offline speichern ────────────────────────────────────────
async function saveCurrentRouteOffline() {
  if (!currentRoute) return;

  try {
    await dbPut(currentRoute.key, currentRoute.data);
    saveOfflineBtn.textContent = '✓';
    saveOfflineBtn.title = 'Route ist offline gespeichert';
    setTimeout(() => {
      saveOfflineBtn.textContent = '⬇';
      saveOfflineBtn.title = 'Route für Offline-Nutzung speichern';
    }, 2000);
  } catch (err) {
    alert('Speichern fehlgeschlagen: ' + err.message);
  }
}

// ── Offline-Routen-Liste in Einstellungen ────────────────────
async function renderOfflineRouteList() {
  const entries = await dbGetAll();
  if (!entries.length) {
    offlineRouteList.innerHTML = '<p class="hint">Keine Routen gespeichert.</p>';
    return;
  }

  offlineRouteList.innerHTML = '';
  entries.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'offline-route-entry';
    div.innerHTML = `
      <span>${entry.data.lineName || entry.key}</span>
      <button title="Route aus Offline-Speicher löschen">🗑</button>
    `;
    div.querySelector('button').addEventListener('click', async () => {
      await dbDelete(entry.key);
      await renderOfflineRouteList();
    });
    offlineRouteList.appendChild(div);
  });
}

async function clearAllOfflineRoutes() {
  if (!confirm('Alle gespeicherten Offline-Routen löschen?')) return;
  const entries = await dbGetAll();
  for (const e of entries) await dbDelete(e.key);
  await renderOfflineRouteList();
}

function gpsAllowedContext() {
  if (window.isSecureContext) return true;
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function clearGpsFirstFixTimer() {
  if (gpsFirstFixTimer) {
    clearTimeout(gpsFirstFixTimer);
    gpsFirstFixTimer = null;
  }
}

function armGpsFirstFixTimer(scopeLabel) {
  clearGpsFirstFixTimer();
  gpsFirstFixTimer = setTimeout(() => {
    showToast(`${scopeLabel}: Noch kein GPS-Fix. Bitte Standortfreigabe, HTTPS und freie Sicht zum Himmel pruefen.`, 7000);
  }, 12000);
}

// ── PMTiles-Datei laden ──────────────────────────────────────
function onTilesFileSelected() {
  const file = tilesFileInput.files[0];
  if (!file) return;

  // OPFS (Origin Private File System) – moderne Browser
  if (navigator.storage && navigator.storage.getDirectory) {
    navigator.storage.getDirectory().then(async root => {
      const fileHandle = await root.getFileHandle('region.pmtiles', { create: true });
      const writable   = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();

      pmtilesUrl = 'opfs://region.pmtiles';
      tileStatus.textContent = `Karte: Offline (${file.name})`;
      switchToPMTiles(pmtilesUrl);
    }).catch(err => {
      // Fallback: Object-URL (nur für aktuelle Session)
      pmtilesUrl = URL.createObjectURL(file);
  tileStatus.textContent = `Karte: Lokal geladen (${file.name}) – wird nach Neustart zurückgesetzt`;
      switchToPMTiles(pmtilesUrl);
    });
  } else {
    pmtilesUrl = URL.createObjectURL(file);
    tileStatus.textContent = `Karte: Lokal geladen (${file.name})`;
    switchToPMTiles(pmtilesUrl);
  }
}

// ── GPS toggle ───────────────────────────────────────────────
function toggleGPS() {
  if (gpsActive) {
    stopGPS();
    clearGpsFirstFixTimer();
    gpsActive = false;
    gpsBtn.style.color = '';
    gpsBtn.title = 'GPS aktivieren und auf meinen Standort zentrieren';
  } else {
    if (!gpsAllowedContext()) {
      showToast('GPS funktioniert nur mit HTTPS (oder localhost). Auf iPhone in Safari ueber sichere URL oeffnen.', 8000);
      return;
    }

    armGpsFirstFixTimer('GPS');

    const ok = startGPS(
      null,
      (_err, msg) => {
        clearGpsFirstFixTimer();
        showToast(msg, 7000);
        stopGPS();
        gpsActive = false;
        gpsBtn.style.color = '';
        gpsBtn.title = 'GPS aktivieren und auf meinen Standort zentrieren';
      },
      () => {
        clearGpsFirstFixTimer();
        flyToUser();
      }
    );
    if (ok) {
      gpsActive = true;
      gpsBtn.style.color = '#4a9eff';
      gpsBtn.title = 'GPS aktiv – klicken zum Deaktivieren';
    } else {
      clearGpsFirstFixTimer();
      alert('GPS ist auf diesem Gerät nicht verfügbar.');
    }
  }
}

// ── Panel toggle ─────────────────────────────────────────────
function togglePanel() {
  setPanelOpen(!panel.classList.contains('panel-open'));
}

function setPanelOpen(isOpen) {
  panel.classList.toggle('panel-open', isOpen);
  panel.classList.toggle('panel-collapsed', !isOpen);
  document.body.classList.toggle('panel-is-open', isOpen);
}

// ── Einstellungen ─────────────────────────────────────────────
function openSettings() {
  settingsOverlay.classList.remove('hidden');
  renderOfflineRouteList();
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

// ── Hilfsfunktionen ───────────────────────────────────────────
function capitalizeCity(str) {
  return str
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-');
}

// Kartenperspektive lesen (von map.js via getMapPerspective() abgerufen)
function getMapPerspective() {
  const checked = document.querySelector('input[name="mapPerspective"]:checked');
  return checked ? checked.value : 'driver';
}

// Heading-Glättung: gleitender Durchschnitt über letzte 5 GPS-Richtungswerte
const _headingBuf = [];
function smoothHeading(hdg) {
  if (hdg == null || isNaN(hdg)) return null;
  _headingBuf.push(hdg);
  if (_headingBuf.length > 5) _headingBuf.shift();
  // Kreismittelwert (verhindert Sprung zwischen 359° → 1°)
  let sinSum = 0, cosSum = 0;
  for (const h of _headingBuf) {
    sinSum += Math.sin(h * Math.PI / 180);
    cosSum += Math.cos(h * Math.PI / 180);
  }
  return (Math.atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
}

// Fahrersicht-Zoom-Abschnitt ein-/ausblenden je nach gewählter Perspektive
(function initPerspectiveToggle() {
  function toggleDriverZoom() {
    const mode = getMapPerspective();
    const section = document.getElementById('driverZoomSection');
    if (section) section.classList.toggle('hidden', mode !== 'driver');
  }
  document.querySelectorAll('input[name="mapPerspective"]').forEach(el => {
    el.addEventListener('change', toggleDriverZoom);
  });
  toggleDriverZoom();
})();

// Globale Toast-Funktion (wird auch von map.js genutzt)
function showToast(msg, duration = 4000) {
  let el = document.getElementById('appToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'appToast';
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'background:#c0392b;color:#fff;padding:10px 18px;border-radius:10px;' +
      'font-size:13px;z-index:9999;max-width:90vw;text-align:center;word-break:break-word;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, duration);
  console.error('[Toast]', msg);
}

// =============================================================
// NAVIGATION
// =============================================================

function startNavigation() {
  if (!currentRoute?.data?.routePoints?.length) {
    showToast('Bitte zuerst eine Linie laden.');
    return;
  }

  const pts    = currentRoute.data.routePoints;
  navCumDists  = buildNavCumDists(pts);
  navTurns     = detectNavTurns(pts, navCumDists);
  navStopDists = buildNavStopDists(currentRoute.data.stops || [], pts, navCumDists);

  navActive   = true;
  navFirstFix = false;

  navHud.classList.remove('hidden');
  document.body.classList.add('nav-mode');
  navBtn.textContent = '■';
  navBtn.title       = 'Navigation beenden';
  navBtn.classList.add('nav-active');

  // Initial-Anzeige: erste Abbiegung und erste Haltestelle
  if (navTurns.length) {
    const info = getTurnInfo(navTurns[0].angle);
    navArrowEl.textContent = info.icon;
    navDistEl.textContent  = navFormatDist(navTurns[0].distFromStart);
    navLabelEl.textContent = info.label;
  } else {
    navArrowEl.textContent = '⬆';
    navDistEl.textContent  = '';
    navLabelEl.textContent = 'Geradeaus';
  }
  if (navStopDists.length) {
    navStopNameEl.textContent = navStopDists[0].stop.name;
    navStopDistEl.textContent = navFormatDist(navStopDists[0].distFromStart);
  }

  if (!gpsAllowedContext()) {
    showToast('Navigation braucht HTTPS (oder localhost), sonst liefert iPhone kein GPS.', 8000);
    stopNavigation();
    return;
  }

  armGpsFirstFixTimer('Navigation');

  const ok = startGPS(
    pos => {
      const { latitude: lat, longitude: lon, speed, heading } = pos.coords;
      gpsActive = true;
      gpsBtn.style.color = '#4a9eff';
      navCenterOn(lon, lat, smoothHeading(heading));
      updateNavHud(lat, lon);
      if (navSpeedEl) {
        const kmh = (speed != null && speed >= 0) ? Math.round(speed * 3.6) : '–';
        navSpeedEl.textContent = kmh;
      }
    },
    (_err, msg) => {
      clearGpsFirstFixTimer();
      showToast(msg, 7000);
      stopNavigation();
    },
    () => {
      clearGpsFirstFixTimer();
    }
  );

  if (!ok) {
    clearGpsFirstFixTimer();
    showToast('GPS ist auf diesem Gerät nicht verfügbar.');
    stopNavigation();
  }
}

function stopNavigation() {
  navActive = false;
  navHud.classList.add('hidden');
  document.body.classList.remove('nav-mode');
  navBtn.textContent = '▶';
  navBtn.title       = 'Navigation starten';
  navBtn.classList.remove('nav-active');
  stopGPS();
  clearGpsFirstFixTimer();
  gpsActive = false;
  gpsBtn.style.color = '';
}

// ── Geometrie-Hilfsfunktionen ─────────────────────────────────

function navGetLatLon(p) {
  // routePoints sind [lat, lon] Arrays; stops sind {lat, lon} Objekte
  return Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lon];
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
  const df = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const y  = Math.sin(dl) * Math.cos(f2);
  const x  = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function buildNavCumDists(pts) {
  const d = [0];
  for (let i = 1; i < pts.length; i++) {
    const [la, lo]   = navGetLatLon(pts[i - 1]);
    const [lb, lo2]  = navGetLatLon(pts[i]);
    d.push(d[i - 1] + haversineM(la, lo, lb, lo2));
  }
  return d;
}

function detectNavTurns(pts, cumDists, minAngle = 28, mergeRadius = 35) {
  const turns = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const [la0, lo0] = navGetLatLon(pts[i - 1]);
    const [la1, lo1] = navGetLatLon(pts[i]);
    const [la2, lo2] = navGetLatLon(pts[i + 1]);
    const bIn    = bearingDeg(la0, lo0, la1, lo1);
    const bOut   = bearingDeg(la1, lo1, la2, lo2);
    const angle  = ((bOut - bIn + 540) % 360) - 180; // positiv=rechts, negativ=links
    if (Math.abs(angle) < minAngle) continue;
    const dist = cumDists[i];
    const last = turns[turns.length - 1];
    if (last && (dist - last.distFromStart) < mergeRadius) {
      // Abbiegungen eng zusammen → stärkere behalten
      if (Math.abs(angle) > Math.abs(last.angle)) {
        last.angle = angle; last.index = i; last.distFromStart = dist;
      }
    } else {
      turns.push({ index: i, angle, distFromStart: dist });
    }
  }
  return turns;
}

function buildNavStopDists(stops, pts, cumDists) {
  return stops.map(stop => {
    let minD = Infinity, best = 0;
    for (let i = 0; i < pts.length; i++) {
      const [la, lo] = navGetLatLon(pts[i]);
      const d = haversineM(stop.lat, stop.lon, la, lo);
      if (d < minD) { minD = d; best = i; }
    }
    return { stop, distFromStart: cumDists[best] };
  });
}

function findNearestNavIdx(lat, lon, pts) {
  let minD = Infinity, best = 0;
  for (let i = 0; i < pts.length; i++) {
    const [la, lo] = navGetLatLon(pts[i]);
    const d = haversineM(lat, lon, la, lo);
    if (d < minD) { minD = d; best = i; }
  }
  return best;
}

function getTurnInfo(angle) {
  const a = angle;
  if (Math.abs(a) < 20)      return { icon: '⬆', label: 'Geradeaus' };
  if (a >= 20 && a < 50)     return { icon: '↗', label: 'Leicht rechts' };
  if (a >= 50 && a < 130)    return { icon: '➡', label: 'Rechts abbiegen' };
  if (a >= 130)              return { icon: '↪', label: 'Scharf rechts' };
  if (a <= -20 && a > -50)   return { icon: '↖', label: 'Leicht links' };
  if (a <= -50 && a > -130)  return { icon: '⬅', label: 'Links abbiegen' };
  if (a <= -130)             return { icon: '↩', label: 'Scharf links' };
  return { icon: '⬆', label: 'Weiterfahren' };
}

function navFormatDist(meters) {
  if (meters < 100)  return Math.round(meters / 10) * 10 + ' m';
  if (meters < 1000) return Math.round(meters / 50) * 50 + ' m';
  return (meters / 1000).toFixed(1) + ' km';
}

function updateNavHud(lat, lon) {
  if (!navActive || !currentRoute) return;
  const pts         = currentRoute.data.routePoints;
  const idx         = findNearestNavIdx(lat, lon, pts);
  const currentDist = navCumDists[idx];

  // Nächste Abbiegung
  const nextTurn = navTurns.find(t => t.distFromStart > currentDist + 15);
  if (nextTurn) {
    const info = getTurnInfo(nextTurn.angle);
    navArrowEl.textContent = info.icon;
    navDistEl.textContent  = navFormatDist(nextTurn.distFromStart - currentDist);
    navLabelEl.textContent = info.label;
  } else {
    navArrowEl.textContent = '🏁';
    navDistEl.textContent  = '';
    navLabelEl.textContent = 'Zieleinfahrt';
  }

  // Nächste Haltestelle
  const nextStop = navStopDists.find(s => s.distFromStart > currentDist + 10);
  if (nextStop) {
    navStopNameEl.textContent = nextStop.stop.name;
    navStopDistEl.textContent = navFormatDist(nextStop.distFromStart - currentDist);
  } else {
    navStopNameEl.textContent = (currentRoute.data.stops && currentRoute.data.stops.length
      ? currentRoute.data.stops[currentRoute.data.stops.length - 1].name
      : null) || 'Endstation';
    navStopDistEl.textContent = 'Ziel';
  }
}

// =============================================================
// SIMULATION
// =============================================================

function startSimulation() {
  if (!currentRoute?.data?.routePoints?.length) {
    showToast('Bitte zuerst eine Linie laden.');
    return;
  }
  if (simRunning) return;

  const pts    = currentRoute.data.routePoints;
  const stepMs = parseInt(simSpeedSelect ? simSpeedSelect.value : 600, 10) || 600;
  const total  = pts.length;

  // Nav-Vorberechnungen
  navCumDists  = buildNavCumDists(pts);
  navTurns     = detectNavTurns(pts, navCumDists);
  navStopDists = buildNavStopDists(currentRoute.data.stops || [], pts, navCumDists);

  // Nav-HUD einblenden
  navActive = true;
  navHud.classList.remove('hidden');
  document.body.classList.add('nav-mode');

  // Sim-Button auf "Stopp"
  simRunning = true;
  simBtn.textContent = '■ Stopp';
  simBtn.classList.add('sim-running');

  // Kleinen Chip anzeigen (blockiert Karte NICHT)
  simChip.classList.remove('hidden');
  simChipFill.style.width = '0%';
  simChipLabel.textContent = '▶ Lehrfahrt läuft…';

  // Panel schließen – mehr Kartenansicht
  setPanelOpen(false);

  let step = 0;

  simTimer = setInterval(() => {
    if (!simRunning || step >= total) {
      stopSimulation(step >= total);
      return;
    }

    const p = pts[step];
    const [lat, lon] = Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lon];

    // Heading zum nächsten Punkt
    let heading = null;
    if (step < total - 1) {
      const p2 = pts[step + 1];
      const [lat2, lon2] = Array.isArray(p2) ? [p2[0], p2[1]] : [p2.lat, p2.lon];
      heading = bearingDeg(lat, lon, lat2, lon2);
    }

    setSimulatedGPS(lon, lat, heading);
    simCenterOn(lon, lat, heading);
    updateNavHud(lat, lon);

    step++;
    const pct = Math.round((step / total) * 100);
    simChipFill.style.width = pct + '%';
    simChipLabel.textContent = '▶ ' + pct + ' %';

  }, stepMs);
}

function stopSimulation(completed) {
  simRunning = false;
  if (simTimer) { clearInterval(simTimer); simTimer = null; }

  simChip.classList.add('hidden');
  simBtn.textContent = 'Fahrt ▶';
  simBtn.classList.remove('sim-running');

  navActive = false;
  navHud.classList.add('hidden');
  document.body.classList.remove('nav-mode');

  if (typeof map !== 'undefined' && map) {
    map.easeTo({ pitch: 0, bearing: 0, zoom: 13, duration: 1000 });
  }

  stopGPS();

  if (completed) {
    showToast('✓ Lehrfahrt abgeschlossen!', 5000);
  }
}

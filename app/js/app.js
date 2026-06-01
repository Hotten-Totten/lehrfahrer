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
let navNearestIdx = 0;

// Simulations-Zustand
let simTimer     = null;
let simRunning   = false;
const NAV_SNAP_MAX_M = 85;
const NAV_SNAP_WINDOW = 24;
// Cottbus-Feintuning: robuster gegen Innenstadt-GPS-Drift,
// aber weiterhin klarer OFF->REJOIN->ON Verlauf.
const NAV_OFF_ROUTE_ENTER_M = 145;
const NAV_REJOIN_START_M = 78;
const NAV_REJOIN_BLEND_STEP = 0.20;
let navOffRouteActive = false;
let navRejoinBlend = 0;

// Entwickler-Debug-HUD (nur sichtbar bei explizitem Debug-Flag)
const navPerfDebugEnabled   = resolveNavPerfDebugEnabled();
let navPerfHudEl            = null;
let navPerfLineEl           = null;
let navPerfRecEl            = null;
const navPerfStats = {
  mode: 'idle',
  startedAt: 0,
  ticks: 0,
  totalMs: 0,
  maxMs: 0,
  lastMs: 0,
  fallbackCount: 0,
  snapApplied: 0,
  snapRejected: 0,
  lastSnapM: 0,
  routeState: 'ON',
  rejoinBlend: 0,
  lastRenderAt: 0
};

const navDriveLog = {
  recording: false,
  startedAt: 0,
  samples: [],
  maxSamples: 25000,
  routeMeta: null,
  reason: 'manual'
};

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
const navEndBtn     = document.getElementById('navEndBtn');
const navUpcomingStopsEl = document.getElementById('navUpcomingStops');

// Simulations-DOM-Referenzen
const simBtn         = document.getElementById('simBtn');
const simSpeedSelect = document.getElementById('simSpeedSelect');
const simChip        = document.getElementById('simChip');
const simChipLabel   = document.getElementById('simChipLabel');
const simChipFill    = document.getElementById('simChipFill');
const simStopBtn     = document.getElementById('simStopBtn');
const cameraProfileSelect = document.getElementById('cameraProfileSelect');

const CAMERA_PROFILE_KEY = 'lehrfahrer_camera_profile';

// ── Start ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  registerServiceWorker();
  await openDB();
  initMap();
  initNavPerfDebugHud();
  bindEvents();
  detectOffline();
  await loadCities();
});

function resolveNavPerfDebugEnabled() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const queryValue = params.get('debugHud');
    if (queryValue === '1') return true;
    if (queryValue === '0') return false;
    return false;
  } catch {
    return false;
  }
}

function initNavPerfDebugHud() {
  if (!navPerfDebugEnabled) return;
  navPerfHudEl = document.createElement('div');
  navPerfHudEl.id = 'devNavPerfHud';
  navPerfHudEl.innerHTML = [
    '<div id="devNavPerfLine"></div>',
    '<div id="devNavPerfControls">',
    '  <button type="button" id="devNavLogToggleBtn">REC</button>',
    '  <button type="button" id="devNavLogExportBtn">EXPORT</button>',
    '  <button type="button" id="devNavLogResetBtn">RESET</button>',
    '</div>',
    '<div id="devNavPerfRec">rec=OFF | samples=0</div>'
  ].join('');
  document.body.appendChild(navPerfHudEl);

  navPerfLineEl = document.getElementById('devNavPerfLine');
  navPerfRecEl = document.getElementById('devNavPerfRec');

  const toggleBtn = document.getElementById('devNavLogToggleBtn');
  const exportBtn = document.getElementById('devNavLogExportBtn');
  const resetBtn = document.getElementById('devNavLogResetBtn');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (navDriveLog.recording) stopNavDriveLogSession();
      else startNavDriveLogSession('manual');
      renderNavPerfDebugHud(true);
      renderNavLogState();
    });
  }
  if (exportBtn) exportBtn.addEventListener('click', exportNavDriveLog);
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      navDriveLog.samples = [];
      navDriveLog.routeMeta = null;
      navDriveLog.startedAt = 0;
      navDriveLog.reason = 'manual';
      renderNavLogState();
    });
  }

  renderNavPerfDebugHud(true);
  renderNavLogState();
}

function getCurrentRouteMeta() {
  if (!currentRoute || !currentRoute.data) return null;
  return {
    city: currentRoute.city || null,
    fileBase: currentRoute.fileBase || null,
    lineFolder: currentRoute.lineFolder || null,
    lineName: currentRoute.data.lineName || null,
    routeName: currentRoute.data.routeName || null
  };
}

function startNavDriveLogSession(reason = 'manual') {
  if (!navPerfDebugEnabled) return;
  navDriveLog.recording = true;
  navDriveLog.startedAt = Date.now();
  navDriveLog.samples = [];
  navDriveLog.routeMeta = getCurrentRouteMeta();
  navDriveLog.reason = reason;
  renderNavLogState();
}

function stopNavDriveLogSession() {
  if (!navPerfDebugEnabled) return;
  navDriveLog.recording = false;
  renderNavLogState();
}

function renderNavLogState() {
  if (!navPerfDebugEnabled || !navPerfRecEl) return;
  const rec = navDriveLog.recording ? 'ON' : 'OFF';
  navPerfRecEl.textContent = `rec=${rec} | samples=${navDriveLog.samples.length}`;
}

function recordNavDriveSample(rawLat, rawLon, tracked, speed, heading) {
  if (!navPerfDebugEnabled || !navDriveLog.recording) return;
  const elapsedMs = navDriveLog.startedAt ? (Date.now() - navDriveLog.startedAt) : 0;
  navDriveLog.samples.push({
    ts: Date.now(),
    elapsedMs,
    rawLat,
    rawLon,
    trackedLat: tracked.lat,
    trackedLon: tracked.lon,
    routeState: tracked.routeState,
    snapDistanceM: tracked.snapDistanceM,
    snapApplied: tracked.snapApplied,
    nearestIdx: tracked.index,
    offRoute: navOffRouteActive,
    rejoinBlend: navRejoinBlend,
    speedMps: (speed != null && !Number.isNaN(speed)) ? speed : null,
    headingDeg: (heading != null && !Number.isNaN(heading)) ? heading : null
  });

  if (navDriveLog.samples.length > navDriveLog.maxSamples) {
    navDriveLog.samples.splice(0, 1000);
  }
  renderNavLogState();
}

function exportNavDriveLog() {
  if (!navPerfDebugEnabled) return;
  const payload = {
    exportedAt: new Date().toISOString(),
    reason: navDriveLog.reason,
    routeMeta: navDriveLog.routeMeta,
    sampleCount: navDriveLog.samples.length,
    thresholds: {
      snapMaxM: NAV_SNAP_MAX_M,
      offRouteEnterM: NAV_OFF_ROUTE_ENTER_M,
      rejoinStartM: NAV_REJOIN_START_M,
      rejoinBlendStep: NAV_REJOIN_BLEND_STEP
    },
    samples: navDriveLog.samples
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `nav-drive-log-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function resetNavPerfStats(mode) {
  if (!navPerfDebugEnabled) return;
  navPerfStats.mode = mode;
  navPerfStats.startedAt = performance.now();
  navPerfStats.ticks = 0;
  navPerfStats.totalMs = 0;
  navPerfStats.maxMs = 0;
  navPerfStats.lastMs = 0;
  navPerfStats.fallbackCount = 0;
  navPerfStats.snapApplied = 0;
  navPerfStats.snapRejected = 0;
  navPerfStats.lastSnapM = 0;
  navPerfStats.routeState = 'ON';
  navPerfStats.rejoinBlend = 0;
  navPerfStats.lastRenderAt = 0;
  renderNavPerfDebugHud(true);
}

function noteNavPerfFallback() {
  if (!navPerfDebugEnabled) return;
  navPerfStats.fallbackCount += 1;
}

function noteNavSnap(distanceM, applied) {
  if (!navPerfDebugEnabled) return;
  navPerfStats.lastSnapM = Number.isFinite(distanceM) ? distanceM : 0;
  if (applied) navPerfStats.snapApplied += 1;
  else navPerfStats.snapRejected += 1;
}

function noteNavRouteState(state, blend) {
  if (!navPerfDebugEnabled) return;
  navPerfStats.routeState = state;
  navPerfStats.rejoinBlend = Math.max(0, Math.min(1, Number.isFinite(blend) ? blend : 0));
}

function noteNavPerfTick(durationMs) {
  if (!navPerfDebugEnabled) return;
  navPerfStats.ticks += 1;
  navPerfStats.totalMs += durationMs;
  navPerfStats.lastMs = durationMs;
  if (durationMs > navPerfStats.maxMs) navPerfStats.maxMs = durationMs;
  renderNavPerfDebugHud(false);
}

function renderNavPerfDebugHud(force) {
  if (!navPerfDebugEnabled || !navPerfHudEl) return;
  const now = performance.now();
  if (!force && (now - navPerfStats.lastRenderAt) < 250) return;
  navPerfStats.lastRenderAt = now;

  const elapsedMs = Math.max(1, now - navPerfStats.startedAt);
  const avgMs = navPerfStats.ticks ? (navPerfStats.totalMs / navPerfStats.ticks) : 0;
  const ticksPerSec = navPerfStats.ticks * 1000 / elapsedMs;
  const fallbackRate = navPerfStats.ticks ? (navPerfStats.fallbackCount * 100 / navPerfStats.ticks) : 0;
  const snapSamples = navPerfStats.snapApplied + navPerfStats.snapRejected;
  const snapRate = snapSamples ? (navPerfStats.snapApplied * 100 / snapSamples) : 0;

  const lineText =
    `DEBUG HUD | mode=${navPerfStats.mode} | ticks=${navPerfStats.ticks} | ` +
    `avg=${avgMs.toFixed(3)}ms | max=${navPerfStats.maxMs.toFixed(3)}ms | ` +
    `last=${navPerfStats.lastMs.toFixed(3)}ms | tick/s=${ticksPerSec.toFixed(1)} | ` +
    `fallback=${fallbackRate.toFixed(1)}% (${navPerfStats.fallbackCount}) | ` +
    `snap=${snapRate.toFixed(1)}% | d=${navPerfStats.lastSnapM.toFixed(1)}m | ` +
    `state=${navPerfStats.routeState} | rejoin=${(navPerfStats.rejoinBlend * 100).toFixed(0)}%`;

  if (navPerfLineEl) navPerfLineEl.textContent = lineText;
  else navPerfHudEl.textContent = lineText;
}

// ── Service Worker ───────────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=V2.0.35', { updateViaCache: 'none' })
      .then(reg => {
        const activateWaiting = () => {
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        };

        activateWaiting();
        reg.update().catch(() => {});

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (window.__lfSwReloading) return;
          window.__lfSwReloading = true;
          window.location.reload();
        });
      })
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
  function createTimeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return { signal: AbortSignal.timeout(ms), cleanup: () => {} };
    }

    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timer)
      };
    }

    return { signal: undefined, cleanup: () => {} };
  }

  async function checkOnline() {
    const timeout = createTimeoutSignal(4000);
    try {
      await fetch('../api/list_cities.php', { method: 'HEAD', cache: 'no-store', signal: timeout.signal });
      offlineBadge.classList.add('hidden');
    } catch {
      offlineBadge.classList.remove('hidden');
    } finally {
      timeout.cleanup();
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

  if (navEndBtn) {
    navEndBtn.addEventListener('click', () => {
      if (simRunning) stopSimulation(false);
      else stopNavigation();
    });
  }

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
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Keine Haltestellen vorhanden.';
    stopList.replaceChildren(hint);
    return;
  }

  stopList.replaceChildren();
  stops.forEach((stop, i) => {
    const item = document.createElement('div');
    item.className   = 'stop-item';
    item.dataset.idx = i;

    const idxEl = document.createElement('span');
    idxEl.className = 'stop-index';
    idxEl.textContent = String(i + 1);

    const dotEl = document.createElement('span');
    dotEl.className = 'stop-dot-icon';

    const nameEl = document.createElement('span');
    nameEl.className = 'stop-name';
    nameEl.textContent = stop.name || 'Haltestelle';

    item.appendChild(idxEl);
    item.appendChild(dotEl);
    item.appendChild(nameEl);

    if ((stop.minuteFromStart || 0) > 0) {
      const minuteEl = document.createElement('span');
      minuteEl.className = 'stop-minute';
      minuteEl.textContent = `+${stop.minuteFromStart} min`;
      item.appendChild(minuteEl);
    }

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
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Keine Routen gespeichert.';
    offlineRouteList.replaceChildren(hint);
    return;
  }

  offlineRouteList.replaceChildren();
  entries.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'offline-route-entry';

    const label = document.createElement('span');
    label.textContent = (entry.data && entry.data.lineName) ? entry.data.lineName : entry.key;

    const removeBtn = document.createElement('button');
    removeBtn.title = 'Route aus Offline-Speicher löschen';
    removeBtn.textContent = '🗑';

    removeBtn.addEventListener('click', async () => {
      await dbDelete(entry.key);
      await renderOfflineRouteList();
    });

    div.appendChild(label);
    div.appendChild(removeBtn);
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

function getCameraProfile() {
  const val = localStorage.getItem(CAMERA_PROFILE_KEY);
  if (val === 'calm' || val === 'dynamic' || val === 'balanced') return val;
  return 'balanced';
}

function initCameraProfileSelect() {
  if (!cameraProfileSelect) return;
  cameraProfileSelect.value = getCameraProfile();
  cameraProfileSelect.addEventListener('change', () => {
    const v = cameraProfileSelect.value;
    if (v === 'calm' || v === 'dynamic' || v === 'balanced') {
      localStorage.setItem(CAMERA_PROFILE_KEY, v);
    }
  });
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
  initCameraProfileSelect();
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
  navNearestIdx = 0;
  navOffRouteActive = false;
  navRejoinBlend = 0;
  resetNavPerfStats('gps');
  startNavDriveLogSession('nav-start');

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
      const pts = currentRoute.data.routePoints;
      const tracked = resolveNavTrackPoint(lat, lon, pts);

      recordNavDriveSample(lat, lon, tracked, speed, heading);

      navCenterOn(tracked.lon, tracked.lat, smoothHeading(heading), speed);
      updateNavHud(tracked.lat, tracked.lon, tracked.index);
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
  navNearestIdx = 0;
  navOffRouteActive = false;
  navRejoinBlend = 0;
  stopNavDriveLogSession();
  resetNavPerfStats('idle');
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

function findNearestNavIdx(lat, lon, pts, hintIdx = 0) {
  if (!pts.length) return 0;

  const maxIdx = pts.length - 1;
  const seed   = Math.min(maxIdx, Math.max(0, Number.isFinite(hintIdx) ? Math.floor(hintIdx) : 0));

  const distAt = i => {
    const [la, lo] = navGetLatLon(pts[i]);
    return haversineM(lat, lon, la, lo);
  };

  const windowSize = 35;
  const edgeMargin = 5;
  const start = Math.max(0, seed - windowSize);
  const end   = Math.min(maxIdx, seed + windowSize);

  let minD = Infinity;
  let best = seed;

  for (let i = start; i <= end; i++) {
    const d = distAt(i);
    if (d < minD) {
      minD = d;
      best = i;
    }
  }

  // Falls der beste Treffer am Fensterrand liegt, wurde evtl. stark abgewichen.
  // Dann einmal global suchen (selten, aber korrekt).
  if (best <= start + edgeMargin || best >= end - edgeMargin) {
    noteNavPerfFallback();
    minD = Infinity;
    best = seed;
    for (let i = 0; i <= maxIdx; i++) {
      const d = distAt(i);
      if (d < minD) {
        minD = d;
        best = i;
      }
    }
  }

  return best;
}

function snapGpsToRoute(lat, lon, pts, hintIdx = 0, windowSize = NAV_SNAP_WINDOW) {
  if (!pts || pts.length < 2) return null;

  const nearestIdx = findNearestNavIdx(lat, lon, pts, hintIdx);
  const maxSeg = pts.length - 2;
  if (maxSeg < 0) return null;

  const segStart = Math.max(0, nearestIdx - windowSize);
  const segEnd = Math.min(maxSeg, nearestIdx + windowSize);

  const metersPerDegLat = 111320;
  const metersPerDegLon = Math.max(1, Math.cos(lat * Math.PI / 180) * 111320);

  let best = null;

  for (let i = segStart; i <= segEnd; i++) {
    const [aLat, aLon] = navGetLatLon(pts[i]);
    const [bLat, bLon] = navGetLatLon(pts[i + 1]);

    const ax = (aLon - lon) * metersPerDegLon;
    const ay = (aLat - lat) * metersPerDegLat;
    const bx = (bLon - lon) * metersPerDegLon;
    const by = (bLat - lat) * metersPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) continue;

    const tRaw = -(ax * dx + ay * dy) / len2;
    const t = Math.max(0, Math.min(1, tRaw));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const dist2 = px * px + py * py;

    if (!best || dist2 < best.dist2) {
      const snapLon = lon + (px / metersPerDegLon);
      const snapLat = lat + (py / metersPerDegLat);
      best = {
        dist2,
        lat: snapLat,
        lon: snapLon,
        index: Math.min(pts.length - 1, i + (t >= 0.5 ? 1 : 0))
      };
    }
  }

  if (!best) {
    const [nLat, nLon] = navGetLatLon(pts[nearestIdx]);
    return {
      lat: nLat,
      lon: nLon,
      index: nearestIdx,
      distanceM: haversineM(lat, lon, nLat, nLon),
      applied: false
    };
  }

  const distanceM = Math.sqrt(best.dist2);
  return {
    lat: best.lat,
    lon: best.lon,
    index: best.index,
    distanceM,
    applied: distanceM <= NAV_SNAP_MAX_M
  };
}

function lerpValue(a, b, t) {
  return a + (b - a) * t;
}

function resolveNavTrackPoint(rawLat, rawLon, pts) {
  const snap = snapGpsToRoute(rawLat, rawLon, pts, navNearestIdx, NAV_SNAP_WINDOW);
  if (!snap) {
    noteNavRouteState(navOffRouteActive ? 'OFF' : 'ON', navRejoinBlend);
    return {
      lat: rawLat,
      lon: rawLon,
      index: navNearestIdx,
      routeState: navOffRouteActive ? 'OFF' : 'ON',
      snapDistanceM: null,
      snapApplied: false
    };
  }

  navNearestIdx = snap.index;

  if (snap.distanceM >= NAV_OFF_ROUTE_ENTER_M) {
    navOffRouteActive = true;
    navRejoinBlend = 0;
  }

  let displayLat = rawLat;
  let displayLon = rawLon;
  let snapAppliedNow = false;

  if (!navOffRouteActive) {
    if (snap.applied) {
      displayLat = snap.lat;
      displayLon = snap.lon;
      snapAppliedNow = true;
    }
  } else if (snap.applied && snap.distanceM <= NAV_REJOIN_START_M) {
    navRejoinBlend = Math.min(1, navRejoinBlend + NAV_REJOIN_BLEND_STEP);
    displayLat = lerpValue(rawLat, snap.lat, navRejoinBlend);
    displayLon = lerpValue(rawLon, snap.lon, navRejoinBlend);
    snapAppliedNow = navRejoinBlend > 0;

    if (navRejoinBlend >= 1) {
      navOffRouteActive = false;
      navRejoinBlend = 0;
      displayLat = snap.lat;
      displayLon = snap.lon;
      snapAppliedNow = true;
    }
  } else {
    navRejoinBlend = 0;
  }

  const routeState = navOffRouteActive
    ? (navRejoinBlend > 0 ? 'REJOIN' : 'OFF')
    : 'ON';

  noteNavRouteState(routeState, navRejoinBlend);
  noteNavSnap(snap.distanceM, snapAppliedNow);

  return {
    lat: displayLat,
    lon: displayLon,
    index: snap.index,
    routeState,
    snapDistanceM: snap.distanceM,
    snapApplied: snapAppliedNow
  };
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

function updateNavHud(lat, lon, forcedIdx = null) {
  if (!navActive || !currentRoute) return;
  const perfT0 = navPerfDebugEnabled ? performance.now() : 0;
  const pts         = currentRoute.data.routePoints;
  const idx = Number.isFinite(forcedIdx)
    ? Math.max(0, Math.min(pts.length - 1, Math.floor(forcedIdx)))
    : findNearestNavIdx(lat, lon, pts, navNearestIdx);
  navNearestIdx     = idx;
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

  renderUpcomingStops(currentDist);

  if (navPerfDebugEnabled) {
    noteNavPerfTick(performance.now() - perfT0);
  }
}

function renderUpcomingStops(currentDist) {
  if (!navUpcomingStopsEl) return;

  const upcoming = navStopDists
    .filter(s => s.distFromStart > currentDist + 10)
    .slice(0, 4);

  const destination = navStopDists.length ? navStopDists[navStopDists.length - 1] : null;

  const list = [];
  if (destination) list.push({ kind: 'destination', entry: destination });
  upcoming.forEach(entry => list.push({ kind: 'upcoming', entry }));

  if (!list.length) {
    navUpcomingStopsEl.replaceChildren();
    return;
  }

  const nodes = list.map(({ kind, entry }) => {
    const card = document.createElement('div');
    card.className = 'nav-upcoming-item';
    if (kind === 'destination') card.classList.add('is-destination');

    const type = document.createElement('span');
    type.className = 'nav-upcoming-type';
    type.textContent = kind === 'destination' ? 'Ziel' : 'Nächste';

    const name = document.createElement('span');
    name.className = 'nav-upcoming-name';
    name.textContent = entry.stop?.name || 'Haltestelle';

    const dist = document.createElement('span');
    dist.className = 'nav-upcoming-dist';
    dist.textContent = kind === 'destination'
      ? navFormatDist(Math.max(0, entry.distFromStart - currentDist))
      : navFormatDist(Math.max(0, entry.distFromStart - currentDist));

    card.appendChild(type);
    card.appendChild(name);
    card.appendChild(dist);
    return card;
  });

  navUpcomingStopsEl.replaceChildren(...nodes);
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
  navNearestIdx = 0;
  navOffRouteActive = false;
  navRejoinBlend = 0;
  startNavDriveLogSession('sim-start');
  resetNavPerfStats('sim');

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
    let simSpeedMps = null;
    if (step < total - 1) {
      const p2 = pts[step + 1];
      const [lat2, lon2] = Array.isArray(p2) ? [p2[0], p2[1]] : [p2.lat, p2.lon];
      heading = bearingDeg(lat, lon, lat2, lon2);
      simSpeedMps = haversineM(lat, lon, lat2, lon2) / Math.max(0.001, stepMs / 1000);
    }

    setSimulatedGPS(lon, lat, heading);
    simCenterOn(lon, lat, heading, simSpeedMps);
    const tracked = {
      lat,
      lon,
      index: step,
      routeState: 'ON',
      snapDistanceM: 0,
      snapApplied: true
    };
    recordNavDriveSample(lat, lon, tracked, null, heading);
    updateNavHud(lat, lon, step);

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
  navOffRouteActive = false;
  navRejoinBlend = 0;
  stopNavDriveLogSession();
  resetNavPerfStats('idle');

  if (typeof map !== 'undefined' && map) {
    map.easeTo({ pitch: 0, bearing: 0, zoom: 13, duration: 1000 });
  }

  stopGPS();

  if (completed) {
    showToast('✓ Lehrfahrt abgeschlossen!', 5000);
  }
}

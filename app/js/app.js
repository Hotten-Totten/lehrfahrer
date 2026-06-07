// =========================
// APP LOGIC – Lehrfahrer PWA
// =========================

const API_BASE = '../api';
const DB_NAME  = 'lehrfahrer-offline';
const DB_VER   = 2;
const STORAGE_KEY_LINES_CATALOG = 'lehrfahrer-lines-catalog-version';
const STORAGE_KEY_DISMISSED_UPDATE = 'lehrfahrer-dismissed-lines-update';

let db          = null;
let currentRoute = null;
let gpsActive   = false;
let pmtilesUrl  = null; // gesetzt wenn lokale PMTiles-Datei geladen wurde
let gpsFirstFixTimer = null;
let availableLinesCatalog = []; // Linien vom API

// Nav-Zustand
let navActive    = false;
let navFirstFix  = false;
let navTurns     = [];
let navCumDists  = [];
let navStopDists = [];
let navNearestIdx = 0;
let navTimeInterval = null;  // Timer für Zeit-Updates im HUD
let navInputMode = 'gps';
let simTimer = null;
let simRouteIdx = 0;
const SIM_TICK_MS = 900;
const SIM_DEFAULT_SPEED_KMH = 34;

// GPS-Smoothing (reduziert Ruckeln bei schlechtem GPS)
let gpsLastSmoothedPos = null;
const GPS_SMOOTHING_ALPHA = 0.4;  // 0.3-0.5: höher = schneller Response, niedriger = glatter

const NAV_SNAP_MAX_M = 85;
const NAV_SNAP_WINDOW = 24;
const NAV_TURN_LOOKAHEAD_M = 15;
const NAV_POST_TURN_DELAY_M = 85;
const NAV_CLOSE_TURN_OVERRIDE_M = 140;
// Cottbus-Feintuning: robuster gegen Innenstadt-GPS-Drift,
// aber weiterhin klarer OFF->REJOIN->ON Verlauf.
const NAV_OFF_ROUTE_ENTER_M = 145;
const NAV_REJOIN_START_M = 78;
const NAV_REJOIN_BLEND_STEP = 0.20;
let navOffRouteActive = false;
let navRejoinBlend = 0;

// Navigation Menu
let currentNavLine = null;
let navProgressIdx = 0;
let navStartTime = 0;

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
const saveOfflineBtn   = document.getElementById('saveOfflineBtn'); // Jetzt obsolet, aber Modal ersetzt Funktionalität
const offlineBadge     = document.getElementById('offlineBadge');
const gpsBtn           = document.getElementById('gpsBtn');
const simBtn           = document.getElementById('simBtn');
const fullscreenBtn    = document.getElementById('fullscreenBtn');
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
const availableLinesContainer = document.getElementById('availableLinesContainer');
const navigateToStartBtn = document.getElementById('navigateToStartBtn');

console.log('🔍 DOM Elements:', {
  navigateToStartBtn: !!navigateToStartBtn
});

// Nav-DOM-Referenzen
const navBtn        = document.getElementById('navBtn');
const navHud        = document.getElementById('navHud');
const navArrowEl    = document.getElementById('navArrow');
const navDistEl     = document.getElementById('navDist');
const navLabelEl    = document.getElementById('navLabel');
const navStopNameEl = document.getElementById('navStopName');
const navStopDistEl = document.getElementById('navStopDist');
const navSpeedEl    = document.getElementById('navSpeed');
const navTimeEl     = document.getElementById('navTime');
const navEndBtn     = document.getElementById('navEndBtn');
const navMenuBtn    = document.getElementById('navMenuBtn');
const navUpcomingStopsEl = document.getElementById('navUpcomingStops');
const navDestinationNameEl = document.getElementById('navDestinationName');
const navDestinationDistEl = document.getElementById('navDestinationDist');

// Navigation Menu Overlay
const navMenuOverlay   = document.getElementById('navMenuOverlay');
const closeNavMenuBtn  = document.getElementById('closeNavMenuBtn');
const navPauseBtn     = document.getElementById('navPauseBtn');
const navCancelBtn    = document.getElementById('navCancelBtn');
const navTabs         = document.querySelectorAll('.nav-menu-tab');
const navPanes        = document.querySelectorAll('.nav-menu-pane');

const cameraProfileSelect = document.getElementById('cameraProfileSelect');

const CAMERA_PROFILE_KEY = 'lehrfahrer_camera_profile';

// ── Start ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 App starting...');
  initFullscreenUi();
  registerServiceWorker();
  await openDB();
  initMap();
  initNavPerfDebugHud();
  bindEvents();
  detectOffline();
  await loadCities();
  
  console.log('📦 Fetching lines catalog...');
  // Lade Linien-Katalog
  await fetchAndCacheLinesCatalog();
  
  console.log('⏳ Starting background auto-download...');
  // Auto-Download aller Linien im Hintergrund (nicht blockierend)
  autoDownloadAllLines().catch(err => console.warn('Auto-download background error:', err));
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
    navigator.serviceWorker.register('./sw.js?v=V2.0.42', { updateViaCache: 'none' })
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
      // Routes Object Store
      if (!d.objectStoreNames.contains('routes')) {
        d.createObjectStore('routes', { keyPath: 'key' });
      }
      // Lines Catalog Object Store (Metadaten)
      if (!d.objectStoreNames.contains('linesCatalog')) {
        d.createObjectStore('linesCatalog', { keyPath: 'id' });
      }
      // Lines Data Object Store (JSON-Inhalte)
      if (!d.objectStoreNames.contains('linesData')) {
        d.createObjectStore('linesData', { keyPath: 'id' });
      }
      // Lines GPX Object Store
      if (!d.objectStoreNames.contains('linesGPX')) {
        d.createObjectStore('linesGPX', { keyPath: 'id' });
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

// ── Lines Catalog (Metadaten) ─────────────────────────────────
function dbPutLinesCatalog(catalog) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('linesCatalog', 'readwrite');
    const req = tx.objectStore('linesCatalog').clear();
    req.onsuccess = () => {
      catalog.forEach(line => {
        tx.objectStore('linesCatalog').put({ 
          id: line.id, 
          city: line.city,
          lineFolder: line.lineFolder,
          fileName: line.fileName,
          lineName: line.lineName,
          routeName: line.routeName,
          updatedAt: line.updatedAt || Date.now()
        });
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetLinesCatalog() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('linesCatalog', 'readonly');
    const req = tx.objectStore('linesCatalog').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ── Lines Data (JSON-Inhalt) ──────────────────────────────────
function dbPutLineData(id, lineData) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('linesData', 'readwrite');
    const req = tx.objectStore('linesData').put({
      id,
      data: lineData,
      savedAt: Date.now()
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbGetLineData(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('linesData', 'readonly');
    const req = tx.objectStore('linesData').get(id);
    req.onsuccess = () => resolve(req.result?.data ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ── Lines GPX ─────────────────────────────────────────────────
function dbPutLineGPX(id, gpxData) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('linesGPX', 'readwrite');
    const req = tx.objectStore('linesGPX').put({
      id,
      data: gpxData,
      savedAt: Date.now()
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbGetLineGPX(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('linesGPX', 'readonly');
    const req = tx.objectStore('linesGPX').get(id);
    req.onsuccess = () => resolve(req.result?.data ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ── Lines Katalog laden und aktualisieren ──────────────────
async function fetchAndCacheLinesCatalog() {
  try {
    console.log('📦 Fetching lines catalog from API...');
    const response = await fetch(`${API_BASE}/list_lines.php`);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const result = await response.json();
    console.log('📦 API Response:', result);
    
    if (!result.ok || !result.lines) {
      console.warn('⚠️ API response invalid:', result);
      availableLinesCatalog = [];
      return [];
    }
    
    // ⚠️ WICHTIG: API kann Duplicates zurückgeben (neues + altes Format gescannt)
    // Deduplizieren nach ID: Behalte nur das erste Vorkommen
    const seenIds = new Set();
    const uniqueLines = result.lines.filter(line => {
      if (seenIds.has(line.id)) {
        console.log(`  ⚠️ Duplicate ID filtered out: ${line.id}`);
        return false;
      }
      seenIds.add(line.id);
      return true;
    });
    
    console.log(`📋 Deduplication: ${result.lines.length} → ${uniqueLines.length} unique lines`);
    
    // In IndexedDB speichern
    await dbPutLinesCatalog(uniqueLines);
    availableLinesCatalog = uniqueLines;
    console.log(`✓ Cached ${uniqueLines.length} lines to IndexedDB`);
    
    // Version speichern
    const catalogVersion = new Date().getTime();
    localStorage.setItem(STORAGE_KEY_LINES_CATALOG, catalogVersion);
    
    return uniqueLines;
  } catch (err) {
    console.error('❌ Error fetching lines catalog:', err);
    availableLinesCatalog = [];
    return [];
  }
}

// ── Prüfe auf neue Linien ──────────────────────────────────
async function checkForNewLines() {
  try {
    const currentCatalog = await dbGetLinesCatalog();
    const newCatalog = await fetchAndCacheLinesCatalog();
    
    if (newCatalog.length === 0) return false;
    
    const newCount = newCatalog.filter(line => 
      !currentCatalog.find(c => c.id === line.id)
    ).length;
    
    if (newCount > 0) {
      const dismissed = localStorage.getItem(STORAGE_KEY_DISMISSED_UPDATE);
      localStorage.removeItem(STORAGE_KEY_DISMISSED_UPDATE); // Reset bei neuen Linien
      return true;
    }
    return false;
  } catch (err) {
    console.error('Error checking for new lines:', err);
    return false;
  }
}

// ── Eine Linie mit GPX herunterladen ────────────────────────
async function downloadLineWithGPX(lineId) {
  try {
    // Finde die Linie in der Catalog
    const line = availableLinesCatalog.find(l => l.id === lineId);
    if (!line) {
      console.warn(`  ⚠️ Line not found in catalog: ${lineId}`);
      return false;
    }

    // Lade von der API
    let url = `${API_BASE}/load_line.php?city=${encodeURIComponent(line.city)}&line=${encodeURIComponent(line.file)}`;
    if (line.lineFolder) url += `&lineFolder=${encodeURIComponent(line.lineFolder)}`;

    const res = await fetch(url);
    const json = await res.json();

    if (!json.ok || !json.line) {
      console.warn(`  ⚠️ API failed for ${lineId}`);
      return false;
    }

    // Speichere in IndexedDB
    const lineData = json.line;
    
    // Formatiere die ID konsistent (city_lineFolder_file, mit _ statt /)
    const dbId = `${line.city}${line.lineFolder ? '_' + line.lineFolder : ''}_${line.file}`.replace(/\//g, '_');
    
    await dbPutLineData(dbId, lineData);
    
    // Speichere auch GPX falls vorhanden
    if (json.gpx) {
      await dbPutLineGPX(dbId, json.gpx);
    }

    console.log(`  ✓ ${line.lineName} downloaded and cached`);
    return true;
  } catch (err) {
    console.warn(`  ⚠️ Error downloading line: ${err.message}`);
    return false;
  }
}

// ── Notification für neue Linien ──────────────────────────────
function showNewLinesNotification() {
  // TODO: Implementieren - Banner oben anzeigen
  console.log('New lines available!');
}

// ── Neue Linien Banner zeigen ──────────────────────────────────
async function showNewLinesBanner(newLineCount) {
  const banner = document.getElementById('newLinesBanner');
  const countEl = document.getElementById('newLinesCount');
  
  if (!banner || !countEl) return;
  
  countEl.textContent = newLineCount;
  banner.classList.remove('hidden');
  
  // Setze CSS-Variable für selectionBar offset
  document.documentElement.style.setProperty('--banner-h', '56px');
  
  // Event Listeners
  document.getElementById('dismissBannerBtn').onclick = () => {
    localStorage.setItem(STORAGE_KEY_DISMISSED_UPDATE, 'true');
    hideBanner();
  };
  
  document.getElementById('downloadNowBtn').onclick = () => {
    // TODO: Download Center Modal öffnen
    console.log('Open Download Center');
    showDownloadCenterModal();
  };
}

function hideBanner() {
  const banner = document.getElementById('newLinesBanner');
  if (!banner) return;
  banner.classList.add('hidden');
  document.documentElement.style.setProperty('--banner-h', '0px');
}

// ── Download Center Modal (Placeholder) ────────────────────────
// ── Download Center Modal Logik ────────────────────────────────
async function showDownloadCenterModal() {
  const modal = document.getElementById('downloadCenterModal');
  if (!modal) return;
  
  console.log('🔍 Opening Download Center...');
  console.log('📋 availableLinesCatalog:', availableLinesCatalog);
  
  // Falls availableLinesCatalog noch leer ist, lade nochmal vom API
  if (!availableLinesCatalog || availableLinesCatalog.length === 0) {
    console.log('⚡ availableLinesCatalog is empty! Reloading from API...');
    const lines = await fetchAndCacheLinesCatalog();
    console.log('✓ Reloaded:', lines.length, 'lines');
  }
  
  // Beende Banner animation
  hideBanner();
  
  // Lade aktuelle Daten
  const cached = await dbGetLinesCatalog();
  const available = availableLinesCatalog || [];
  
  console.log('💾 Cached lines:', cached);
  console.log('📦 Available lines:', available);
  
  const container = document.getElementById('linesListContainer');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Wenn keine Linien vorhanden
  if (available.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">❌ Keine Linien gefunden. Eventuell API-Fehler?</p>';
  }
  
  // Für jede verfügbare Linie ein Checkbox-Item
  available.forEach((line, idx) => {
    const isCached = cached.find(c => c.id === line.id);
    const lineItem = document.createElement('div');
    lineItem.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background: var(--surface2);
      border-radius: 6px;
      margin-bottom: 8px;
      cursor: pointer;
      opacity: ${isCached ? 0.7 : 1};
    `;
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'line-checkbox';
    checkbox.value = line.id;
    checkbox.defaultChecked = !isCached;
    checkbox.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';
    
    const label = document.createElement('div');
    label.style.cssText = 'flex: 1;';
    label.innerHTML = `
      <div style="font-weight: 600; font-size: 14px;">${line.lineName}</div>
      <div style="font-size: 12px; color: var(--text-muted);">${line.routeName} • ${line.city}</div>
      ${isCached ? '<div style="font-size: 11px; color: var(--accent);">✓ Schon geladen</div>' : ''}
    `;
    
    lineItem.appendChild(checkbox);
    lineItem.appendChild(label);
    
    lineItem.onclick = () => checkbox.click();
    container.appendChild(lineItem);
  });
  
  // "Alle auswählen" Button
  const selectAll = document.getElementById('selectAllLines');
  if (selectAll) {
    selectAll.onchange = () => {
      document.querySelectorAll('.line-checkbox').forEach(cb => {
        cb.checked = selectAll.checked;
      });
    };
  }
  
  // Download Button
  const downloadBtn = document.getElementById('downloadCenterDownloadBtn');
  if (downloadBtn) {
    downloadBtn.onclick = async () => {
      await startLinesDownload();
    };
  }
  
  // Cancel Button
  const cancelBtn = document.getElementById('downloadCenterCancelBtn');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal.classList.add('hidden');
    };
  }
  
  // Stats aktualisieren
  updateDownloadStats();
  
  // Modal zeigen
  modal.classList.remove('hidden');
}

// ── Download Statistics ────────────────────────────────────────
async function updateDownloadStats() {
  const cached = await dbGetLinesCatalog();
  const available = availableLinesCatalog || [];
  
  console.log('📊 updateDownloadStats:', { cached: cached.length, available: available.length, availableLinesCatalog });
  
  const statsText = document.getElementById('downloadStatsText');
  if (statsText) {
    statsText.innerHTML = `📦 <strong>${cached.length}</strong> / <strong>${available.length}</strong> Linien geladen`;
  }
}

// ── Download starten ────────────────────────────────────────────
async function startLinesDownload() {
  const selectedCheckboxes = Array.from(document.querySelectorAll('.line-checkbox:checked'));
  if (selectedCheckboxes.length === 0) return;
  
  const lineIds = selectedCheckboxes.map(cb => cb.value);
  const progressDiv = document.getElementById('downloadProgress');
  const progressBar = document.getElementById('downloadProgressBar');
  const progressText = document.getElementById('downloadProgressText');
  const downloadBtn = document.getElementById('downloadCenterDownloadBtn');
  
  if (!progressDiv || !progressBar || !progressText || !downloadBtn) return;
  
  progressDiv.classList.remove('hidden');
  downloadBtn.disabled = true;
  
  let completed = 0;
  for (const lineId of lineIds) {
    progressText.textContent = `Lade ${completed + 1} / ${lineIds.length}…`;
    progressBar.style.width = ((completed / lineIds.length) * 100) + '%';
    
    const success = await downloadLineWithGPX(lineId);
    if (success) completed++;
    
    await new Promise(resolve => setTimeout(resolve, 100)); // Kleine Verzögerung
  }
  
  progressBar.style.width = '100%';
  progressText.textContent = `✓ Fertig! ${completed}/${lineIds.length} Linien geladen`;
  
  await updateDownloadStats();
  
  downloadBtn.disabled = false;
  setTimeout(() => {
    progressDiv.classList.add('hidden');
  }, 2000);
}

// ── Aktualisierte showNewLinesNotification ──────────────────────
async function showNewLinesNotification() {
  try {
    const currentCatalog = await dbGetLinesCatalog();
    const newCatalog = availableLinesCatalog || [];
    
    if (newCatalog.length === 0) return;
    
    const newCount = newCatalog.filter(line => 
      !currentCatalog.find(c => c.id === line.id)
    ).length;
    
    if (newCount > 0) {
      const dismissed = localStorage.getItem(STORAGE_KEY_DISMISSED_UPDATE);
      if (!dismissed) {
        showNewLinesBanner(newCount);
      }
    }
  } catch (err) {
    console.error('Error showing notification:', err);
  }
}

// ── Auto-Download aller Linien im Hintergrund ──────────────────
async function autoDownloadAllLines() {
  try {
    console.log('🔍 autoDownloadAllLines() called');
    
    // WICHTIG: Prüfe linesData, nicht linesCatalog!
    // linesCatalog = nur Metadaten (geladen vom API)
    // linesData = echte JSON-Daten (müssen heruntergeladen werden)
    const tx = db.transaction('linesData', 'readonly');
    const req = tx.objectStore('linesData').getAll();
    
    const cached = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result.map(item => item.id) || []);
      req.onerror = () => reject(req.error);
    });
    
    const available = availableLinesCatalog || [];
    
    console.log(`📊 Status: ${cached.length} cached (linesData), ${available.length} available`);
    console.log('📋 Cached IDs (linesData):', cached);
    console.log('📋 Available IDs:', available.map(l => l.id));
    
    if (available.length === 0) {
      console.log('⚠️ No lines to auto-download');
      return;
    }
    
    // Nur nicht-gecachte Linien herunterladen (prüfe gegen cached array)
    const toDownload = available.filter(line => {
      const isCached = cached.includes(line.id);
      console.log(`  Checking ${line.id}: ${isCached ? 'CACHED' : 'NEW'}`);
      return !isCached;
    });
    
    console.log(`📋 toDownload list: ${toDownload.length} lines to download`);
    toDownload.forEach(l => console.log(`  - ${l.lineName} (${l.id})`));
    
    if (toDownload.length === 0) {
      console.log('✓ All lines already cached in linesData');
      return;
    }
    
    console.log(`⬇️ Auto-downloading ${toDownload.length} lines in background...`);
    
    // Zeige discreten Indicator in der Topbar
    const topbar = document.getElementById('topbar');
    if (!topbar) {
      console.warn('❌ topbar not found');
      return;
    }
    
    const indicator = document.createElement('div');
    indicator.id = 'downloadIndicator';
    indicator.style.cssText = `
      position: absolute;
      bottom: 2px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 10px;
      color: var(--accent);
      opacity: 0.7;
      font-weight: 600;
      white-space: nowrap;
      z-index: 1;
    `;
    indicator.textContent = '⬇ Linien laden…';
    topbar.style.position = 'relative';
    topbar.appendChild(indicator);
    console.log('✓ Indicator added to topbar');
    
    // Download im Hintergrund (mit Verzögerung zwischen den Downloads)
    let completed = 0;
    for (const line of toDownload) {
      try {
        console.log(`  ⏳ Downloading ${line.lineName}...`);
        const success = await downloadLineWithGPX(line.id);
        if (success) {
          completed++;
          console.log(`  ✓ ${line.lineName} (${completed}/${toDownload.length})`);
        } else {
          console.log(`  ⚠️ ${line.lineName} failed`);
        }
      } catch (err) {
        console.warn(`  ✗ ${line.lineName}: ${err.message}`);
      }
      // Kleine Verzögerung zwischen Downloads um Server nicht zu überlasten
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Indicator entfernen
    if (indicator.parentNode) {
      indicator.remove();
      console.log('✓ Indicator removed');
    }
    
    console.log(`✅ Auto-download complete: ${completed}/${toDownload.length} lines cached`);
  } catch (err) {
    console.error('❌ Error in autoDownloadAllLines:', err);
  }
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
  if (saveOfflineBtn) saveOfflineBtn.addEventListener('click', saveCurrentRouteOffline);

  gpsBtn.addEventListener('click', toggleGPS);
  if (simBtn) simBtn.addEventListener('click', toggleSimulationMode);
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreenMode);
  settingsBtn.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', e => {
    if (e.target === settingsOverlay) closeSettings();
  });

  panelHandle.addEventListener('click', togglePanel);
  if (panelCloseBtn) panelCloseBtn.addEventListener('click', () => setPanelOpen(false));
  
  if (navigateToStartBtn) {
    navigateToStartBtn.addEventListener('click', navigateToRouteStart);
    console.log('✅ navigateToStartBtn event listener attached');
  } else {
    console.warn('❌ navigateToStartBtn not found in DOM');
  }

  loadLocalTilesBtn.addEventListener('click', () => tilesFileInput.click());
  tilesFileInput.addEventListener('change', onTilesFileSelected);

  navBtn.addEventListener('click', () => {
    if (navActive) stopNavigation();
    else startNavigation();
  });

  if (navEndBtn) {
    navEndBtn.addEventListener('click', () => {
      stopNavigation();
    });
  }

  // Navigation Menu Button
  if (navMenuBtn) {
    navMenuBtn.addEventListener('click', () => {
      showNavMenu();
    });
  }

  // Navigation Menu Tab Switching
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      switchNavMenuTab(tabName);
    });
  });

  // Navigation Menu Close Button
  if (closeNavMenuBtn) {
    closeNavMenuBtn.addEventListener('click', () => {
      hideNavMenu();
    });
  }

  // Overlay Click to Close
  if (navMenuOverlay) {
    navMenuOverlay.addEventListener('click', (e) => {
      if (e.target === navMenuOverlay) hideNavMenu();
    });
  }

  // Pause Button
  if (navPauseBtn) {
    navPauseBtn.addEventListener('click', () => {
      toggleNavPause();
    });
  }

  // Cancel Button
  if (navCancelBtn) {
    navCancelBtn.addEventListener('click', () => {
      stopNavigation();
      hideNavMenu();
    });
  }
}

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isFullscreenActive() {
  return !!document.fullscreenElement;
}

function renderFullscreenButtonState() {
  if (!fullscreenBtn) return;

  if (isStandaloneMode()) {
    document.body.classList.add('is-standalone');
    return;
  }

  document.body.classList.remove('is-standalone');
  const active = isFullscreenActive();
  fullscreenBtn.textContent = active ? '⤡' : '⛶';
  fullscreenBtn.title = active ? 'Vollbild verlassen' : 'Vollbild ein/aus';
}

function initFullscreenUi() {
  renderFullscreenButtonState();
  document.addEventListener('fullscreenchange', renderFullscreenButtonState);
}

async function toggleFullscreenMode() {
  if (isStandaloneMode()) {
    showToast('Bereits im Vollbild (App-Modus).', 2500);
    return;
  }

  try {
    if (isFullscreenActive()) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
  } catch (_err) {
    showToast('Vollbild ist hier begrenzt. Tipp: Im Browser-Menü "Zum Startbildschirm" wählen und als App starten.', 7000);
  }
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
  if (saveOfflineBtn) saveOfflineBtn.disabled = true;
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
  if (saveOfflineBtn) saveOfflineBtn.disabled = true;
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
  let isOfflineAvailable = false;
  
  try {
    // 1. Checke neue linesData store (gedownloadete Linien)
    const lineId = `${city}_${lineFolder || ''}_${fileBase}`.replace(/\//g, '_');
    const lineData = await dbGetLineData(lineId);
    if (lineData) {
      data = lineData;
      isOfflineAvailable = true;
      console.log('✓ Linie aus Download-Cache geladen');
    }
  } catch (err) {
    console.warn('Error checking linesData store:', err);
  }
  
  // 2. Wenn nicht im Download-Cache, checke alte routes store
  if (!data) {
    try { 
      data = await dbGet(key);
      isOfflineAvailable = (data != null);
      if (data) console.log('✓ Linie aus gespeicherten Routen geladen');
    } catch (err) {
      console.warn('Error checking routes store:', err);
    }
  }

  // 3. Dann Server versuchen
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

  // Navi-Button freischalten
  navBtn.classList.remove('hidden');
  if (simBtn) simBtn.classList.remove('hidden');
  
  // "Zum Startpunkt" Button freischalten (wenn Route vorhanden)
  if (data.routePoints && data.routePoints.length > 0) {
    console.log('✅ Showing navigateToStartBtn');
    navigateToStartBtn.style.display = 'block';
  } else {
    console.log('❌ No routePoints, hiding navigateToStartBtn');
    navigateToStartBtn.style.display = 'none';
  }
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
    if (saveOfflineBtn) {
      saveOfflineBtn.textContent = '✓';
      saveOfflineBtn.title = 'Route ist offline gespeichert';
      setTimeout(() => {
        if (saveOfflineBtn) {
          saveOfflineBtn.textContent = '⬇';
          saveOfflineBtn.title = 'Route für Offline-Nutzung speichern';
        }
      }, 2000);
    }
  } catch (err) {
    alert('Speichern fehlgeschlagen: ' + err.message);
  }
}

// ── Verfügbare Offline-Linien in Einstellungen anzeigen ────
async function displayAvailableLines() {
  if (!availableLinesContainer) return;
  
  try {
    // Hole die heruntergeladenen Linien aus linesData store
    const tx = db.transaction('linesData', 'readonly');
    const req = tx.objectStore('linesData').getAll();
    const allLines = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    if (!allLines.length) {
      availableLinesContainer.innerHTML = '<p class="hint">Keine Linien heruntergeladen – werden beim App-Start automatisch geladen.</p>';
      return;
    }

    availableLinesContainer.innerHTML = '';
    allLines.forEach(line => {
      const div = document.createElement('div');
      div.style.cssText = `
        padding: 10px 12px;
        background: var(--surface2);
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      
      div.innerHTML = `
        <span style="font-size: 18px;">✅</span>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 14px;">${line.lineName || line.id}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${line.routeName || 'Route'}</div>
        </div>
      `;
      
      availableLinesContainer.appendChild(div);
    });
  } catch (err) {
    console.error('Error displaying available lines:', err);
    availableLinesContainer.innerHTML = '<p class="hint">Fehler beim Laden der Linien.</p>';
  }
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
  if (navActive && navInputMode === 'sim') {
    showToast('Simulation läuft. Erst Simulation beenden, dann GPS aktivieren.', 4500);
    return;
  }

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
  displayAvailableLines();
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

// ── Navigation zum Startpunkt ──────────────────────────────────
async function navigateToRouteStart() {
  if (!currentRoute?.data?.routePoints?.length) {
    showToast('Keine Route geladen');
    return;
  }

  const routeStart = currentRoute.data.routePoints[0];
  if (!routeStart) {
    showToast('Startpunkt der Route nicht verfügbar');
    return;
  }

  // GPS-Standort abrufen
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const currentPos = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude
        };

        // Konvertiere routeStart falls nötig
        const startPt = Array.isArray(routeStart)
          ? { lat: routeStart[0], lon: routeStart[1] }
          : { lat: routeStart.lat, lon: routeStart.lon };

        console.log('📍 Current position:', currentPos);
        console.log('📍 Route start:', startPt);

        // Zeichne Linie vom aktuellen Standort zum Startpunkt
        drawNavigationPath(currentPos, startPt);

        showToast(`Weg zum Startpunkt: ${calculateDistance(currentPos, startPt).toFixed(1)} km`);
        resolve();
      },
      (err) => {
        console.error('GPS error:', err);
        showToast('GPS-Standort nicht verfügbar. Bitte GPS aktivieren.');
        resolve();
      },
      { timeout: 5000, enableHighAccuracy: false }
    );
  });
}

// ── Entfernung zwischen zwei Punkten berechnen (Haversine) ──────
function calculateDistance(pos1, pos2) {
  const R = 6371; // Erdradius in km
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
  const dLon = (pos2.lon - pos1.lon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ── GPS-Smoothing: Reduziert Ruckeln durch exponentiellen Durchschnitt ──
function smoothGPSPosition(lat, lon, speed) {
  if (!gpsLastSmoothedPos) {
    gpsLastSmoothedPos = { lat, lon, speed };
    return { lat, lon, speed };
  }
  
  // Exponentieller Durchschnitt (EMA): neue_pos = alpha * aktuelle + (1-alpha) * letzte
  const smoothedLat = GPS_SMOOTHING_ALPHA * lat + (1 - GPS_SMOOTHING_ALPHA) * gpsLastSmoothedPos.lat;
  const smoothedLon = GPS_SMOOTHING_ALPHA * lon + (1 - GPS_SMOOTHING_ALPHA) * gpsLastSmoothedPos.lon;
  const smoothedSpeed = GPS_SMOOTHING_ALPHA * speed + (1 - GPS_SMOOTHING_ALPHA) * gpsLastSmoothedPos.speed;
  
  gpsLastSmoothedPos = { lat: smoothedLat, lon: smoothedLon, speed: smoothedSpeed };
  return gpsLastSmoothedPos;
}

function buildCompactLineLabel() {
  if (!currentRoute) return 'Linie ?';

  const src = currentRoute.fileBase || '';
  const lineMatch = src.match(/[Ll]inie[_\s-]*(\d+)/);
  const routeMatch = src.match(/[Rr]oute[_\s-]*(\d+)/);

  let lineId = lineMatch?.[1] || (src.replace(/\D/g, '') || currentRoute.lineFolder?.replace(/\D/g, '') || '?');
  if (routeMatch?.[1]) {
    lineId += `/${routeMatch[1].padStart(2, '0')}`;
  }

  const stops = currentRoute.data?.stops || [];
  const lastStop = stops.length ? (stops[stops.length - 1].name || 'Ziel') : 'Ziel';

  return `Linie ${lineId} ${lastStop}`;
}

function formatDriveDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startNavigation(options = {}) {
  const useSimulation = options && options.useSimulation === true;

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
  navProgressIdx = 0;
  navStartTime = Date.now();
  currentNavLine = currentRoute.data;
  navInputMode = useSimulation ? 'sim' : 'gps';
  resetNavPerfStats(navInputMode);
  startNavDriveLogSession('nav-start');

  navHud.classList.remove('hidden');
  document.body.classList.add('nav-mode');
  navBtn.textContent = '■';
  navBtn.title       = 'Navigation beenden';
  navBtn.classList.add('nav-active');

  // Display Line Information
  const lineNameEl = document.getElementById('navLineName');
  const cityNameEl = document.getElementById('navCity');
  console.log('🚌 Nav Start - currentRoute:', { city: currentRoute.city, fileBase: currentRoute.fileBase, lineFolder: currentRoute.lineFolder });
  
  if (lineNameEl) {
    lineNameEl.textContent = buildCompactLineLabel();
    console.log('📍 Line set to:', lineNameEl.textContent);
  }
  if (cityNameEl) {
    cityNameEl.textContent = '';
    console.log('🏙️ City set to:', cityNameEl.textContent);
  }

  // Display Destination (last stop)
  if (navDestinationNameEl && currentRoute.data?.stops && currentRoute.data.stops.length) {
    const lastStop = currentRoute.data.stops[currentRoute.data.stops.length - 1];
    navDestinationNameEl.textContent = lastStop.name || 'Zielstation';
    
    // Calculate distance to last stop
    if (navCumDists && navCumDists.length > 0) {
      const totalDist = navCumDists[navCumDists.length - 1];
      navDestinationDistEl.textContent = navFormatDist(totalDist);
    } else {
      navDestinationDistEl.textContent = '–';
    }
    console.log('🎯 Destination set to:', navDestinationNameEl.textContent);
  }

  // Initial-Anzeige: erste Abbiegung und erste Haltestelle
  if (navTurns.length) {
    const info = getTurnInfo(navTurns[0].angle);
    const distStr = navFormatDist(navTurns[0].distFromStart);
    setNavArrowIcon(info.iconKey);
    navDistEl.textContent  = `in ${distStr}`;
    navLabelEl.textContent = info.label;
  } else {
    setNavArrowIcon('straight');
    navDistEl.textContent  = 'Startpunkt';
    navLabelEl.textContent = 'Geradeaus';
  }
  if (navStopDists.length) {
    navStopNameEl.textContent = navStopDists[0].stop.name;
    navStopDistEl.textContent = navFormatDist(navStopDists[0].distFromStart);
  }

  stopNavSimulation();
  
  // Starte Zeit-Update im HUD
  if (navTimeInterval) clearInterval(navTimeInterval);
  navTimeInterval = setInterval(() => {
    if (navTimeEl) {
      navTimeEl.textContent = `Fahrzeit ${formatDriveDuration(Date.now() - navStartTime)}`;
    }
  }, 1000);
  // Einmal sofort aktualisieren
  if (navTimeEl) {
    navTimeEl.textContent = 'Fahrzeit 00:00';
  }

  if (useSimulation) {
    startNavSimulation();
    return;
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

      // GPS-Daten glätten (exponentieller Durchschnitt reduziert Ruckeln)
      const smoothed = smoothGPSPosition(lat, lon, speed);

      const pts = currentRoute.data.routePoints;
      const tracked = resolveNavTrackPoint(smoothed.lat, smoothed.lon, pts);

      recordNavDriveSample(smoothed.lat, smoothed.lon, tracked, smoothed.speed, heading);

      navCenterOn(tracked.lon, tracked.lat, smoothHeading(heading), smoothed.speed);
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
  stopNavSimulation();
  stopGPS();
  clearGpsFirstFixTimer();
  if (navTimeInterval) {
    clearInterval(navTimeInterval);
    navTimeInterval = null;
  }
  gpsActive = false;
  gpsBtn.style.color = '';
  navNearestIdx = 0;
  navOffRouteActive = false;
  navRejoinBlend = 0;
  navProgressIdx = 0;
  navStartTime = 0;
  currentNavLine = null;
  navInputMode = 'gps';
  if (navTimeEl) navTimeEl.textContent = 'Fahrzeit --:--';
  gpsLastSmoothedPos = null;  // GPS-Smoothing zurücksetzen
  if (navMenuOverlay) navMenuOverlay.classList.add('hidden');  // Close menu
  stopNavDriveLogSession();
  resetNavPerfStats('idle');

  // Auto-save route after navigation
  if (currentRoute && currentRoute.key && currentRoute.data) {
    // Speichere in alte routes store (für Kompatibilität)
    dbPut(currentRoute.key, currentRoute.data)
      .then(() => {
        if (saveOfflineBtn) {
          saveOfflineBtn.textContent = '✓';
          saveOfflineBtn.title = 'Route ist offline gespeichert';
          setTimeout(() => {
            if (saveOfflineBtn) {
              saveOfflineBtn.textContent = '⬇';
              saveOfflineBtn.title = 'Route für Offline-Nutzung speichern';
            }
          }, 2000);
        }
      })
      .catch(err => console.warn('Auto-save Route fehlgeschlagen:', err));
    
    // Speichere auch in neuer linesData store
    const lineId = `${currentRoute.city}_${(currentRoute.lineFolder || '')}`.replace(/\//g, '_') + '_' + currentRoute.fileBase;
    dbPutLineData(lineId, currentRoute.data)
      .catch(err => console.warn('Auto-save linesData fehlgeschlagen:', err));
  }
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
  navProgressIdx = snap.index;

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
  if (Math.abs(a) < 20)      return { iconKey: 'straight', label: 'Geradeaus' };
  if (a >= 20 && a < 50)     return { iconKey: 'slight-right', label: 'Leicht rechts' };
  if (a >= 50 && a < 130)    return { iconKey: 'right', label: 'Rechts abbiegen' };
  if (a >= 130)              return { iconKey: 'sharp-right', label: 'Scharf rechts' };
  if (a <= -20 && a > -50)   return { iconKey: 'slight-left', label: 'Leicht links' };
  if (a <= -50 && a > -130)  return { iconKey: 'left', label: 'Links abbiegen' };
  if (a <= -130)             return { iconKey: 'sharp-left', label: 'Scharf links' };
  return { iconKey: 'straight', label: 'Weiterfahren' };
}

const NAV_MANEUVER_SVG = {
  straight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V7"></path><path d="M7 12l5-5 5 5"></path></svg>',
  'slight-right': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 20v-7q0-5 5-5h4"></path><path d="M15 4l4 4-4 4"></path></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 20V9h9"></path><path d="M15 5l4 4-4 4"></path></svg>',
  'sharp-right': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 20V12h4V8h6"></path><path d="M15 4l4 4-4 4"></path></svg>',
  'slight-left': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 20v-7q0-5-5-5H5"></path><path d="M9 4L5 8l4 4"></path></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 20V9H5"></path><path d="M9 5L5 9l4 4"></path></svg>',
  'sharp-left': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 20V12h-4V8H5"></path><path d="M9 4L5 8l4 4"></path></svg>',
  finish: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20V4"></path><path d="M6 4h10l-2 3 2 3H6"></path></svg>'
};

// ── Hilfsfunktion: Open-Source Maneuver-SVG setzen ───
function setNavArrowIcon(iconKey) {
  if (!navArrowEl) return;
  navArrowEl.innerHTML = NAV_MANEUVER_SVG[iconKey] || NAV_MANEUVER_SVG.straight;
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
  const nextTurnRaw = navTurns.find(t => t.distFromStart > currentDist + NAV_TURN_LOOKAHEAD_M);

  let lastPassedTurn = null;
  for (let i = navTurns.length - 1; i >= 0; i--) {
    if (navTurns[i].distFromStart <= currentDist) {
      lastPassedTurn = navTurns[i];
      break;
    }
  }

  const distSinceLastTurn = lastPassedTurn ? (currentDist - lastPassedTurn.distFromStart) : Infinity;
  const distToNextTurn = nextTurnRaw ? (nextTurnRaw.distFromStart - currentDist) : Infinity;
  const shouldDelayNextTurn = Boolean(
    nextTurnRaw &&
    lastPassedTurn &&
    distSinceLastTurn < NAV_POST_TURN_DELAY_M &&
    distToNextTurn > NAV_CLOSE_TURN_OVERRIDE_M
  );

  const nextTurn = shouldDelayNextTurn ? null : nextTurnRaw;

  if (nextTurn) {
    const info = getTurnInfo(nextTurn.angle);
    const distToTurn = navFormatDist(nextTurn.distFromStart - currentDist);
    setNavArrowIcon(info.iconKey);
    navDistEl.textContent  = `in ${distToTurn}`;
    navLabelEl.textContent = info.label;
  } else if (nextTurnRaw) {
    setNavArrowIcon('straight');
    navDistEl.textContent  = 'Weiterfahren';
    navLabelEl.textContent = 'Geradeaus';
  } else {
    setNavArrowIcon('finish');
    navDistEl.textContent  = 'Zieleinfahrt';
    navLabelEl.textContent = 'Ankommen';
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
  navUpcomingStopsEl.replaceChildren();
}

// ═════════════════════════════════════════════════════════════
// Navigation Menu Functions
// ═════════════════════════════════════════════════════════════

let navPaused = false;

function showNavMenu() {
  if (navMenuOverlay) {
    navMenuOverlay.classList.remove('hidden');
    updateNavMenuInfo();
    updateNavMenuStops();
  }
}

function hideNavMenu() {
  if (navMenuOverlay) {
    navMenuOverlay.classList.add('hidden');
  }
}

function switchNavMenuTab(tabName) {
  // Update active tab
  navTabs.forEach(tab => {
    if (tab.getAttribute('data-tab') === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Update active pane
  navPanes.forEach(pane => {
    if (pane.getAttribute('data-pane') === tabName) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });

  // Update content when switching tabs
  if (tabName === 'info') updateNavMenuInfo();
  if (tabName === 'stops') updateNavMenuStops();
}

function updateNavMenuInfo() {
  // Get route info
  const distEl = document.getElementById('navInfoDistance');
  const traveledEl = document.getElementById('navInfoTraveled');
  const remainingEl = document.getElementById('navInfoRemaining');
  const timeEl = document.getElementById('navInfoTime');

  if (!currentNavLine) {
    if (distEl) distEl.textContent = '-- km';
    if (traveledEl) traveledEl.textContent = '0 km';
    if (remainingEl) remainingEl.textContent = '-- km';
    if (timeEl) timeEl.textContent = '0:00';
    return;
  }

  // Calculate total distance
  let totalDist = 0;
  if (currentNavLine.points && currentNavLine.points.length > 0) {
    for (let i = 1; i < currentNavLine.points.length; i++) {
      const [lat1, lon1] = navGetLatLon(currentNavLine.points[i - 1]);
      const [lat2, lon2] = navGetLatLon(currentNavLine.points[i]);
      totalDist += haversineMeters(lat1, lon1, lat2, lon2);
    }
  }
  const totalDistKm = totalDist / 1000;

  // Calculate traveled distance
  let traveledDist = 0;
  if (navProgressIdx > 0 && currentNavLine.points && currentNavLine.points.length > 0) {
    for (let i = 1; i <= navProgressIdx && i < currentNavLine.points.length; i++) {
      const [lat1, lon1] = navGetLatLon(currentNavLine.points[i - 1]);
      const [lat2, lon2] = navGetLatLon(currentNavLine.points[i]);
      traveledDist += haversineMeters(lat1, lon1, lat2, lon2);
    }
  }
  const traveledKm = traveledDist / 1000;
  const remainingKm = Math.max(0, totalDistKm - traveledKm);

  // Calculate elapsed time
  const elapsedMs = Date.now() - navStartTime;
  const elapsedSecs = Math.floor(elapsedMs / 1000);
  const mins = Math.floor(elapsedSecs / 60);
  const secs = elapsedSecs % 60;
  const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;

  // Update UI
  if (distEl) distEl.textContent = totalDistKm.toFixed(1) + ' km';
  if (traveledEl) traveledEl.textContent = traveledKm.toFixed(1) + ' km';
  if (remainingEl) remainingEl.textContent = remainingKm.toFixed(1) + ' km';
  if (timeEl) timeEl.textContent = timeStr;
}

function updateNavMenuStops() {
  const listEl = document.getElementById('navUpcomingList');
  if (!listEl || !currentNavLine || !currentNavLine.stops) {
    if (listEl) listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Keine Haltestellen</div>';
    return;
  }

  // Get current distance traveled
  let currentDist = 0;
  if (navProgressIdx > 0 && currentNavLine.points && currentNavLine.points.length > 0) {
    for (let i = 1; i <= navProgressIdx && i < currentNavLine.points.length; i++) {
      const [lat1, lon1] = navGetLatLon(currentNavLine.points[i - 1]);
      const [lat2, lon2] = navGetLatLon(currentNavLine.points[i]);
      currentDist += haversineMeters(lat1, lon1, lat2, lon2);
    }
  }

  const nodes = currentNavLine.stops.map(stop => {
    const card = document.createElement('div');
    card.style.cssText = 'padding: 10px; background: var(--surface2); border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px;';

    const name = document.createElement('div');
    name.style.cssText = 'flex: 1; font-size: 13px; font-weight: 600;';
    name.textContent = stop.name;

    const dist = document.createElement('div');
    dist.style.cssText = 'font-size: 12px; color: var(--accent); font-weight: 500;';
    const remaining = Math.max(0, stop.distFromStart - currentDist);
    dist.textContent = navFormatDist(remaining);

    card.appendChild(name);
    card.appendChild(dist);
    return card;
  });

  listEl.replaceChildren(...nodes);
}

function toggleNavPause() {
  navPaused = !navPaused;
  
  if (navPauseBtn) {
    if (navPaused) {
      navPauseBtn.textContent = '▶ Fortsetzen';
      navPauseBtn.style.background = 'var(--accent)';
    } else {
      navPauseBtn.textContent = '⏸ Pause';
      navPauseBtn.style.background = 'var(--primary)';
    }
  }

  // TODO: Implement actual pause logic (disable GPS updates, freeze map, etc.)
  console.log('Navigation ' + (navPaused ? 'paused' : 'resumed'));
}

// =============================================================
// SIMULATION
// =============================================================

function toggleSimulationMode() {
  if (navActive && navInputMode === 'sim') {
    stopNavigation();
    return;
  }
  if (navActive && navInputMode === 'gps') {
    showToast('GPS-Navigation läuft. Erst beenden, dann Simulation starten.', 4500);
    return;
  }
  startNavigation({ useSimulation: true });
}

function stopNavSimulation() {
  if (simTimer) {
    clearInterval(simTimer);
    simTimer = null;
  }
  simRouteIdx = 0;
  if (simBtn) {
    simBtn.classList.remove('sim-running', 'nav-active');
    simBtn.textContent = 'SIM';
    simBtn.title = 'Debug-Simulation starten (ohne GPS)';
  }
}

function advanceSimIndex(pts, currentIdx, targetMeters) {
  const maxIdx = pts.length - 1;
  if (currentIdx >= maxIdx) return maxIdx;

  let idx = currentIdx;
  let covered = 0;
  while (idx < maxIdx && covered < targetMeters) {
    const [la1, lo1] = navGetLatLon(pts[idx]);
    const [la2, lo2] = navGetLatLon(pts[idx + 1]);
    covered += haversineM(la1, lo1, la2, lo2);
    idx += 1;
  }

  return Math.min(maxIdx, Math.max(currentIdx + 1, idx));
}

function pushSimFrame(idx, speedMps) {
  const pts = currentRoute?.data?.routePoints || [];
  if (!pts.length) return;

  const maxIdx = pts.length - 1;
  const safeIdx = Math.max(0, Math.min(maxIdx, idx));
  const [lat, lon] = navGetLatLon(pts[safeIdx]);

  let heading = null;
  if (safeIdx < maxIdx) {
    const [nextLat, nextLon] = navGetLatLon(pts[safeIdx + 1]);
    heading = bearingDeg(lat, lon, nextLat, nextLon);
  }

  const tracked = resolveNavTrackPoint(lat, lon, pts);
  recordNavDriveSample(lat, lon, tracked, speedMps, heading);
  setSimulatedGPS(tracked.lon, tracked.lat, heading);
  simCenterOn(tracked.lon, tracked.lat, smoothHeading(heading), speedMps);
  updateNavHud(tracked.lat, tracked.lon, tracked.index);

  if (navSpeedEl) navSpeedEl.textContent = String(Math.round(speedMps * 3.6));
}

function startNavSimulation() {
  if (!currentRoute?.data?.routePoints?.length) {
    showToast('Keine Route für Simulation geladen.', 5000);
    stopNavigation();
    return;
  }

  stopGPS();
  gpsActive = false;
  clearGpsFirstFixTimer();

  const pts = currentRoute.data.routePoints;
  const speedMps = SIM_DEFAULT_SPEED_KMH / 3.6;
  const metersPerTick = speedMps * (SIM_TICK_MS / 1000);

  if (simBtn) {
    simBtn.classList.add('sim-running', 'nav-active');
    simBtn.textContent = 'STOP';
    simBtn.title = 'Simulation beenden';
  }

  simRouteIdx = 0;
  pushSimFrame(simRouteIdx, speedMps);

  simTimer = setInterval(() => {
    if (!navActive || navInputMode !== 'sim') {
      stopNavSimulation();
      return;
    }

    simRouteIdx = advanceSimIndex(pts, simRouteIdx, metersPerTick);
    pushSimFrame(simRouteIdx, speedMps);

    if (simRouteIdx >= pts.length - 1) {
      showToast('Simulation beendet.', 2500);
      stopNavigation();
    }
  }, SIM_TICK_MS);
}



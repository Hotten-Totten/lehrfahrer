// =========================
// APP LOGIC – Lehrfahrer PWA
// =========================

const API_BASE = '../api';
const DB_NAME  = 'lehrfahrer-offline';
const DB_VER   = 3;
const STORAGE_KEY_LINES_CATALOG = 'lehrfahrer-lines-catalog-version';
const STORAGE_KEY_DISMISSED_UPDATE = 'lehrfahrer-dismissed-lines-update';

let db          = null;
let currentRoute = null;
let gpsActive   = false;
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
let screenWakeLock = null;
let screenWakeLockRequestPending = false;
const SIM_TICK_MS = 900;
const SIM_DEFAULT_SPEED_KMH = 34;

// GPS-Smoothing (reduziert Ruckeln bei schlechtem GPS)
let gpsLastSmoothedPos = null;
const GPS_SMOOTHING_ALPHA = 0.65;  // höher = schneller Response, niedriger = glatter

const NAV_SNAP_MAX_M = 120;
const NAV_SNAP_WINDOW = 24;
const NAV_TURN_DEFAULT_PASS_BUFFER_M = 38;
const NAV_TURN_CLOSE_GAP_M = 90;
const NAV_TURN_MIN_PASS_BUFFER_M = 8;
const NAV_TURN_NOW_WINDOW_M = 10;
// Cottbus-Feintuning: robuster gegen Innenstadt-GPS-Drift,
// aber weiterhin klarer OFF->REJOIN->ON Verlauf.
const NAV_OFF_ROUTE_ENTER_M = 145;
const NAV_REJOIN_START_M = 78;
const NAV_REJOIN_BLEND_STEP = 0.20;
const NAV_REJOIN_LOOKAHEAD_M = 800;
let navOffRouteActive = false;
let navRejoinBlend = 0;
const NAV_INDEX_BACKTRACK_TOLERANCE = 2;

// Navigation Menu
let currentNavLine = null;
let navProgressIdx = 0;
let navStartTime = 0;
let navScheduleAnchorMs = null;
let navDestinationHitCount = 0;

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
const refreshLinesBtn  = document.getElementById('refreshLinesBtn');
const fullscreenBtn    = document.getElementById('fullscreenBtn');
const settingsBtn      = document.getElementById('settingsBtn');
const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
const map2dToggleBtn   = document.getElementById('map2dToggleBtn');
const startupDownloadOverlay = document.getElementById('startupDownloadOverlay');
const startupDownloadText = document.getElementById('startupDownloadText');
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
const removeLocalTilesBtn = document.getElementById('removeLocalTilesBtn');
const storagePersistenceStatus = document.getElementById('storagePersistenceStatus');
const requestStoragePersistenceBtn = document.getElementById('requestStoragePersistenceBtn');
const availableLinesContainer = document.getElementById('availableLinesContainer');
const navigateToStartBtn = document.getElementById('navigateToStartBtn');
const lineStartMenu = document.getElementById('lineStartMenu');
const closeLineStartMenuBtn = document.getElementById('closeLineStartMenuBtn');
const startAtLineStartBtn = document.getElementById('startAtLineStartBtn');

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
const navPauseCompactBtn = document.getElementById('navPauseCompactBtn');
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
const markerMotionSelect = document.getElementById('markerMotionSelect');
const markerTurnSelect = document.getElementById('markerTurnSelect');
const showGhostStopsToggle = document.getElementById('showGhostStopsToggle');
const punctualityToggle = document.getElementById('punctualityToggle');
const navPunctualityToggle = document.getElementById('navPunctualityToggle');
const punctualityDepartureTimeInput = document.getElementById('punctualityDepartureTime');
const navPunctualityDepartureTimeInput = document.getElementById('navPunctualityDepartureTime');
const navInfoPunctualityEl = document.getElementById('navInfoPunctuality');

const CAMERA_PROFILE_KEY = 'lehrfahrer_camera_profile';
const MARKER_MOTION_PROFILE_KEY = 'lehrfahrer_marker_motion_profile';
const MARKER_TURN_PROFILE_KEY = 'lehrfahrer_marker_turn_profile';
const GHOST_STOPS_VISIBLE_KEY = 'lehrfahrer_show_ghost_stops';
const PUNCTUALITY_ENABLED_KEY = 'lehrfahrer_show_punctuality';
const PUNCTUALITY_DEPARTURE_TIME_KEY = 'lehrfahrer_punctuality_departure_time';
const MAP_2D_MODE_KEY = 'lehrfahrer_map_2d_mode';
const STARTUP_DOWNLOAD_GUARD_PREFIX = 'lf_startup_download_done_';
const STORAGE_PERSIST_ATTEMPTED_KEY = 'lf_storage_persist_attempted';
let refreshInProgress = false;

// ── Start ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 App starting...');
  initFullscreenUi();
  registerServiceWorker();
  try {
    await openDB();
  } catch (err) {
    db = null;
    console.warn('IndexedDB nicht verfuegbar. Offline-Speicher ist deaktiviert:', err);
  }
  await initMap();
  await refreshStoragePersistenceStatus();
  initMap2DMode();
  initNavPerfDebugHud();
  bindEvents();
  detectOffline();
  await loadCities();
  
  console.log('📦 Fetching lines catalog...');
  // Lade Linien-Katalog
  await fetchAndCacheLinesCatalog();
  
  console.log('⏳ Starting background auto-download...');
  // Auto-Download aller Linien im Hintergrund (nicht blockierend),
  // aber pro Session/Version nur einmal.
  if (shouldRunStartupAutoDownload()) {
    autoDownloadAllLines()
      .then(() => markStartupAutoDownloadDone())
      .catch(err => {
        clearStartupAutoDownloadGuard();
        console.warn('Auto-download background error:', err);
      });
  } else {
    console.log('⏭️ Startup auto-download skipped (already run in this session/version)');
  }
});

function startupDownloadGuardKey() {
  const version = document.getElementById('versionBadge')?.textContent?.trim() || 'unknown';
  return STARTUP_DOWNLOAD_GUARD_PREFIX + version;
}

function shouldRunStartupAutoDownload() {
  try {
    const key = startupDownloadGuardKey();
    if (sessionStorage.getItem(key) === 'done') return false;
    sessionStorage.setItem(key, 'running');
    return true;
  } catch {
    // Falls sessionStorage nicht verfuegbar ist, nicht blockieren.
    return true;
  }
}

function markStartupAutoDownloadDone() {
  try {
    sessionStorage.setItem(startupDownloadGuardKey(), 'done');
  } catch {
    // ignore
  }
}

function clearStartupAutoDownloadGuard() {
  try {
    sessionStorage.removeItem(startupDownloadGuardKey());
  } catch {
    // ignore
  }
}

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
    categoryFolder: currentRoute.categoryFolder || null,
    lineName: currentRoute.data.lineName || null,
    routeName: currentRoute.data.routeName || null,
    variantName: getAppVariantName(currentRoute.data),
    variantCategory: getAppVariantCategory(currentRoute.data),
    validFrom: getAppValidity(currentRoute.data).validFrom,
    validUntil: getAppValidity(currentRoute.data).validUntil
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
    const swVersion = document.getElementById('versionBadge')?.textContent?.trim() || String(Date.now());
    navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(swVersion)}`, { updateViaCache: 'none' })
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
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB ist nicht verfuegbar.'));
      return;
    }

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
      // Lines PDF Object Store
      if (!d.objectStoreNames.contains('linesPDF')) {
        d.createObjectStore('linesPDF', { keyPath: 'id' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror   = () => reject(req.error);
  });
}

function requireDB() {
  if (!db) {
    throw new Error('IndexedDB ist nicht verfuegbar.');
  }
  return db;
}

function dbPut(key, data) {
  return new Promise((resolve, reject) => {
    const tx  = requireDB().transaction('routes', 'readwrite');
    const req = tx.objectStore('routes').put({ key, data, savedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbGet(key) {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve(null);
      return;
    }
    const tx  = requireDB().transaction('routes', 'readonly');
    const req = tx.objectStore('routes').get(key);
    req.onsuccess = () => resolve(req.result?.data ?? null);
    req.onerror   = () => reject(req.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve([]);
      return;
    }
    const tx  = requireDB().transaction('routes', 'readonly');
    const req = tx.objectStore('routes').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(key) {
  return new Promise((resolve, reject) => {
    const tx  = requireDB().transaction('routes', 'readwrite');
    const req = tx.objectStore('routes').delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Lines Catalog (Metadaten) ─────────────────────────────────
function dbPutLinesCatalog(catalog) {
  return new Promise((resolve, reject) => {
    const tx = requireDB().transaction('linesCatalog', 'readwrite');
    const req = tx.objectStore('linesCatalog').clear();
    req.onsuccess = () => {
      catalog.forEach(line => {
        tx.objectStore('linesCatalog').put({ 
          id: line.id, 
          city: line.city,
          lineFolder: line.lineFolder,
          categoryFolder: line.categoryFolder || null,
          fileName: line.fileName,
          file: line.file,
          jsonPath: line.jsonPath || null,
          gpxPath: line.gpxPath || null,
          fileBase: line.fileBase,
          lineName: line.lineName,
          routeName: line.routeName,
          directionName: line.directionName || '',
          variantName: line.variantName || '',
          variantCategory: line.variantCategory || 'Standard',
          description: line.description || '',
          validFrom: line.validFrom || '',
          validUntil: line.validUntil || '',
          hasPdf: !!line.hasPdf,
          pdfFile: line.pdfFile || null,
          updatedAt: Number(line.updatedAt) || 0
        });
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetLinesCatalog() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve([]);
      return;
    }
    const tx = requireDB().transaction('linesCatalog', 'readonly');
    const req = tx.objectStore('linesCatalog').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ── Lines Data (JSON-Inhalt) ──────────────────────────────────
function dbPutLineData(id, lineData, sourceUpdatedAt = 0) {
  return new Promise((resolve, reject) => {
    const tx = requireDB().transaction('linesData', 'readwrite');
    const req = tx.objectStore('linesData').put({
      id,
      data: lineData,
      sourceUpdatedAt: Number(sourceUpdatedAt) || 0,
      savedAt: Date.now()
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbGetLineData(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve(null);
      return;
    }
    const tx = requireDB().transaction('linesData', 'readonly');
    const req = tx.objectStore('linesData').get(id);
    req.onsuccess = () => resolve(req.result?.data ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ── Lines GPX ─────────────────────────────────────────────────
function dbPutLineGPX(id, gpxData) {
  return new Promise((resolve, reject) => {
    const tx = requireDB().transaction('linesGPX', 'readwrite');
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
    if (!db) {
      resolve(null);
      return;
    }
    const tx = requireDB().transaction('linesGPX', 'readonly');
    const req = tx.objectStore('linesGPX').get(id);
    req.onsuccess = () => resolve(req.result?.data ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ── Lines PDF ─────────────────────────────────────────────────
function dbPutLinePDF(id, pdfData, fileName = '', sourceUpdatedAt = 0) {
  return new Promise((resolve, reject) => {
    const tx = requireDB().transaction('linesPDF', 'readwrite');
    const req = tx.objectStore('linesPDF').put({
      id,
      data: pdfData,
      fileName: fileName || null,
      sourceUpdatedAt: Number(sourceUpdatedAt) || 0,
      savedAt: Date.now()
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbGetLinePDFRecord(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve(null);
      return;
    }
    const tx = requireDB().transaction('linesPDF', 'readonly');
    const req = tx.objectStore('linesPDF').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function buildLineStorageId(line) {
  const fileBase = (line.fileBase || String(line.file || '').replace(/\.json$/i, '')).trim();
  return `${line.city}${line.lineFolder ? '_' + line.lineFolder : ''}${line.categoryFolder ? '_' + line.categoryFolder : ''}_${fileBase}`.replace(/\//g, '_');
}

function buildAppRelativeAssetUrl(path) {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  if (!cleanPath) return '';
  if (/^https?:\/\//i.test(cleanPath) || cleanPath.startsWith('../')) return cleanPath;
  return `../${cleanPath}`;
}

async function fetchAndCacheLinePdf(line, dbId) {
  if (!line || !line.hasPdf) return false;

  try {
    let pdfUrl = `${API_BASE}/download_line_pdf.php?city=${encodeURIComponent(line.city)}&line=${encodeURIComponent(line.fileBase || line.file)}`;
    if (line.lineFolder) pdfUrl += `&lineFolder=${encodeURIComponent(line.lineFolder)}`;
    if (line.categoryFolder) pdfUrl += `&categoryFolder=${encodeURIComponent(line.categoryFolder)}`;

    const pdfRes = await fetch(pdfUrl, { cache: 'no-store' });
    if (!pdfRes.ok) return false;

    const pdfArrayBuffer = await pdfRes.arrayBuffer();
    if (!pdfArrayBuffer || !pdfArrayBuffer.byteLength) return false;

    await dbPutLinePDF(
      dbId,
      pdfArrayBuffer,
      line.pdfFile || `${(line.fileBase || 'linie')}.pdf`,
      Number(line.updatedAt) || 0
    );

    return true;
  } catch (err) {
    console.warn('PDF download failed:', err.message);
    return false;
  }
}

// ── Lines Katalog laden und aktualisieren ──────────────────
async function fetchAndCacheLinesCatalog() {
  try {
    console.log('📦 Fetching lines catalog from API...');
    const response = await fetch(`${API_BASE}/list_lines.php`, { cache: 'no-store' });
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
    
    // In IndexedDB speichern, falls verfuegbar.
    if (db) {
      await dbPutLinesCatalog(uniqueLines);
    } else {
      console.warn('Linienkatalog nur im Speicher verfuegbar: IndexedDB ist deaktiviert.');
    }
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
    const fileBase = (line.fileBase || String(line.file || '').replace(/\.json$/i, '')).trim();
    let url = `${API_BASE}/load_line.php?city=${encodeURIComponent(line.city)}&line=${encodeURIComponent(fileBase)}`;
    if (line.lineFolder) url += `&lineFolder=${encodeURIComponent(line.lineFolder)}`;
    if (line.categoryFolder) url += `&categoryFolder=${encodeURIComponent(line.categoryFolder)}`;

    const res = await fetch(url, { cache: 'no-store' });
    console.log('App lade Linie fuer Offline-Cache', {
      url: res.url,
      status: res.status,
      lineFolder: line.lineFolder || null,
      categoryFolder: line.categoryFolder || null
    });
    const json = await res.json();

    if (!json.ok || !json.line) {
      console.warn(`  ⚠️ API failed for ${lineId}`);
      return false;
    }

    // Speichere in IndexedDB
    const lineData = json.line;

    // Formatiere die ID konsistent (city_lineFolder_fileBase, mit _ statt /)
    const dbId = buildLineStorageId(line);

    await dbPutLineData(dbId, lineData, Number(line.updatedAt) || 0);
    
    // Speichere auch GPX falls vorhanden
    if (json.gpx) {
      await dbPutLineGPX(dbId, json.gpx);
    }

    if (line.hasPdf) {
      await fetchAndCacheLinePdf(line, dbId);
    }

    console.log(`  ✓ ${line.lineName} downloaded and cached`);
    return true;
  } catch (err) {
    console.warn(`  ⚠️ Error downloading line: ${err.message}`);
    return false;
  }
}

// ── Notification für neue Linien ──────────────────────────────
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

function showStartupDownloadOverlay(totalCount) {
  if (!startupDownloadOverlay) return;
  if (startupDownloadText) {
    startupDownloadText.textContent = `Linien werden aktualisiert (${totalCount})...`;
  }
  startupDownloadOverlay.classList.remove('hidden');
}

function updateStartupDownloadOverlay(current, total, lineName = '') {
  if (!startupDownloadText) return;
  const safeName = (lineName || '').trim();
  startupDownloadText.textContent = safeName
    ? `Linien werden aktualisiert (${current}/${total}) - ${safeName}`
    : `Linien werden aktualisiert (${current}/${total})...`;
}

function hideStartupDownloadOverlay() {
  if (!startupDownloadOverlay) return;
  startupDownloadOverlay.classList.add('hidden');
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
    
    lineItem.onclick = event => {
      if (event.target !== checkbox) checkbox.click();
    };
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

    const available = availableLinesCatalog || [];

    const tx = requireDB().transaction('linesData', 'readonly');
    const req = tx.objectStore('linesData').getAll();
    const cachedData = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const cachedById = new Map();
    cachedData.forEach(item => cachedById.set(item.id, item));

    const resolveStorageId = (line, useLegacy = false) => {
      const fileBase = (line.fileBase || String(line.file || '').replace(/\.json$/i, '')).trim();
      const filePart = useLegacy ? String(line.file || `${fileBase}.json`) : fileBase;
      return `${line.city}${line.lineFolder ? '_' + line.lineFolder : ''}${line.categoryFolder ? '_' + line.categoryFolder : ''}_${filePart}`.replace(/\//g, '_');
    };

    console.log(`📊 Status: ${cachedData.length} cached, ${available.length} available`);
    console.log('📋 Available IDs:', available.map(l => l.id));
    
    if (available.length === 0) {
      console.log('⚠️ No lines to auto-download');
      return;
    }
    
    // Delta-Refresh mit Sofort-Aktualitaet:
    // - fehlt lokal  -> laden
    // - updatedAt geaendert -> neu laden
    // - ohne updatedAt-Metadaten -> sicherheitshalber laden
    const toDownload = available.filter(line => {
      const idCurrent = resolveStorageId(line, false);
      const idLegacy = resolveStorageId(line, true);
      const cached = cachedById.get(idCurrent) || cachedById.get(idLegacy);
      if (!cached) return true;

      const serverUpdatedAt = Number(line.updatedAt) || 0;
      if (!serverUpdatedAt) return true;

      const localUpdatedAt = Number(cached.sourceUpdatedAt) || 0;
      return localUpdatedAt !== serverUpdatedAt;
    });
    
    console.log(`📋 toDownload list: ${toDownload.length} lines to download`);
    toDownload.forEach(l => console.log(`  - ${l.lineName} (${l.id})`));
    
    console.log(`⬇️ Auto-refreshing ${toDownload.length} changed/missing lines in background...`);
    
    showStartupDownloadOverlay(toDownload.length);
    console.log('✓ Startup download overlay shown');
    
    // Download im Hintergrund (mit Verzögerung zwischen den Downloads)
    let completed = 0;
    for (const line of toDownload) {
      try {
        updateStartupDownloadOverlay(completed + 1, toDownload.length, line.lineName || line.id);
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

    hideStartupDownloadOverlay();
    console.log('✓ Startup download overlay hidden');
    
    console.log(`✅ Auto-download complete: ${completed}/${toDownload.length} lines cached`);
  } catch (err) {
    hideStartupDownloadOverlay();
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
  if (refreshLinesBtn) refreshLinesBtn.addEventListener('click', refreshLinesNow);

  gpsBtn.addEventListener('click', toggleGPS);
  if (simBtn) simBtn.addEventListener('click', toggleSimulationMode);
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreenMode);
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (mobileSettingsBtn) mobileSettingsBtn.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', e => {
    if (e.target === settingsOverlay) closeSettings();
  });

  panelHandle.addEventListener('click', togglePanel);
  if (panelCloseBtn) panelCloseBtn.addEventListener('click', () => setPanelOpen(false));
  
  if (navigateToStartBtn) {
    navigateToStartBtn.addEventListener('click', () => {
      if (lineStartMenu) lineStartMenu.classList.toggle('hidden');
    });
    console.log('✅ navigateToStartBtn event listener attached');
  } else {
    console.warn('❌ navigateToStartBtn not found in DOM');
  }
  if (closeLineStartMenuBtn) {
    closeLineStartMenuBtn.addEventListener('click', () => {
      lineStartMenu.classList.add('hidden');
    });
  }
  if (startAtLineStartBtn) {
    startAtLineStartBtn.addEventListener('click', () => {
      lineStartMenu.classList.add('hidden');
      startNavigation();
    });
  }
  loadLocalTilesBtn.addEventListener('click', () => {
    tilesFileInput.value = '';
    tilesFileInput.click();
  });
  tilesFileInput.addEventListener('change', onTilesFileSelected);
  if (removeLocalTilesBtn) {
    removeLocalTilesBtn.addEventListener('click', async () => {
      if (!confirm('Offline-Karte wirklich von diesem Gerät entfernen?')) return;
      await removeInstalledOfflineMap();
    });
  }
  if (requestStoragePersistenceBtn) {
    requestStoragePersistenceBtn.addEventListener('click', () => requestPersistentStorage(false));
  }

  navBtn.addEventListener('click', () => {
    if (navActive) stopNavigation();
    else startNavigation();
  });

  if (navEndBtn) {
    bindTapAction(navEndBtn, () => {
      stopNavigation();
    });
  }

  // Navigation Menu Button
  if (navMenuBtn) {
    bindTapAction(navMenuBtn, () => {
      showNavMenu();
    });
  }

  bindTapAction(navPauseCompactBtn, toggleNavPause);

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
  bindTapAction(navPauseBtn, toggleNavPause);

  // Cancel Button
  if (navCancelBtn) {
    navCancelBtn.addEventListener('click', () => {
      hideNavMenu();
    });
  }
}

function bindTapAction(el, action) {
  if (!el || typeof action !== 'function') return;

  let suppressClickUntil = 0;

  el.addEventListener('touchend', () => {
    suppressClickUntil = Date.now() + 350;
    action();
  }, { passive: true });

  el.addEventListener('click', () => {
    if (Date.now() < suppressClickUntil) {
      return;
    }
    action();
  });
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
    const res  = await fetch(`${API_BASE}/list_cities.php`, { cache: 'no-store' });
    const json = await res.json();
    let cities = json.ok && Array.isArray(json.cities) ? json.cities : [];

    // Fallback: Der Linienkatalog ist die verlässlichste Quelle, falls eine
    // ältere list_cities.php Kategorienordner noch nicht erkennt.
    if (!cities.length) {
      const catalogRes = await fetch(`${API_BASE}/list_lines.php?_ts=${Date.now()}`, { cache: 'no-store' });
      const catalogJson = await catalogRes.json();
      if (catalogJson.ok && Array.isArray(catalogJson.lines)) {
        cities = Array.from(new Set(catalogJson.lines.map(line => String(line.city || '').trim()).filter(Boolean)));
      }
    }
    if (!cities.length) {
      citySelect.innerHTML = '<option value="">Keine Orte vorhanden</option>';
      return;
    }

    cities.sort((a, b) => a.localeCompare(b, 'de', { numeric: true })).forEach(city => {
      const opt = document.createElement('option');
      opt.value       = city;
      opt.textContent = capitalizeCity(city);
      citySelect.appendChild(opt);
    });

    // Einzige Stadt automatisch vorwählen
    if (cities.length === 1) {
      citySelect.value = cities[0];
      await loadLines(cities[0]);
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
    const res  = await fetch(`${API_BASE}/list_lines.php?city=${encodeURIComponent(city)}&_ts=${Date.now()}`, { cache: 'no-store' });
    const json = await res.json();
    if (!json.ok || !json.lines.length) {
      lineSelect.innerHTML = '<option value="">Keine Linien vorhanden</option>';
      return;
    }

    lineSelect.innerHTML = '<option value="">Linie wählen …</option>';
    json.lines.forEach(line => {
      const opt      = document.createElement('option');
      opt.value      = JSON.stringify({
        city: line.city || city,
        file: line.file || '',
        fileBase: line.fileBase || String(line.file || '').replace(/\.json$/i, '') || line.id,
        lineFolder: line.lineFolder || null,
        categoryFolder: line.categoryFolder || null,
        jsonPath: line.jsonPath || null
      });
      opt.textContent = [
        line.lineName || line.id,
        getAppVariantCategory(line),
        line.routeName || '',
        getAppVariantName(line)
      ].filter(Boolean).join(' | ');
      const description = getAppLineDescription(null, line);
      if (description) {
        opt.textContent = `${opt.textContent} · ${description}`;
        opt.title = `Bemerkung: ${description}`;
      }
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

  const { city: lineCity, fileBase, lineFolder, categoryFolder, jsonPath, file } = JSON.parse(lineSelect.value);
  const city = lineCity || citySelect.value;

  await loadAndShowRoute(city, fileBase, lineFolder, categoryFolder, jsonPath, file);
}

// ── Route laden und anzeigen ─────────────────────────────────
async function loadAndShowRoute(city, fileBase, lineFolder, categoryFolder, jsonPath = null, fileName = null) {
  const cleanFileBase = String(fileBase || fileName || '').replace(/\.json$/i, '').trim();
  const key = `${city}/${lineFolder || ''}/${categoryFolder || ''}/${cleanFileBase}`;

  // Erst offline-Cache prüfen
  let data = null;
  
  try {
    // 1. Checke neue linesData store (gedownloadete Linien)
    const lineId = `${city}_${lineFolder || ''}_${categoryFolder || ''}_${cleanFileBase}`.replace(/\//g, '_');
    const lineData = await dbGetLineData(lineId);
    if (lineData) {
      data = lineData;
      console.log('✓ Linie aus Download-Cache geladen');
    }
  } catch (err) {
    console.warn('Error checking linesData store:', err);
  }
  
  // 2. Wenn nicht im Download-Cache, checke alte routes store
  if (!data) {
    try { 
      data = await dbGet(key);
      if (data) console.log('✓ Linie aus gespeicherten Routen geladen');
    } catch (err) {
      console.warn('Error checking routes store:', err);
    }
  }

  // 3. Dann Server versuchen
  if (!data) {
    try {
      let url = `${API_BASE}/load_line.php?city=${encodeURIComponent(city)}&line=${encodeURIComponent(cleanFileBase)}`;
      if (lineFolder) url += `&lineFolder=${encodeURIComponent(lineFolder)}`;
      if (categoryFolder) url += `&categoryFolder=${encodeURIComponent(categoryFolder)}`;

      const res  = await fetch(`${url}${url.includes('?') ? '&' : '?'}_ts=${Date.now()}`, { cache: 'no-store' });
      console.log('App lade Linie per API', { url: res.url, status: res.status, lineFolder, categoryFolder });
      const rawText = await res.text();
      let json = null;
      try {
        json = JSON.parse(rawText);
      } catch (_) {
        console.warn('API-Antwort ist kein JSON', { url: res.url, status: res.status, rawText });
      }
      if (json?.ok && json.line) {
        data = json.line;
        console.log('App Linie per API geladen', {
          url: res.url,
          status: res.status,
          stops: Array.isArray(data.stops) ? data.stops.length : 0,
          routePoints: Array.isArray(data.routePoints) ? data.routePoints.length : 0,
          lineFolder,
          categoryFolder
        });
      } else {
        console.warn('API konnte Linie nicht laden', {
          url: res.url,
          status: res.status,
          error: json?.error || 'Keine Linie in Antwort',
          lineFolder,
          categoryFolder
        });
      }
    } catch (err) {
      console.warn('Route laden fehlgeschlagen:', err);
    }
  }

  if (!data && jsonPath) {
    try {
      const directUrl = buildAppRelativeAssetUrl(jsonPath);
      const res = await fetch(`${directUrl}${directUrl.includes('?') ? '&' : '?'}_ts=${Date.now()}`, { cache: 'no-store' });
      console.log('App lade Linie per Direktpfad', { url: res.url, status: res.status, lineFolder, categoryFolder });
      if (res.ok) {
        data = await res.json();
        console.log('App Linie per Direktpfad geladen', {
          url: res.url,
          status: res.status,
          stops: Array.isArray(data.stops) ? data.stops.length : 0,
          routePoints: Array.isArray(data.routePoints) ? data.routePoints.length : 0,
          lineFolder,
          categoryFolder
        });
      } else {
        console.warn('Direktpfad konnte Linie nicht laden', { url: res.url, status: res.status, lineFolder, categoryFolder });
      }
    } catch (err) {
      console.warn('Direkter JSON-Pfad fehlgeschlagen:', err);
    }
  }

  if (!data) {
    console.warn('App Linie nicht verfuegbar', {
      city,
      fileBase: cleanFileBase,
      fileName,
      jsonPath,
      lineFolder,
      categoryFolder
    });
    stopList.innerHTML = '<p class="hint">Route nicht verfuegbar - online nicht gefunden und offline nicht gespeichert.</p>';
    return;
  }

  const stopCount = Array.isArray(data.stops) ? data.stops.length : 0;
  const routePointCount = Array.isArray(data.routePoints) ? data.routePoints.length : 0;
  if (stopCount === 0 && routePointCount === 0) {
    console.warn('Geladene Linie enthaelt keine Stops/RoutePoints', {
      city,
      fileBase: cleanFileBase,
      jsonPath,
      lineFolder,
      categoryFolder,
      data
    });
  }

  currentRoute = { city, fileBase: cleanFileBase, lineFolder, categoryFolder, jsonPath, key, data };

  displayRoute(data);
}

function getSelectedLineRef() {
  if (!lineSelect || !lineSelect.value) return null;
  try {
    const parsed = JSON.parse(lineSelect.value);
    return {
      city: String(parsed.city || citySelect?.value || '').trim(),
      file: parsed.file || '',
      fileBase: String(parsed.fileBase || parsed.file || '').replace(/\.json$/i, '').trim(),
      lineFolder: parsed.lineFolder || null,
      categoryFolder: parsed.categoryFolder || null,
      jsonPath: parsed.jsonPath || null
    };
  } catch {
    return null;
  }
}

function findCatalogLineBySelection(selection) {
  if (!selection) return null;
  return (availableLinesCatalog || []).find(line => {
    const lineFileBase = String(line.fileBase || line.id || '').trim();
    const lineFolder = line.lineFolder || null;
    const categoryFolder = line.categoryFolder || null;
    return (
      String(line.city || '').trim() === selection.city &&
      lineFileBase === selection.fileBase &&
      lineFolder === selection.lineFolder &&
      categoryFolder === selection.categoryFolder
    );
  }) || null;
}

function setRefreshButtonBusy(isBusy) {
  if (!refreshLinesBtn) return;
  refreshLinesBtn.disabled = !!isBusy;
  refreshLinesBtn.style.opacity = isBusy ? '0.65' : '';
  refreshLinesBtn.title = isBusy
    ? 'Aktualisierung läuft...'
    : 'Linien und aktuelle Route aktualisieren';
}

async function refreshLinesNow() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  setRefreshButtonBusy(true);

  const selectionBefore = getSelectedLineRef();
  const hadNav = navActive;
  const navWasSim = navInputMode === 'sim';

  try {
    if (hadNav) {
      const proceed = confirm('Navigation läuft gerade. Für ein Linien-Update wird die Navigation beendet und danach neu gestartet. Fortfahren?');
      if (!proceed) return;
      stopNavigation();
    }

    showToast('Aktualisiere Linien...', 2500);
    await fetchAndCacheLinesCatalog();

    const city = String(citySelect?.value || '').trim();
    if (city) {
      await loadLines(city);
    }

    if (selectionBefore && selectionBefore.fileBase) {
      const catalogLine = findCatalogLineBySelection(selectionBefore);
      if (catalogLine) {
        await downloadLineWithGPX(catalogLine.id);
      }

      const selectedValue = JSON.stringify({
        city: selectionBefore.city,
        file: selectionBefore.file || '',
        fileBase: selectionBefore.fileBase,
        lineFolder: selectionBefore.lineFolder,
        categoryFolder: selectionBefore.categoryFolder,
        jsonPath: selectionBefore.jsonPath || null
      });

      if (lineSelect && Array.from(lineSelect.options).some(opt => opt.value === selectedValue)) {
        lineSelect.value = selectedValue;
      }

      await loadAndShowRoute(selectionBefore.city, selectionBefore.fileBase, selectionBefore.lineFolder, selectionBefore.categoryFolder, selectionBefore.jsonPath, selectionBefore.file);

      if (hadNav) {
        startNavigation({ useSimulation: navWasSim });
      }
      showToast('Linie aktualisiert.', 2500);
      return;
    }

    showToast('Linienkatalog aktualisiert.', 2500);
  } catch (err) {
    console.error('Refresh failed:', err);
    showToast(`Aktualisierung fehlgeschlagen: ${err.message || 'Unbekannter Fehler'}`, 4500);
  } finally {
    setRefreshButtonBusy(false);
    refreshInProgress = false;
  }
}

// ── Route darstellen ─────────────────────────────────────────
function displayRoute(data) {
  const visibleStops = getVisibleStops(data.stops || []);

  // Karte
  if (data.routePoints && data.routePoints.length) {
    showRoute(data.routePoints);
    applyTabletRoutePresentation();
  }
  showStops(visibleStops, (i, stop) => {
    flyToStop(stop);
    highlightStopInList(i);
  });

  // Panel-Header
  const catalogLine = currentRoute ? findCatalogLineBySelection(currentRoute) : null;
  const description = getAppLineDescription(data, catalogLine);
  const variantName = getAppVariantName(data, catalogLine);
  const variantCategory = getAppVariantCategory(data, catalogLine);
  const validityText = formatAppValidity(data, catalogLine);
  panelTitle.textContent = data.lineName  || 'Route';
  panelMeta.textContent  = [
    variantCategory,
    variantName,
    description ? `Bemerkung: ${description}` : '',
    validityText
  ].filter(Boolean).join(' | ');

  // Haltestellenliste
  renderStopList(visibleStops);
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

function applyTabletRoutePresentation() {
  if (!window.matchMedia('(orientation: landscape) and (min-width: 951px) and (max-width: 1450px)').matches) return;

  const applyPaint = () => {
    if (!map || !map.getLayer('route-shadow') || !map.getLayer('route-line')) return false;
    map.setPaintProperty('route-shadow', 'line-color', '#3f0710');
    map.setPaintProperty('route-shadow', 'line-width', 18);
    map.setPaintProperty('route-shadow', 'line-opacity', 0.72);
    map.setPaintProperty('route-shadow', 'line-blur', 1.5);
    map.setLayoutProperty('route-shadow', 'line-cap', 'round');
    map.setLayoutProperty('route-shadow', 'line-join', 'round');
    map.setPaintProperty('route-line', 'line-color', '#f20d20');
    map.setPaintProperty('route-line', 'line-width', 10);
    map.setPaintProperty('route-line', 'line-opacity', 1);
    map.setLayoutProperty('route-line', 'line-cap', 'round');
    map.setLayoutProperty('route-line', 'line-join', 'round');
    return true;
  };

  if (!applyPaint() && map) {
    map.once('idle', applyPaint);
  }
}

function isGhostStop(stop) {
  if (!stop) return false;

  if (stop.isGhostPoint || stop.isGhost || stop.sourceType === 'ghost') {
    return true;
  }

  // Kompatibilität: ältere Daten mit freien Standardnamen als Ghost behandeln.
  const isLegacyFreeGhost =
    stop.sourceType === 'free' &&
    /^Freie Haltestelle\s+\d+$/i.test(String(stop.name || ''));

  return isLegacyFreeGhost;
}

function getVisibleStops(stops) {
  const list = Array.isArray(stops) ? stops : [];
  if (getGhostStopsVisible()) return list;
  return list.filter(stop => !isGhostStop(stop));
}

function getGhostStopsVisible() {
  return localStorage.getItem(GHOST_STOPS_VISIBLE_KEY) === '1';
}

function setGhostStopsVisible(value) {
  localStorage.setItem(GHOST_STOPS_VISIBLE_KEY, value ? '1' : '0');
}

function getPunctualityEnabled() {
  const raw = localStorage.getItem(PUNCTUALITY_ENABLED_KEY);
  if (raw === null) return false;
  return raw === '1';
}

function getAppLineDescription(lineData, catalogLine = null) {
  return String(
    lineData?.description ||
    lineData?.line?.description ||
    catalogLine?.description ||
    ''
  ).trim();
}

function getAppValidity(lineData, catalogLine = null) {
  return {
    validFrom: String(lineData?.validFrom || lineData?.line?.validFrom || catalogLine?.validFrom || '').trim(),
    validUntil: String(lineData?.validUntil || lineData?.line?.validUntil || catalogLine?.validUntil || '').trim()
  };
}

function formatAppValidity(lineData, catalogLine = null) {
  const formatDate = value => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
  };
  const validity = getAppValidity(lineData, catalogLine);
  const from = formatDate(validity.validFrom);
  const until = formatDate(validity.validUntil);
  if (from && until) return `Gültig: ${from} bis ${until}`;
  if (from) return `Gültig ab: ${from}`;
  if (until) return `Gültig bis: ${until}`;
  return 'Immer gültig';
}

function getAppVariantCategory(lineData, catalogLine = null) {
  return String(
    lineData?.variantCategory ||
    lineData?.line?.variantCategory ||
    catalogLine?.variantCategory ||
    'Standard'
  ).trim() || 'Standard';
}

function getAppVariantName(lineData, catalogLine = null) {
  const explicit = String(
    lineData?.variantName ||
    lineData?.line?.variantName ||
    catalogLine?.variantName ||
    ''
  ).trim();
  if (explicit) return explicit;

  const routeName = String(lineData?.routeName || lineData?.line?.routeName || catalogLine?.routeName || '').trim();
  const directionName = String(lineData?.directionName || lineData?.line?.directionName || catalogLine?.directionName || '').trim();
  return [routeName, directionName].filter(Boolean).join(' - ') || 'Standard';
}

function setPunctualityEnabled(value) {
  localStorage.setItem(PUNCTUALITY_ENABLED_KEY, value ? '1' : '0');
}

function applyPunctualityToggleToUi(value) {
  if (punctualityToggle) punctualityToggle.checked = !!value;
  if (navPunctualityToggle) navPunctualityToggle.checked = !!value;
}

function formatTimeInputValue(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getPunctualityDepartureTime() {
  const stored = localStorage.getItem(PUNCTUALITY_DEPARTURE_TIME_KEY);
  if (parseTimeToMinutes(stored) !== null) return stored;

  const current = formatTimeInputValue();
  localStorage.setItem(PUNCTUALITY_DEPARTURE_TIME_KEY, current);
  return current;
}

function setPunctualityDepartureTime(value) {
  if (parseTimeToMinutes(value) === null) {
    localStorage.removeItem(PUNCTUALITY_DEPARTURE_TIME_KEY);
    navScheduleAnchorMs = null;
    return;
  }
  localStorage.setItem(PUNCTUALITY_DEPARTURE_TIME_KEY, value);
  navScheduleAnchorMs = resolveManualScheduleAnchorMs(value);
}

function applyPunctualityDepartureTimeToUi(value) {
  if (punctualityDepartureTimeInput) punctualityDepartureTimeInput.value = value || '';
  if (navPunctualityDepartureTimeInput) navPunctualityDepartureTimeInput.value = value || '';
}

function parseTimeToMinutes(timeText) {
  const raw = String(timeText || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function resolveManualScheduleAnchorMs(timeText = getPunctualityDepartureTime()) {
  const timeMinutes = parseTimeToMinutes(timeText);
  if (timeMinutes === null) return null;

  const now = new Date();
  const dayCandidates = [-1, 0, 1].map(offset => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    d.setMinutes(timeMinutes);
    return d.getTime();
  });

  let best = dayCandidates[0];
  let bestGap = Math.abs(dayCandidates[0] - now.getTime());
  for (let i = 1; i < dayCandidates.length; i++) {
    const gap = Math.abs(dayCandidates[i] - now.getTime());
    if (gap < bestGap) {
      best = dayCandidates[i];
      bestGap = gap;
    }
  }

  return best;
}

function formatPunctuality(deltaMinutes) {
  if (!Number.isFinite(deltaMinutes)) return '–';
  if (Math.abs(deltaMinutes) <= 0) return 'pünktlich';
  if (deltaMinutes > 0) return `${deltaMinutes} min zu spät`;
  return `${Math.abs(deltaMinutes)} min zu früh`;
}

function computeNextStopDelayMinutes(nextStop) {
  if (!nextStop || !nextStop.stop) return null;
  if (!Number.isFinite(navScheduleAnchorMs)) return null;

  const planMinute = Number(nextStop.stop.minuteFromStart || 0);
  const expectedMs = navScheduleAnchorMs + (planMinute * 60000);
  return Math.round((Date.now() - expectedMs) / 60000);
}

function rerenderCurrentRouteWithGhostSetting() {
  if (!currentRoute || !currentRoute.data) return;

  displayRoute(currentRoute.data);

  if (navActive && currentRoute.data.routePoints && currentRoute.data.routePoints.length) {
    const navStops = getVisibleStops(currentRoute.data.stops || []);
    navStopDists = buildNavStopDists(navStops, currentRoute.data.routePoints, navCumDists);

    if (currentNavLine) {
      currentNavLine.stops = navStops;
    }
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
    const tx = requireDB().transaction('linesData', 'readonly');
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
    for (const line of allLines) {
      const catalogLine = (availableLinesCatalog || []).find(item => buildLineStorageId(item) === line.id) || null;
      const lineData = line.data || {};
      const lineName = lineData.lineName || lineData?.line?.lineName || catalogLine?.lineName || line.id;
      const routeName = lineData.routeName || lineData?.line?.routeName || catalogLine?.routeName || 'Route';
      const variantName = getAppVariantName(lineData, catalogLine);
      const variantCategory = getAppVariantCategory(lineData, catalogLine);
      const description = getAppLineDescription(lineData, catalogLine);
      const validityText = formatAppValidity(lineData, catalogLine);

      const div = document.createElement('div');
      div.style.cssText = `
        padding: 10px 12px;
        background: var(--surface2);
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 8px;
      `;

      const icon = document.createElement('span');
      icon.style.fontSize = '18px';
      icon.textContent = '✅';

      const textWrap = document.createElement('div');
      textWrap.style.flex = '1';
      textWrap.innerHTML = `
        <div style="font-weight: 600; font-size: 14px;">${lineName}</div>
        <div style="font-size: 12px; color: var(--text-muted);">${variantCategory} -> ${variantName}</div>
      `;
      if (description) {
        const descriptionEl = document.createElement('div');
        descriptionEl.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:3px;line-height:1.35;';
        descriptionEl.textContent = `Bemerkung: ${description}`;
        textWrap.appendChild(descriptionEl);
      }
      if (validityText) {
        const validityEl = document.createElement('div');
        validityEl.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:3px;font-weight:600;';
        validityEl.textContent = validityText;
        textWrap.appendChild(validityEl);
      }

      div.appendChild(icon);
      div.appendChild(textWrap);

      if (catalogLine?.hasPdf) {
        const pdfRecord = await dbGetLinePDFRecord(line.id);
        const pdfBtn = document.createElement('button');
        pdfBtn.type = 'button';
        pdfBtn.textContent = pdfRecord ? 'PDF öffnen' : 'PDF laden';
        pdfBtn.style.cssText = `
          padding: 6px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface);
          color: var(--text);
          font-size: 12px;
          cursor: pointer;
        `;
        pdfBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await openLineOverviewPdf(line.id, catalogLine);
        });
        div.appendChild(pdfBtn);
      }
      
      availableLinesContainer.appendChild(div);
    }
  } catch (err) {
    console.error('Error displaying available lines:', err);
    availableLinesContainer.innerHTML = '<p class="hint">Fehler beim Laden der Linien.</p>';
  }
}

async function openLineOverviewPdf(storageId, catalogLine = null) {
  if (!storageId) return;

  try {
    let pdfRecord = await dbGetLinePDFRecord(storageId);

    if (!pdfRecord && catalogLine?.hasPdf) {
      const fetched = await fetchAndCacheLinePdf(catalogLine, storageId);
      if (fetched) {
        pdfRecord = await dbGetLinePDFRecord(storageId);
      }
    }

    if (!pdfRecord || !pdfRecord.data) {
      showToast('Kein Linien-PDF verfügbar.', 3500);
      return;
    }

    const fileName = pdfRecord.fileName || `${storageId}.pdf`;
    const blob = new Blob([pdfRecord.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('PDF open/download failed:', err);
    showToast('PDF konnte nicht geöffnet werden.', 3500);
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
async function onTilesFileSelected() {
  const file = tilesFileInput.files[0];
  if (!file) return;
  const installed = await installOfflineMapFile(file);
  if (installed) await requestPersistentStorage(true);
}

function renderStoragePersistenceStatus(state) {
  if (storagePersistenceStatus) {
    if (state === 'protected') {
      storagePersistenceStatus.textContent = 'Speicher dauerhaft geschützt';
    } else if (state === 'unsupported') {
      storagePersistenceStatus.textContent = 'Persistenz wird vom Browser nicht unterstützt';
    } else if (state === 'requesting') {
      storagePersistenceStatus.textContent = 'Dauerhafter Speicherschutz wird angefragt …';
    } else {
      storagePersistenceStatus.textContent = 'Speicher nicht dauerhaft geschützt · Browser kann Offline-Daten bei Speicherdruck entfernen';
    }
  }
  if (requestStoragePersistenceBtn) {
    const canRequest = state === 'unprotected';
    requestStoragePersistenceBtn.classList.toggle('hidden', !canRequest);
    requestStoragePersistenceBtn.disabled = state === 'requesting';
  }
}

async function refreshStoragePersistenceStatus() {
  if (!navigator.storage || typeof navigator.storage.persisted !== 'function') {
    renderStoragePersistenceStatus('unsupported');
    return { supported: false, persisted: false };
  }
  try {
    const persisted = await navigator.storage.persisted();
    if (persisted) {
      renderStoragePersistenceStatus('protected');
      return { supported: true, persisted: true };
    }
    if (typeof navigator.storage.persist !== 'function') {
      renderStoragePersistenceStatus('unsupported');
      return { supported: false, persisted: false };
    }
    renderStoragePersistenceStatus('unprotected');
    return { supported: true, persisted: false };
  } catch (err) {
    console.warn('Persistenzstatus konnte nicht gelesen werden:', err);
    renderStoragePersistenceStatus('unsupported');
    return { supported: false, persisted: false };
  }
}

async function requestPersistentStorage(automatic) {
  const current = await refreshStoragePersistenceStatus();
  if (!current.supported || current.persisted) return current.persisted;
  if (automatic) {
    try {
      if (sessionStorage.getItem(STORAGE_PERSIST_ATTEMPTED_KEY) === '1') return false;
      sessionStorage.setItem(STORAGE_PERSIST_ATTEMPTED_KEY, '1');
    } catch {
      // Ohne Session-Speicher bleibt der Versuch an den erfolgreichen Import gebunden.
    }
  }

  renderStoragePersistenceStatus('requesting');
  try {
    const granted = await navigator.storage.persist();
    renderStoragePersistenceStatus(granted ? 'protected' : 'unprotected');
    return !!granted;
  } catch (err) {
    console.warn('Dauerhafter Speicherschutz wurde nicht gewährt:', err);
    renderStoragePersistenceStatus('unprotected');
    return false;
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
  if (typeof refreshMapViewport === 'function') {
    setTimeout(() => refreshMapViewport(), 0);
  }
}

// ── Einstellungen ─────────────────────────────────────────────
function openSettings() {
  if (showGhostStopsToggle) {
    showGhostStopsToggle.checked = getGhostStopsVisible();
  }
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

function initMap2DMode() {
  if (!map2dToggleBtn) return;

  let enabled = false;
  try {
    enabled = localStorage.getItem(MAP_2D_MODE_KEY) === '1';
  } catch {
    enabled = false;
  }

  const applyMode = nextEnabled => {
    enabled = !!nextEnabled;
    map2dToggleBtn.classList.toggle('is-active', enabled);
    map2dToggleBtn.setAttribute('aria-pressed', String(enabled));
    map2dToggleBtn.title = enabled
      ? '2D-Draufsicht aktiv – klicken für Fahrersicht'
      : '2D-Draufsicht einschalten';
    if (typeof setMap2DMode === 'function') {
      setMap2DMode(enabled);
    }
  };

  applyMode(enabled);
  map2dToggleBtn.addEventListener('click', () => {
    applyMode(!enabled);
    try {
      localStorage.setItem(MAP_2D_MODE_KEY, enabled ? '1' : '0');
    } catch {
      // Der Modus funktioniert weiterhin, auch wenn lokales Speichern blockiert ist.
    }
  });
}

function getCameraProfile() {
  const val = localStorage.getItem(CAMERA_PROFILE_KEY);
  if (val === 'calm' || val === 'dynamic' || val === 'balanced') return val;
  return 'balanced';
}

function getMarkerMotionProfile() {
  const val = localStorage.getItem(MARKER_MOTION_PROFILE_KEY);
  if (val === 'calm' || val === 'direct' || val === 'balanced') return val;
  return 'balanced';
}

function getMarkerTurnProfile() {
  const val = localStorage.getItem(MARKER_TURN_PROFILE_KEY);
  if (val === 'calm' || val === 'direct' || val === 'balanced') return val;
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

function initMarkerSmoothingSelects() {
  if (markerMotionSelect) {
    markerMotionSelect.value = getMarkerMotionProfile();
    markerMotionSelect.addEventListener('change', () => {
      const v = markerMotionSelect.value;
      if (v === 'calm' || v === 'direct' || v === 'balanced') {
        localStorage.setItem(MARKER_MOTION_PROFILE_KEY, v);
      }
    });
  }

  if (markerTurnSelect) {
    markerTurnSelect.value = getMarkerTurnProfile();
    markerTurnSelect.addEventListener('change', () => {
      const v = markerTurnSelect.value;
      if (v === 'calm' || v === 'direct' || v === 'balanced') {
        localStorage.setItem(MARKER_TURN_PROFILE_KEY, v);
      }
    });
  }
}

function initGhostStopsToggle() {
  if (!showGhostStopsToggle) return;

  showGhostStopsToggle.checked = getGhostStopsVisible();
  showGhostStopsToggle.addEventListener('change', () => {
    setGhostStopsVisible(!!showGhostStopsToggle.checked);
    rerenderCurrentRouteWithGhostSetting();
  });
}

function initPunctualityToggle() {
  const enabled = getPunctualityEnabled();
  const departureTime = getPunctualityDepartureTime();
  applyPunctualityToggleToUi(enabled);
  applyPunctualityDepartureTimeToUi(departureTime);

  function onChange(nextValue) {
    setPunctualityEnabled(nextValue);
    applyPunctualityToggleToUi(nextValue);
    navScheduleAnchorMs = nextValue ? resolveManualScheduleAnchorMs() : null;
    if (navActive) {
      updateNavMenuInfo();
    }
  }

  function onDepartureTimeChange(nextValue) {
    setPunctualityDepartureTime(nextValue);
    applyPunctualityDepartureTimeToUi(nextValue);
    if (navActive) {
      updateNavMenuInfo();
    }
  }

  if (punctualityToggle) {
    punctualityToggle.addEventListener('change', () => onChange(!!punctualityToggle.checked));
  }
  if (navPunctualityToggle) {
    navPunctualityToggle.addEventListener('change', () => onChange(!!navPunctualityToggle.checked));
  }
  if (punctualityDepartureTimeInput) {
    punctualityDepartureTimeInput.addEventListener('change', () => onDepartureTimeChange(punctualityDepartureTimeInput.value));
  }
  if (navPunctualityDepartureTimeInput) {
    navPunctualityDepartureTimeInput.addEventListener('change', () => onDepartureTimeChange(navPunctualityDepartureTimeInput.value));
  }
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

function shortestDeltaDeg(fromDeg, toDeg) {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

function navGetRouteHeadingAtIndex(pts, idx) {
  if (!Array.isArray(pts) || pts.length < 2) return null;
  const i = Math.max(0, Math.min(pts.length - 1, Math.floor(idx)));
  const prevIdx = Math.max(0, i - 1);
  const nextIdx = Math.min(pts.length - 1, i + 1);
  if (prevIdx === nextIdx) return null;

  const [latA, lonA] = navGetLatLon(pts[prevIdx]);
  const [latB, lonB] = navGetLatLon(pts[nextIdx]);
  return bearingDeg(latA, lonA, latB, lonB);
}

function navGetStableRouteTangent(pts, idx, routeHeadingDeg) {
  if (!Array.isArray(pts) || pts.length < 2 || !Number.isFinite(routeHeadingDeg)) return null;
  const centerIdx = Math.max(0, Math.min(pts.length - 2, Math.floor(idx)));
  const startIdx = Math.max(0, centerIdx - 1);
  let checkedDistanceM = 0;
  let sinSum = 0;
  let cosSum = 0;

  for (let i = startIdx; i < pts.length - 1 && checkedDistanceM < 32; i++) {
    const [latA, lonA] = navGetLatLon(pts[i]);
    const [latB, lonB] = navGetLatLon(pts[i + 1]);
    const segmentDistanceM = haversineM(latA, lonA, latB, lonB);
    if (segmentDistanceM < 0.5) continue;
    const segmentHeading = bearingDeg(latA, lonA, latB, lonB);
    const distanceWeight = Math.max(0.35, 1 - checkedDistanceM / 48);
    const weight = Math.min(segmentDistanceM, 12) * distanceWeight;
    sinSum += Math.sin(segmentHeading * Math.PI / 180) * weight;
    cosSum += Math.cos(segmentHeading * Math.PI / 180) * weight;
    checkedDistanceM += segmentDistanceM;
  }

  if (checkedDistanceM < 12 || (sinSum === 0 && cosSum === 0)) return null;
  const tangent = (Math.atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
  return Math.abs(shortestDeltaDeg(routeHeadingDeg, tangent)) <= 60 ? tangent : null;
}

function resolveStableNavHeading(sensorHeadingDeg, routeHeadingDeg, speedMps) {
  const hasRoute = Number.isFinite(routeHeadingDeg);
  const hasSensor = Number.isFinite(sensorHeadingDeg);

  if (!hasRoute && !hasSensor) return null;
  if (!hasRoute) return sensorHeadingDeg;
  if (!hasSensor) return routeHeadingDeg;

  const speedKmh = Number.isFinite(speedMps) && speedMps >= 0 ? speedMps * 3.6 : null;
  const delta = Math.abs(shortestDeltaDeg(routeHeadingDeg, sensorHeadingDeg));

  // Besonders an Haltestellen/bei geringer Geschwindigkeit auf Routentangent stabilisieren.
  if (speedKmh != null && speedKmh < 8 && delta > 45) {
    return routeHeadingDeg;
  }

  // Grobe Gegensinn-Ausreißer konsequent verwerfen.
  if (delta > 105) {
    return routeHeadingDeg;
  }

  // Bei mittlerer Abweichung weich in Richtung Route ziehen.
  if (delta > 55) {
    return (routeHeadingDeg + shortestDeltaDeg(routeHeadingDeg, sensorHeadingDeg) * 0.35 + 360) % 360;
  }

  // Eine plausible Routentangente ist nach Kurven stabiler als GPS-Heading-Rauschen.
  return routeHeadingDeg;
}

function resolveRouteMarkerHeading(sensorHeadingDeg, routeHeadingDeg, speedMps) {
  if (!Number.isFinite(routeHeadingDeg)) return sensorHeadingDeg;
  if (!Number.isFinite(sensorHeadingDeg)) return routeHeadingDeg;

  const speedKmh = Number.isFinite(speedMps) && speedMps >= 0 ? speedMps * 3.6 : null;
  const delta = Math.abs(shortestDeltaDeg(routeHeadingDeg, sensorHeadingDeg));

  // Die Segmenttangente bleibt die primäre Markerrichtung. Kleine
  // Sensorabweichungen dürfen sie nur leicht unterstützen.
  if (delta <= 25 && (speedKmh == null || speedKmh >= 3)) {
    return (routeHeadingDeg + shortestDeltaDeg(routeHeadingDeg, sensorHeadingDeg) * 0.15 + 360) % 360;
  }

  return routeHeadingDeg;
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
  initMarkerSmoothingSelects();
  initGhostStopsToggle();
  initPunctualityToggle();
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

  const stops = getVisibleStops(currentRoute.data?.stops || []);
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

async function requestScreenWakeLock() {
  if (!navActive || navPaused || document.visibilityState !== 'visible') return;
  if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
  if (screenWakeLock || screenWakeLockRequestPending) return;

  screenWakeLockRequestPending = true;
  try {
    const wakeLock = await navigator.wakeLock.request('screen');
    if (!navActive || navPaused || document.visibilityState !== 'visible') {
      await wakeLock.release();
      return;
    }
    screenWakeLock = wakeLock;
    wakeLock.addEventListener('release', () => {
      if (screenWakeLock === wakeLock) screenWakeLock = null;
    });
  } catch (_err) {
    screenWakeLock = null;
  } finally {
    screenWakeLockRequestPending = false;
  }
}

async function releaseScreenWakeLock() {
  const wakeLock = screenWakeLock;
  screenWakeLock = null;
  if (!wakeLock || wakeLock.released) return;
  try {
    await wakeLock.release();
  } catch (_err) {
    // Wake Lock may already have been released by the browser.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navActive && !navPaused) {
    requestScreenWakeLock();
  }
});

function startNavigation(options = {}) {
  const useSimulation = options && options.useSimulation === true;
  const startAtCurrentPosition = options && options.startAtCurrentPosition === true;

  if (!currentRoute?.data?.routePoints?.length) {
    showToast('Bitte zuerst eine Linie laden.');
    return;
  }

  const pts    = currentRoute.data.routePoints;
  const navStops = getVisibleStops(currentRoute.data.stops || []);
  navCumDists  = buildNavCumDists(pts);
  navTurns     = detectNavTurns(pts, navCumDists);
  navStopDists = buildNavStopDists(navStops, pts, navCumDists);
  const startIdx = startAtCurrentPosition && gpsLastSmoothedPos
    ? findNearestNavIdx(gpsLastSmoothedPos.lat, gpsLastSmoothedPos.lon, pts, 0)
    : 0;

  navActive   = true;
  navFirstFix = false;
  navNearestIdx = startIdx;
  navOffRouteActive = false;
  navRejoinBlend = 0;
  navProgressIdx = 0;
  navDestinationHitCount = 0;
  navStartTime = Date.now();
  navScheduleAnchorMs = getPunctualityEnabled() ? resolveManualScheduleAnchorMs() : null;
  currentNavLine = {
    ...currentRoute.data,
    points: currentRoute.data.routePoints || [],
    stops: navStops
  };
  navInputMode = useSimulation ? 'sim' : 'gps';
  navPaused = false;
  navPauseInputBlockedUntil = Date.now() + 900;
  resetNavPerfStats(navInputMode);
  startNavDriveLogSession('nav-start');
  renderNavPauseUi();

  navHud.classList.remove('hidden');
  document.body.classList.add('nav-mode');
  if (lineStartMenu) lineStartMenu.classList.add('hidden');
  document.body.classList.remove('panel-is-open');
  panel.classList.remove('panel-open');
  panel.classList.add('panel-collapsed');
  if (typeof refreshMapViewport === 'function') {
    setTimeout(() => refreshMapViewport(), 0);
  }
  navBtn.textContent = '■';
  navBtn.title       = 'Navigation beenden';
  navBtn.classList.add('nav-active');
  requestScreenWakeLock();

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
  if (navDestinationNameEl && navStops.length) {
    const lastStop = navStops[navStops.length - 1];
    navDestinationNameEl.textContent = lastStop.name || 'Zielstation';
    
    // Calculate distance to last stop
    if (navCumDists && navCumDists.length > 0) {
      const totalDist = navCumDists[navCumDists.length - 1];
      navDestinationDistEl.textContent = navFormatDist(totalDist);
    } else {
      navDestinationDistEl.textContent = '–';
    }
    console.log('🎯 Destination set to:', navDestinationNameEl.textContent);
  } else if (navDestinationNameEl) {
    navDestinationNameEl.textContent = 'Endstation';
    if (navDestinationDistEl) {
      navDestinationDistEl.textContent = '–';
    }
  }

  // Initial-Anzeige: erste Abbiegung und erste Haltestelle
  if (navTurns.length) {
    const info = getTurnInfo(navTurns[0].angle, navTurns[0].type);
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
    if (navPaused) return;
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
      if (navPaused) return;

      const { latitude: lat, longitude: lon, speed, heading } = pos.coords;
      gpsActive = true;
      gpsBtn.style.color = '#4a9eff';

      // GPS-Daten glätten (exponentieller Durchschnitt reduziert Ruckeln)
      const smoothed = smoothGPSPosition(lat, lon, speed);

      const pts = currentRoute.data.routePoints;
      const tracked = resolveNavTrackPoint(smoothed.lat, smoothed.lon, pts);
      const sensorHeading = smoothHeading(heading);
      const routeHeading = navGetRouteHeadingAtIndex(pts, tracked.index);
      const stableRouteTangent = tracked.snapApplied
        ? navGetStableRouteTangent(pts, tracked.index, tracked.routeHeading)
        : null;
      const hasStableRouteTangent = Number.isFinite(stableRouteTangent);
      const navHeading = hasStableRouteTangent
        ? stableRouteTangent
        : resolveStableNavHeading(sensorHeading, routeHeading, smoothed.speed);
      const markerHeading = hasStableRouteTangent
        ? stableRouteTangent
        : (tracked.snapApplied
          ? resolveRouteMarkerHeading(sensorHeading, tracked.routeHeading, smoothed.speed)
          : navHeading);

      recordNavDriveSample(smoothed.lat, smoothed.lon, tracked, smoothed.speed, heading);

      // Marker und Kamera immer auf denselben (gesnappten) Trackpunkt setzen,
      // damit der Pfeil nicht von der Route wegdriftet.
      setSimulatedGPS(
        tracked.lon,
        tracked.lat,
        markerHeading,
        smoothed.speed,
        hasStableRouteTangent,
        pts,
        navCumDists,
        tracked.routeProgressM,
        tracked.routeState === 'OFF'
      );
      navCenterOn(tracked.lon, tracked.lat, navHeading, smoothed.speed, hasStableRouteTangent);
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
  releaseScreenWakeLock();
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
  navDestinationHitCount = 0;
  navStartTime = 0;
  navPaused = false;
  renderNavPauseUi();
  currentNavLine = null;
  navInputMode = 'gps';
  if (typeof refreshMapViewport === 'function') {
    setTimeout(() => refreshMapViewport(), 0);
  }
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
    const lineId = `${currentRoute.city}_${currentRoute.lineFolder || ''}_${currentRoute.categoryFolder || ''}_${currentRoute.fileBase}`.replace(/\//g, '_');
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

function detectNavRoundabouts(pts, cumDists) {
  const sampleStepM = 6;
  const anchors = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    if ((cumDists[i] - cumDists[anchors[anchors.length - 1]]) >= sampleStepM) {
      anchors.push(i);
    }
  }
  if (anchors[anchors.length - 1] !== pts.length - 1) anchors.push(pts.length - 1);
  if (anchors.length < 6) return [];

  const headings = [];
  for (let i = 1; i < anchors.length; i++) {
    const [latA, lonA] = navGetLatLon(pts[anchors[i - 1]]);
    const [latB, lonB] = navGetLatLon(pts[anchors[i]]);
    headings.push(bearingDeg(latA, lonA, latB, lonB));
  }

  const deltas = [];
  for (let i = 1; i < headings.length; i++) {
    deltas.push(((headings[i] - headings[i - 1] + 540) % 360) - 180);
  }

  const ranges = [];
  for (let start = 0; start < deltas.length; start++) {
    if (Math.abs(deltas[start]) < 2.5 || Math.abs(deltas[start]) > 60) continue;

    const sign = Math.sign(deltas[start]);
    let end = start;
    let signedTurn = 0;
    let totalTurn = 0;
    let meaningfulTurns = 0;
    let weakSamples = 0;

    while (end < deltas.length) {
      const delta = deltas[end];
      const absDelta = Math.abs(delta);
      if (absDelta > 60 || (absDelta >= 5 && Math.sign(delta) !== sign)) break;
      if (absDelta < 2.5) {
        weakSamples++;
        if (weakSamples > 3) break;
      } else {
        weakSamples = 0;
        meaningfulTurns++;
        signedTurn += Math.sign(delta) === sign ? delta : 0;
        totalTurn += absDelta;
      }
      end++;
    }

    const firstAnchor = anchors[start];
    const lastAnchor = anchors[Math.min(anchors.length - 1, end + 1)];
    const arcLengthM = cumDists[lastAnchor] - cumDists[firstAnchor];
    const [startLat, startLon] = navGetLatLon(pts[firstAnchor]);
    const [endLat, endLon] = navGetLatLon(pts[lastAnchor]);
    const chordM = haversineM(startLat, startLon, endLat, endLon);
    const turnDeg = Math.abs(signedTurn);
    const estimatedRadiusM = turnDeg > 0 ? arcLengthM / (turnDeg * Math.PI / 180) : Infinity;
    const consistency = totalTurn > 0 ? turnDeg / totalTurn : 0;

    const compactRoundabout = meaningfulTurns >= 4
        && turnDeg >= 80 && turnDeg <= 330
        && arcLengthM >= 20 && arcLengthM <= 130
        && chordM / arcLengthM <= 0.9
        && estimatedRadiusM >= 4 && estimatedRadiusM <= 35
        && consistency >= 0.9;
    const turboRoundabout = meaningfulTurns >= 6
        && turnDeg >= 105 && turnDeg <= 330
        && arcLengthM >= 35 && arcLengthM <= 220
        && chordM / arcLengthM <= 0.82
        && estimatedRadiusM >= 7 && estimatedRadiusM <= 65
        && consistency >= 0.78
        && turnDeg / arcLengthM >= 0.72;

    if (compactRoundabout || turboRoundabout) {
      ranges.push({
        startIndex: firstAnchor,
        endIndex: lastAnchor,
        startDist: cumDists[firstAnchor],
        endDist: cumDists[lastAnchor]
      });
      start = end;
    }
  }
  return ranges;
}

function detectNavTurns(pts, cumDists, minAngle = 28, mergeRadius = 35, lookaroundM = 20) {
  const turns = [];
  for (let i = 1; i < pts.length - 1; i++) {
    let beforeIdx = i - 1;
    let afterIdx = i + 1;

    while (beforeIdx > 0 && (cumDists[i] - cumDists[beforeIdx]) < lookaroundM) {
      beforeIdx--;
    }
    while (afterIdx < pts.length - 1 && (cumDists[afterIdx] - cumDists[i]) < lookaroundM) {
      afterIdx++;
    }

    if (
      (cumDists[i] - cumDists[beforeIdx]) < lookaroundM ||
      (cumDists[afterIdx] - cumDists[i]) < lookaroundM
    ) continue;

    const [la0, lo0] = navGetLatLon(pts[beforeIdx]);
    const [la1, lo1] = navGetLatLon(pts[i]);
    const [la2, lo2] = navGetLatLon(pts[afterIdx]);
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
  const roundabouts = detectNavRoundabouts(pts, cumDists);
  if (!roundabouts.length) return turns;

  const filteredTurns = turns.filter(turn => !roundabouts.some(roundabout =>
    turn.distFromStart >= roundabout.startDist && turn.distFromStart <= roundabout.endDist
  ));
  roundabouts.forEach(roundabout => {
    filteredTurns.push({
      index: roundabout.startIndex,
      angle: 0,
      type: 'roundabout',
      distFromStart: roundabout.startDist,
      endDistFromStart: roundabout.endDist
    });
  });
  filteredTurns.sort((a, b) => a.distFromStart - b.distFromStart);
  return filteredTurns;
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
        index: Math.min(pts.length - 1, i + (t >= 0.5 ? 1 : 0)),
        routeHeading: bearingDeg(aLat, aLon, bLat, bLon),
        routeProgressM: Number.isFinite(navCumDists[i]) && Number.isFinite(navCumDists[i + 1])
          ? lerpValue(navCumDists[i], navCumDists[i + 1], t)
          : null
      };
    }
  }

  if (!best) {
    const [nLat, nLon] = navGetLatLon(pts[nearestIdx]);
    return {
      lat: nLat,
      lon: nLon,
      index: nearestIdx,
      routeHeading: navGetRouteHeadingAtIndex(pts, nearestIdx),
      routeProgressM: Number.isFinite(navCumDists[nearestIdx]) ? navCumDists[nearestIdx] : null,
      distanceM: haversineM(lat, lon, nLat, nLon),
      applied: false
    };
  }

  const distanceM = Math.sqrt(best.dist2);
  return {
    lat: best.lat,
    lon: best.lon,
    index: best.index,
    routeHeading: best.routeHeading,
    routeProgressM: best.routeProgressM,
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
      routeHeading: navGetRouteHeadingAtIndex(pts, navNearestIdx),
      routeProgressM: Number.isFinite(navCumDists[navNearestIdx]) ? navCumDists[navNearestIdx] : null,
      routeState: navOffRouteActive ? 'OFF' : 'ON',
      snapDistanceM: null,
      snapApplied: false
    };
  }

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
    // Beim Rejoin direkt wieder auf die Route klemmen, statt seitlich einzublenden.
    navOffRouteActive = false;
    navRejoinBlend = 0;
    displayLat = snap.lat;
    displayLon = snap.lon;
    snapAppliedNow = true;
  } else {
    navRejoinBlend = 0;
  }

  const routeState = navOffRouteActive
    ? (navRejoinBlend > 0 ? 'REJOIN' : 'OFF')
    : 'ON';

  let reportedIdx = navNearestIdx;
  if (snapAppliedNow || !navOffRouteActive) {
    reportedIdx = snap.index;
    navNearestIdx = snap.index;
    navProgressIdx = Math.max(navProgressIdx, snap.index);
  }

  noteNavRouteState(routeState, navRejoinBlend);
  noteNavSnap(snap.distanceM, snapAppliedNow);

  return {
    lat: displayLat,
    lon: displayLon,
    index: reportedIdx,
    routeHeading: snap.routeHeading,
    routeProgressM: snap.routeProgressM,
    routeState,
    snapDistanceM: snap.distanceM,
    snapApplied: snapAppliedNow
  };
}

function getTurnInfo(angle, type = null) {
  if (type === 'roundabout') {
    return { iconKey: 'straight', label: 'Kreisverkehr – Ausfahrt folgen' };
  }
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

function getTurnPassBufferMeters(turnIdx) {
  const currentTurn = navTurns[turnIdx];
  const nextTurn = navTurns[turnIdx + 1];
  if (!currentTurn || !nextTurn) return NAV_TURN_DEFAULT_PASS_BUFFER_M;

  const gap = nextTurn.distFromStart - currentTurn.distFromStart;
  if (!Number.isFinite(gap) || gap > NAV_TURN_CLOSE_GAP_M) return NAV_TURN_DEFAULT_PASS_BUFFER_M;

  return Math.max(NAV_TURN_MIN_PASS_BUFFER_M, Math.min(14, gap * 0.28));
}

function resolveActiveTurn(currentDist) {
  for (let i = 0; i < navTurns.length; i++) {
    const turn = navTurns[i];
    const passBuffer = getTurnPassBufferMeters(i);
    const passDist = turn.type === 'roundabout' && Number.isFinite(turn.endDistFromStart)
      ? turn.endDistFromStart
      : turn.distFromStart;
    if (currentDist <= passDist + passBuffer) {
      return { turn, idx: i };
    }
  }
  return null;
}

function findForwardRejoinTarget(lat, lon) {
  const pts = currentNavLine && Array.isArray(currentNavLine.points) ? currentNavLine.points : null;
  if (!pts || !pts.length || !Array.isArray(navCumDists) || !navCumDists.length) return null;

  const startIdx = Math.max(0, Math.min(pts.length - 1, navProgressIdx));
  const startDist = navCumDists[startIdx];
  if (!Number.isFinite(startDist)) return null;

  const maxDist = startDist + NAV_REJOIN_LOOKAHEAD_M;
  let best = null;

  for (let i = startIdx; i < pts.length; i++) {
    const routeDist = navCumDists[i];
    if (!Number.isFinite(routeDist)) continue;
    if (routeDist > maxDist) break;

    const [ptLat, ptLon] = navGetLatLon(pts[i]);
    if (!Number.isFinite(ptLat) || !Number.isFinite(ptLon)) continue;

    const distanceM = haversineM(lat, lon, ptLat, ptLon);
    if (!best || distanceM < best.distanceM) {
      best = { index: i, lat: ptLat, lon: ptLon, distanceM };
    }
  }

  return best;
}

function updateNavHud(lat, lon, forcedIdx = null) {
  if (!navActive || !currentRoute) return;
  const perfT0 = navPerfDebugEnabled ? performance.now() : 0;
  const pts         = currentRoute.data.routePoints;
  const idx = Number.isFinite(forcedIdx)
    ? Math.max(0, Math.min(pts.length - 1, Math.floor(forcedIdx)))
    : findNearestNavIdx(lat, lon, pts, navNearestIdx);

  // Kurzzeitige Rueckspruenge durch GPS-Jitter unterdruecken, ohne echte Kehrtwenden zu blockieren.
  const stableIdx = idx < (navProgressIdx - NAV_INDEX_BACKTRACK_TOLERANCE)
    ? navProgressIdx
    : Math.max(navProgressIdx, idx);

  navNearestIdx = stableIdx;
  navProgressIdx = stableIdx;
  const currentDist = navCumDists[stableIdx];

  // Aktive Abbiegung erst wechseln, wenn aktuelle Kurve sicher passiert wurde.
  // Bei engen Doppelkurven wird der Wechsel trotzdem früh genug freigegeben.
  const activeTurnData = resolveActiveTurn(currentDist);
  const rejoinTarget = navOffRouteActive && navInputMode === 'gps'
    ? findForwardRejoinTarget(lat, lon)
    : null;

  if (rejoinTarget) {
    setNavArrowIcon('straight');
    if (navDistEl) navDistEl.textContent = navFormatDist(rejoinTarget.distanceM);
    if (navLabelEl) navLabelEl.textContent = 'Zur Route zurueck';
  } else if (activeTurnData) {
    const { turn } = activeTurnData;
    const info = getTurnInfo(turn.angle, turn.type);
    const distToTurnM = turn.distFromStart - currentDist;
    setNavArrowIcon(info.iconKey);
    if (distToTurnM > NAV_TURN_NOW_WINDOW_M) {
      navDistEl.textContent = `in ${navFormatDist(distToTurnM)}`;
    } else {
      navDistEl.textContent = 'jetzt';
    }
    navLabelEl.textContent = info.label;
  } else {
    setNavArrowIcon('finish');
    navDistEl.textContent  = 'Zieleinfahrt';
    navLabelEl.textContent = 'Ankommen';
  }

  // Nächste Haltestelle
  const nextStop = navStopDists.find(s => s.distFromStart > currentDist + 10);
  if (nextStop) {
    navStopNameEl.textContent = nextStop.stop.name;
    const baseDistText = navFormatDist(nextStop.distFromStart - currentDist);
    if (getPunctualityEnabled()) {
      const delta = computeNextStopDelayMinutes(nextStop);
      if (Number.isFinite(delta)) {
        navStopDistEl.textContent = `${baseDistText} · ${formatPunctuality(delta)}`;
      } else {
        navStopDistEl.textContent = baseDistText;
      }
    } else {
      navStopDistEl.textContent = baseDistText;
    }
  } else {
    const visibleStops = getVisibleStops(currentRoute.data.stops || []);
    navStopNameEl.textContent = (visibleStops.length
      ? visibleStops[visibleStops.length - 1].name
      : null) || 'Endstation';
    navStopDistEl.textContent = 'Ziel';
  }

  renderUpcomingStops(currentDist);

  if (checkNavDestinationReached(currentDist, lat, lon)) {
    if (typeof showToast === 'function') {
      showToast('Endhaltestelle erreicht. Navigation beendet.', 2500);
    }
    stopNavigation();
    return;
  }

  if (navPerfDebugEnabled) {
    noteNavPerfTick(performance.now() - perfT0);
  }
}

function checkNavDestinationReached(currentDist, lat, lon) {
  if (!navActive || navInputMode !== 'gps' || navOffRouteActive) {
    navDestinationHitCount = 0;
    return false;
  }

  if (!Number.isFinite(currentDist) || !Array.isArray(navStopDists) || !navStopDists.length) {
    navDestinationHitCount = 0;
    return false;
  }

  const lastStopInfo = navStopDists[navStopDists.length - 1];
  const lastStop = lastStopInfo && lastStopInfo.stop;
  const stopLat = Number(lastStop && lastStop.lat);
  const stopLon = Number(lastStop && lastStop.lon);

  if (!lastStopInfo || !Number.isFinite(lastStopInfo.distFromStart) || !Number.isFinite(stopLat) || !Number.isFinite(stopLon)) {
    navDestinationHitCount = 0;
    return false;
  }

  const routeEndDist = navCumDists[navCumDists.length - 1];
  const lastRouteIdx = navCumDists.length - 1;
  if (!Number.isFinite(routeEndDist) || navProgressIdx < Math.max(0, lastRouteIdx - NAV_SNAP_WINDOW)) {
    navDestinationHitCount = 0;
    return false;
  }

  const routeRemainingM = Math.max(0, routeEndDist - currentDist);
  const directDistanceM = haversineM(lat, lon, stopLat, stopLon);

  if (routeRemainingM <= 35 && directDistanceM <= 50) {
    navDestinationHitCount += 1;
  } else {
    navDestinationHitCount = 0;
  }

  return navDestinationHitCount >= 3;
}

function renderUpcomingStops(currentDist) {
  if (!navUpcomingStopsEl) return;

  const currentMeters = Number.isFinite(currentDist) ? currentDist : 0;
  const upcoming = (navStopDists || [])
    .filter(item => item && item.stop && item.distFromStart > currentMeters + 10)
    .slice(0, 4);

  if (!upcoming.length) {
    const visibleStops = getVisibleStops(currentRoute?.data?.stops || []);
    const destination = visibleStops.length ? visibleStops[visibleStops.length - 1] : null;
    if (!destination) {
      navUpcomingStopsEl.replaceChildren();
      return;
    }

    const card = document.createElement('div');
    card.className = 'nav-upcoming-item is-destination';

    const type = document.createElement('span');
    type.className = 'nav-upcoming-type';
    type.textContent = 'Ziel';

    const name = document.createElement('span');
    name.className = 'nav-upcoming-name';
    name.textContent = destination.name || 'Endstation';

    const dist = document.createElement('span');
    dist.className = 'nav-upcoming-dist';
    dist.textContent = 'erreicht';

    card.append(type, name, dist);
    navUpcomingStopsEl.replaceChildren(card);
    return;
  }

  const nodes = upcoming.map((item, index) => {
    const card = document.createElement('div');
    card.className = 'nav-upcoming-item';
    if (index === upcoming.length - 1 && item === navStopDists[navStopDists.length - 1]) {
      card.classList.add('is-destination');
    }

    const type = document.createElement('span');
    type.className = 'nav-upcoming-type';
    type.textContent = index === 0 ? 'Nächster Halt' : `Halt ${index + 1}`;

    const name = document.createElement('span');
    name.className = 'nav-upcoming-name';
    name.textContent = item.stop.name || `Haltestelle ${index + 1}`;

    const dist = document.createElement('span');
    dist.className = 'nav-upcoming-dist';
    dist.textContent = navFormatDist(Math.max(0, item.distFromStart - currentMeters));

    card.append(type, name, dist);
    return card;
  });

  navUpcomingStopsEl.replaceChildren(...nodes);
}

// ═════════════════════════════════════════════════════════════
// Navigation Menu Functions
// ═════════════════════════════════════════════════════════════

let navPaused = false;
let navPauseInputBlockedUntil = 0;

function renderNavPauseUi() {
  if (navPauseBtn) {
    navPauseBtn.textContent = navPaused ? '▶ Fortsetzen' : '⏸ Pause';
    navPauseBtn.style.background = navPaused ? 'var(--accent)' : 'var(--primary)';
  }
  if (navPauseCompactBtn) {
    navPauseCompactBtn.textContent = navPaused ? '▶' : '⏸';
    navPauseCompactBtn.style.background = navPaused ? 'var(--accent)' : 'rgba(255,255,255,0.05)';
    navPauseCompactBtn.title = navPaused ? 'Fortsetzen' : 'Pause';
  }
}

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
  const punctualityEl = navInfoPunctualityEl;

  if (!currentNavLine) {
    if (distEl) distEl.textContent = '-- km';
    if (traveledEl) traveledEl.textContent = '0 km';
    if (remainingEl) remainingEl.textContent = '-- km';
    if (timeEl) timeEl.textContent = '0:00';
    if (punctualityEl) punctualityEl.textContent = 'aus';
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
  const currentDist = Number.isFinite(navCumDists[navProgressIdx])
    ? navCumDists[navProgressIdx]
    : traveledDist;

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

  if (punctualityEl) {
    if (!getPunctualityEnabled()) {
      punctualityEl.textContent = 'aus';
    } else {
      const nextStop = navStopDists.find(s => s.distFromStart > currentDist + 10) || null;
      const delta = computeNextStopDelayMinutes(nextStop);
      punctualityEl.textContent = Number.isFinite(delta) ? formatPunctuality(delta) : 'aus';
      punctualityEl.style.color = Number.isFinite(delta)
        ? (delta > 0 ? '#ef4444' : (delta < 0 ? '#f59e0b' : '#22c55e'))
        : 'var(--text-muted)';
    }
  }
}

function updateNavMenuStops() {
  const listEl = document.getElementById('navUpcomingList');
  if (!listEl || !navStopDists || !navStopDists.length || !currentNavLine || !Array.isArray(currentNavLine.points) || !currentNavLine.points.length) {
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

  const stopsWithDists = navStopDists.filter(item => item && item.stop);

  const nodes = stopsWithDists.map(item => {
    const stop = item.stop;
    const card = document.createElement('div');
    card.style.cssText = 'padding: 10px; background: var(--surface2); border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px;';

    const name = document.createElement('div');
    name.style.cssText = 'flex: 1; font-size: 13px; font-weight: 600;';
    name.textContent = stop.name;

    const dist = document.createElement('div');
    dist.style.cssText = 'font-size: 12px; color: var(--accent); font-weight: 500;';
    const remaining = Math.max(0, item.distFromStart - currentDist);
    dist.textContent = navFormatDist(remaining);

    card.appendChild(name);
    card.appendChild(dist);
    return card;
  });

  listEl.replaceChildren(...nodes);
}

function toggleNavPause() {
  if (Date.now() < navPauseInputBlockedUntil) {
    return;
  }

  navPaused = !navPaused;
  renderNavPauseUi();
  if (navPaused) {
    releaseScreenWakeLock();
  } else {
    requestScreenWakeLock();
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
  setSimulatedGPS(
    tracked.lon,
    tracked.lat,
    heading,
    speedMps,
    false,
    pts,
    navCumDists,
    tracked.routeProgressM,
    false
  );
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

    if (navPaused) return;

    simRouteIdx = advanceSimIndex(pts, simRouteIdx, metersPerTick);
    pushSimFrame(simRouteIdx, speedMps);

    if (simRouteIdx >= pts.length - 1) {
      showToast('Simulation beendet.', 2500);
      stopNavigation();
    }
  }, SIM_TICK_MS);
}



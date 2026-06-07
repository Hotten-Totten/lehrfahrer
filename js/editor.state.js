// =========================
// MAP
// =========================

const map = L.map("map", {
  boxZoom: false,
  doubleClickZoom: false,
  zoomAnimation: false,
  fadeAnimation: false,
  markerZoomAnimation: false
}).setView([51.7600, 14.3300], 13);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  subdomains: "abcd",
  keepBuffer: 8,
  updateWhenZooming: false,
  updateWhenIdle: true
}).addTo(map);

// Cluster nur aktivieren, wenn Plugin wirklich geladen ist
const catalogCluster = typeof L.markerClusterGroup === "function"
  ? L.markerClusterGroup({
      chunkedLoading: true,
      disableClusteringAtZoom: 16
    })
  : null;

if (catalogCluster) {
  map.addLayer(catalogCluster);
}

// =========================
// GLOBALS / STATE
// =========================

let mode = "freeStop"; // freeStop | route | select | specialTrack | specialTrackExtend

const state = {
  stops: [],
  routePoints: [],
  simplifiedRoutePoints: [],
  specialTracks: [],
  currentSpecialTrack: null,
  selected: null,
selectedStopIds: new Set(),
visibleCatalogMarkers: new Map(),
  highlightedCatalogMarkerId: null,
  routeMode: "auto",
  selectedRoutePointIds: new Set(),
  groupDragContext: null,
  suppressNextMapClick: false,
  routePointInteractionActive: false,
  previewMode: "original",
  historyUndo: [],
  historyRedo: [],
  boxSelection: {
    active: false,
    start: null,
    end: null
  }
};

let stopIdCounter = 1;
let routePointIdCounter = 1;
let routeLine = null;
let simplifiedPreviewLine = null;

// =========================
// CONSTANTS
// =========================

const DEBUG = true;
const DEBUG_MAX_LINES = 200;

const OSRM_BASE_URL = "https://router.project-osrm.org";
const VALHALLA_BASE_URL = "https://valhalla1.openstreetmap.de";
const CATALOG_MIN_ZOOM = 14;
const CATALOG_MAX_VISIBLE_MARKERS = 250;
const API_BASE = "api";

const API_SAVE_LINE_URL = `${API_BASE}/save_line.php`;
const API_LOAD_LINE_URL = `${API_BASE}/load_line.php`;
const API_LIST_LINES_URL = `${API_BASE}/list_lines.php`;
const API_TOKEN_STORAGE_KEY = "lehrfahrer_api_token";

function getApiToken() {
  try {
    return (localStorage.getItem(API_TOKEN_STORAGE_KEY) || "").trim();
  } catch (_err) {
    return "";
  }
}

function hasApiToken() {
  return getApiToken().length > 0;
}

function setApiToken(token) {
  try {
    const value = String(token || "").trim();
    if (!value) {
      localStorage.removeItem(API_TOKEN_STORAGE_KEY);
      return false;
    }
    localStorage.setItem(API_TOKEN_STORAGE_KEY, value);
    return true;
  } catch (_err) {
    return false;
  }
}

function clearApiToken() {
  try {
    localStorage.removeItem(API_TOKEN_STORAGE_KEY);
    return true;
  } catch (_err) {
    return false;
  }
}

function withApiAuthHeaders(baseHeaders = {}) {
  const headers = { ...baseHeaders };
  const token = getApiToken();
  if (token) {
    headers["X-Api-Token"] = token;
  }
  return headers;
}

const AUTOSAVE_KEY = "linieneditor_autosave_v1";
const AUTOSAVE_INTERVAL_MS = 60000;

// =========================
// DEBUG STATE
// =========================

let debugPanelReady = false;

// =========================
// ICONS
// =========================

function createDivIcon(background, border = "#000", size = 16) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:50%;
        background:${background};
        border:2px solid ${border};
        box-shadow:0 0 0 1px rgba(255,255,255,0.7);
      "></div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function createStopBadgeIcon(background, border = "#000", size = 20, text = "H", arrow = "") {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        position:relative;
        width:${size}px;
        height:${size}px;
        border-radius:50%;
        background:${background};
        border:2px solid ${border};
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:${Math.round(size * 0.6)}px;
        font-weight:bold;
        color:#ffffff;
        box-shadow:0 1px 4px rgba(0,0,0,0.35);
      ">${text}
        ${arrow ? `<span style="position:absolute;right:-3px;top:-5px;width:${Math.max(10, Math.round(size * 0.52))}px;height:${Math.max(10, Math.round(size * 0.52))}px;border-radius:999px;background:#0f172a;border:1px solid rgba(255,255,255,0.95);display:flex;align-items:center;justify-content:center;font-size:${Math.max(8, Math.round(size * 0.42))}px;line-height:1;color:#ffffff;box-shadow:0 1px 2px rgba(0,0,0,0.45);">${arrow}</span>` : ""}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function normalizeTransitTypeForIcon(type) {
  return String(type || "").toLowerCase().trim();
}

function resolveLineStopTransitType(stop) {
  if (!stop || typeof stop !== "object") return "free";

  const directType = normalizeTransitTypeForIcon(stop.transitType || stop.type);
  if (["bus", "tram", "bus_tram", "mixed"].includes(directType)) {
    return directType;
  }

  if (stop.catalogId) {
    const catalogEntry = stopCatalog.find(entry => entry.id === stop.catalogId);
    const catalogType = normalizeTransitTypeForIcon(catalogEntry?.type);
    if (["bus", "tram", "bus_tram", "mixed"].includes(catalogType)) {
      return catalogType;
    }
  }

  return stop.sourceType === "catalog" ? "bus" : "free";
}

function extractStopDirectionText(stop) {
  if (!stop || typeof stop !== "object") return "";

  const direct = [
    stop.directionHint,
    stop.direction,
    stop.towards,
    stop.destination,
    stop.local_ref
  ].find(v => typeof v === "string" && v.trim().length > 0);

  if (direct) return direct.trim();

  if (stop.catalogId) {
    const catalogEntry = stopCatalog.find(entry => entry.id === stop.catalogId);
    const fallback = [
      catalogEntry?.direction,
      catalogEntry?.directionHint,
      catalogEntry?.towards,
      catalogEntry?.destination,
      catalogEntry?.local_ref
    ].find(v => typeof v === "string" && v.trim().length > 0);

    if (fallback) return fallback.trim();
  }

  return "";
}

function normalizeStopNameForDirection(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function approxDistanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111320;
  const meanLat = (lat1 + lat2) * 0.5 * Math.PI / 180;
  const dLon = (lon2 - lon1) * 111320 * Math.cos(meanLat);
  return Math.hypot(dLat, dLon);
}

function inferDirectionArrowFromGeometry(stop) {
  if (!stop || typeof stop !== "object") return "";
  if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return "";

  const nameKey = normalizeStopNameForDirection(stop.name);
  if (!nameKey) return "";

  const poolSource = stop.sourceType === "catalog" ? stopCatalog : state.stops;
  if (!Array.isArray(poolSource) || !poolSource.length) return "";

  const nearSameName = poolSource.filter(s => {
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return false;
    if (normalizeStopNameForDirection(s.name) !== nameKey) return false;
    return approxDistanceMeters(stop.lat, stop.lon, s.lat, s.lon) <= 350;
  });

  if (nearSameName.length < 2) return "";

  let minLat = nearSameName[0].lat;
  let maxLat = nearSameName[0].lat;
  let minLon = nearSameName[0].lon;
  let maxLon = nearSameName[0].lon;

  nearSameName.forEach(s => {
    minLat = Math.min(minLat, s.lat);
    maxLat = Math.max(maxLat, s.lat);
    minLon = Math.min(minLon, s.lon);
    maxLon = Math.max(maxLon, s.lon);
  });

  const latSpanM = approxDistanceMeters(minLat, stop.lon, maxLat, stop.lon);
  const lonSpanM = approxDistanceMeters(stop.lat, minLon, stop.lat, maxLon);
  if (Math.max(latSpanM, lonSpanM) < 14) return "";

  if (latSpanM >= lonSpanM) {
    const midLat = (minLat + maxLat) / 2;
    return stop.lat >= midLat ? "↑" : "↓";
  }

  const midLon = (minLon + maxLon) / 2;
  return stop.lon >= midLon ? "→" : "←";
}

function getDirectionArrow(directionText, stop) {
  const t = String(directionText || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .trim();

  if (!t) return inferDirectionArrowFromGeometry(stop);

  if (/nord\s*ost|northeast|north\s*east|\bne\b/.test(t)) return "↗";
  if (/nord\s*west|northwest|north\s*west|\bnw\b/.test(t)) return "↖";
  if (/sued\s*ost|sud\s*est|southeast|south\s*east|\bse\b/.test(t)) return "↘";
  if (/sued\s*west|southwest|south\s*west|\bsw\b/.test(t)) return "↙";

  if (/stadteinwaerts|einwaerts|hinfahrt|\bhin\b|nord|north|\bn\b/.test(t)) return "↑";
  if (/stadtauswaerts|auswaerts|rueckfahrt|rueck|r\u00fcck|sued|south|\bs\b/.test(t)) return "↓";
  if (/ost|east|\be\b/.test(t)) return "→";
  if (/west|\bw\b/.test(t)) return "←";

  return inferDirectionArrowFromGeometry(stop);
}

function getTransitBadgeStyle(type) {
  if (type === "tram") {
    return { background: "#dc2626", border: "#991b1b", letter: "T" };
  }

  if (type === "bus_tram" || type === "mixed") {
    return { background: "#be185d", border: "#831843", letter: "M" };
  }

  if (type === "bus") {
    return { background: "#7c3aed", border: "#5b21b6", letter: "B" };
  }

  return { background: "#3b82f6", border: "#1d4ed8", letter: "H" };
}

function createTransitStopIcon(stop, size) {
  const type = resolveLineStopTransitType(stop);
  const style = getTransitBadgeStyle(type);
  const arrow = getDirectionArrow(extractStopDirectionText(stop), stop);
  return createStopBadgeIcon(style.background, style.border, size, style.letter, arrow);
}

function getLineStopIcon(stop, selected = false) {
  return createTransitStopIcon(stop, selected ? 22 : 18);
}

function createTextIcon(text, background, border = "#000", size = 18, fontSize = 11) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:50%;
        background:${background};
        border:2px solid ${border};
        box-shadow:0 0 0 1px rgba(255,255,255,0.8);
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:${fontSize}px;
        font-weight:bold;
        color:#111;
        line-height:1;
      ">${text}</div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

const ICONS = {
  // ---------- Katalog ----------
  catalog: createStopBadgeIcon("#7c3aed", "#5b21b6", 20, "B"),
  catalogHighlight: createStopBadgeIcon("#7c3aed", "#4c1d95", 24, "B"),

  catalogBus: createStopBadgeIcon("#7c3aed", "#5b21b6", 20, "B"),
  catalogBusHighlight: createStopBadgeIcon("#7c3aed", "#4c1d95", 24, "B"),

  catalogTram: createStopBadgeIcon("#dc2626", "#991b1b", 20, "T"),
  catalogTramHighlight: createStopBadgeIcon("#dc2626", "#7f1d1d", 24, "T"),

  catalogMixed: createStopBadgeIcon("#be185d", "#831843", 20, "M"),
  catalogMixedHighlight: createStopBadgeIcon("#be185d", "#701a75", 24, "M"),

  // ---------- Linien-Haltestellen ----------
  stop: createDivIcon("#3b82f6", "#1d4ed8", 16),
  stopSelected: createDivIcon("#22c55e", "#15803d", 20),
  stopBus: createStopBadgeIcon("#7c3aed", "#5b21b6", 18, "B"),
  stopBusSelected: createStopBadgeIcon("#7c3aed", "#4c1d95", 22, "B"),
  stopTram: createStopBadgeIcon("#dc2626", "#991b1b", 18, "T"),
  stopTramSelected: createStopBadgeIcon("#dc2626", "#7f1d1d", 22, "T"),
  stopMixed: createStopBadgeIcon("#be185d", "#831843", 18, "M"),
  stopMixedSelected: createStopBadgeIcon("#be185d", "#701a75", 22, "M"),

  // ---------- Routenpunkte ----------
  route: createDivIcon("#f97316", "#7c2d12", 12),
  routeManual: createDivIcon("#f97316", "#7c2d12", 12),
  routeSelected: createDivIcon("#fb923c", "#9a3412", 16),
  routeManualSelected: createDivIcon("#fb923c", "#9a3412", 16),
  routeMulti: createDivIcon("#a855f7", "#6b21a8", 16),
  routeManualMulti: createDivIcon("#a855f7", "#6b21a8", 16)
};
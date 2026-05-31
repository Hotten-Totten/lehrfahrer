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

function createStopBadgeIcon(background, border = "#000", size = 20, text = "H") {
  return L.divIcon({
    className: "",
    html: `
      <div style="
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
      ">${text}</div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
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
  catalog: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  }),

  catalogHighlight: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  }),

  catalogBus: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  }),

  catalogBusHighlight: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  }),

  catalogTram: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  }),

  catalogTramHighlight: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  }),

  catalogMixed: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  }),

  catalogMixedHighlight: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  }),

  // ---------- Linien-Haltestellen ----------
  stop: createDivIcon("#3b82f6", "#1d4ed8", 16),
  stopSelected: createDivIcon("#22c55e", "#15803d", 20),

  // ---------- Routenpunkte ----------
  route: createDivIcon("#f97316", "#7c2d12", 12),
  routeManual: createDivIcon("#f97316", "#7c2d12", 12),
  routeSelected: createDivIcon("#fb923c", "#9a3412", 16),
  routeManualSelected: createDivIcon("#fb923c", "#9a3412", 16),
  routeMulti: createDivIcon("#a855f7", "#6b21a8", 16),
  routeManualMulti: createDivIcon("#a855f7", "#6b21a8", 16)
};
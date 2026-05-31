// =============================
// DEBUG SYSTEM
// =============================

const DEBUG = true;
const DEBUG_MAX_LINES = 200;
let debugPanelReady = false;

function formatDebugPart(part) {
  if (typeof part === "string") return part;

  try {
    return JSON.stringify(part);
  } catch (err) {
    return String(part);
  }
}

function appendDebugLine(level, parts) {
  if (!debugPanelReady || !debugPanelBody) return;

  const line = document.createElement("div");
  line.className = `debug-line ${level}`;

  const time = new Date().toLocaleTimeString("de-DE");
  const text = parts.map(formatDebugPart).join(" ");

  line.textContent = `[${time}] ${text}`;
  debugPanelBody.appendChild(line);

  while (debugPanelBody.children.length > DEBUG_MAX_LINES) {
    debugPanelBody.removeChild(debugPanelBody.firstChild);
  }

  debugPanelBody.scrollTop = debugPanelBody.scrollHeight;
}

function debug(...msg) {
  if (!DEBUG) return;
  console.log("[EDITOR]", ...msg);
  appendDebugLine("info", msg);
}

function warn(...msg) {
  console.warn("[EDITOR]", ...msg);
  appendDebugLine("warn", msg);
}

function error(...msg) {
  console.error("[EDITOR]", ...msg);
  appendDebugLine("error", msg);
}

// =========================
// MAP
// =========================

const map = L.map("map", {
  boxZoom: false
}).setView([51.7600, 14.3300], 13);

L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors"
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

let mode = "catalogStop"; // catalogStop | freeStop | route | select

const state = {
  stops: [],
  routePoints: [],
  simplifiedRoutePoints: [],
  selected: null,
  catalogMarkers: [],
  catalogMarkerMap: new Map(),
  highlightedCatalogMarker: null,
  routeMode: "auto", // auto | manual | street
  selectedRoutePointIds: new Set(),
  groupDragContext: null,
  suppressNextMapClick: false,
  routePointInteractionActive: false,
  previewMode: "original",
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

const OSRM_BASE_URL = "https://router.project-osrm.org";
const CATALOG_MIN_ZOOM = 15;
const API_BASE = "api";

const API_SAVE_LINE_URL = `${API_BASE}/save_line.php`;
const API_LOAD_LINE_URL = `${API_BASE}/load_line.php`;
const API_LIST_LINES_URL = `${API_BASE}/list_lines.php`;

const AUTOSAVE_KEY = "linieneditor_autosave_v1";
const AUTOSAVE_INTERVAL_MS = 10000;

// =========================
// DOM
// =========================

const lineNameInput = document.getElementById("lineName");
const routeNameInput = document.getElementById("routeName");
const directionNameInput = document.getElementById("directionName");
const lineColorInput = document.getElementById("lineColor");

const stopSearchInput = document.getElementById("stopSearchInput");
const searchResults = document.getElementById("searchResults");
const stopOrderList = document.getElementById("stopOrderList");

const modeCatalogStopBtn = document.getElementById("modeCatalogStopBtn");
const modeFreeStopBtn = document.getElementById("modeFreeStopBtn");
const modeRouteBtn = document.getElementById("modeRouteBtn");
const buildStreetRouteBtn = document.getElementById("buildStreetRouteBtn");
const rerouteSegmentBtn = document.getElementById("rerouteSegmentBtn");
const smoothRouteBtn = document.getElementById("smoothRouteBtn");
const snapStopToRouteBtn = document.getElementById("snapStopToRouteBtn");
const simplifyRouteBtn = document.getElementById("simplifyRouteBtn");
const showOriginalRouteBtn = document.getElementById("showOriginalRouteBtn");
const showSimplifiedRouteBtn = document.getElementById("showSimplifiedRouteBtn");
const modeSelectBtn = document.getElementById("modeSelectBtn");

const noSelection = document.getElementById("noSelection");
const stopEditor = document.getElementById("stopEditor");
const routeEditor = document.getElementById("routeEditor");

const stopNameInput = document.getElementById("stopName");
const stopMinuteInput = document.getElementById("stopMinute");
const stopNoteInput = document.getElementById("stopNote");
const stopLatInput = document.getElementById("stopLat");
const stopLonInput = document.getElementById("stopLon");
const stopSourceInput = document.getElementById("stopSource");

const saveStopBtn = document.getElementById("saveStopBtn");
const deleteStopBtn = document.getElementById("deleteStopBtn");

const routeLatInput = document.getElementById("routeLat");
const routeLonInput = document.getElementById("routeLon");
const deleteRoutePointBtn = document.getElementById("deleteRoutePointBtn");

const stopCount = document.getElementById("stopCount");
const routePointCount = document.getElementById("routePointCount");
const catalogCount = document.getElementById("catalogCount");
const currentModeText = document.getElementById("currentModeText");
const statusbar = document.getElementById("statusbar");

const selectionBox = document.getElementById("selectionBox");
const mapWrapElement = document.getElementById("mapWrap");

const debugPanel = document.getElementById("debugPanel");
const debugPanelBody = document.getElementById("debugPanelBody");
const debugToggleBtn = document.getElementById("debugToggleBtn");
const debugClearBtn = document.getElementById("debugClearBtn");

const clearBtn = document.getElementById("clearBtn");
const saveLineBtn = document.getElementById("saveLineBtn");
const loadLineBtn = document.getElementById("loadLineBtn");
const exportBtn = document.getElementById("exportBtn");
const exportAutosaveBtn = document.getElementById("exportAutosaveBtn");
const loadAutosaveBtn = document.getElementById("loadAutosaveBtn");
const clearAutosaveBtn = document.getElementById("clearAutosaveBtn");

const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const helpModalBody = document.getElementById("helpModalBody");
const helpCloseBtn = document.getElementById("helpCloseBtn");

const lineBrowserModal = document.getElementById("lineBrowserModal");
const lineBrowserBody = document.getElementById("lineBrowserBody");
const lineBrowserCloseBtn = document.getElementById("lineBrowserCloseBtn");

// =========================
// Marker-Icons
// =========================

// =========================
// Marker-Icons (Bilder)
// =========================

const ICONS = {
  catalog: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  }),

  catalogHighlight: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  }),

  catalogBus: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  }),

  catalogBusHighlight: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  }),

  catalogTram: L.icon({
    iconUrl: "img/haltestelle-tram.png",
    iconSize: [42, 24],
    iconAnchor: [21, 12]
  }),

  catalogTramHighlight: L.icon({
    iconUrl: "img/haltestelle-tram.png",
    iconSize: [52, 30],
    iconAnchor: [26, 15]
  }),

  catalogMixed: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  }),

  catalogMixedHighlight: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  }),

  // deine bestehenden behalten wir:
  stop: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  }),

  stopSelected: L.icon({
    iconUrl: "img/haltestelle-bus.png",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  }),

  route: L.icon({
    iconUrl: "img/route.png",
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  }),

  routeSelected: L.icon({
    iconUrl: "img/route.png",
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  }),

  routeMulti: L.icon({
    iconUrl: "img/route.png",
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  })
};
/*
const ICONS = {
  catalog: createDivIcon("#9ca3af", "#6b7280", 10),
  catalogHighlight: createDivIcon("#facc15", "#ca8a04", 18),
  stop: createDivIcon("#3b82f6", "#1d4ed8", 16),
  stopSelected: createDivIcon("#22c55e", "#15803d", 20),
  route: createDivIcon("#f97316", "#7c2d12", 12),
  routeSelected: createDivIcon("#fb923c", "#9a3412", 16),
  routeMulti: createDivIcon("#a855f7", "#6b21a8", 16)
};
*/
// =========================
// UI / STATUS / DEBUG
// =========================

function initDebugPanel() {
  debugPanelReady = true;
  debug("Editor Script geladen");
}

function toggleDebugPanel() {
  debugPanel.classList.toggle("hidden");
  debugToggleBtn.textContent = debugPanel.classList.contains("hidden")
    ? "Debug"
    : "Debug an";
}

function clearDebugPanel() {
  debugPanelBody.innerHTML = "";
  debug("Debug-Panel geleert");
}

function setStatus(text, level = "info") {
  statusbar.textContent = text;

  if (level === "warn") {
    warn(text);
  } else if (level === "error") {
    error(text);
  } else {
    debug(text);
  }
}

function updateStats() {
  stopCount.textContent = state.stops.length;
  routePointCount.textContent = state.routePoints.length;
  catalogCount.textContent = stopCatalog.length;

  const modeLabels = {
    catalogStop: "Haltestelle aus Karte",
    freeStop: "Freie Haltestelle",
    route: state.routeMode === "manual" ? "Route zeichnen (manuell)" : "Route zeichnen",
    select: "Auswählen"
  };

  currentModeText.textContent = modeLabels[mode] || mode;
}

function updateModeButtons() {
  modeCatalogStopBtn.classList.toggle("active", mode === "catalogStop");
  modeFreeStopBtn.classList.toggle("active", mode === "freeStop");
  modeRouteBtn.classList.toggle("active", mode === "route");
  modeSelectBtn.classList.toggle("active", mode === "select");
  updateStats();
}

function updatePreviewButtons() {
  showOriginalRouteBtn.classList.toggle("preview-active", state.previewMode === "original");
  showSimplifiedRouteBtn.classList.toggle("preview-active", state.previewMode === "simplified");
}

function setMode(newMode, statusText = "") {
  mode = newMode;
  updateModeButtons();

  if (statusText) {
    setStatus(statusText);
  }
}

// =========================
// HELPERS
// =========================

function suppressMapClickShort() {
  state.suppressNextMapClick = true;
  setTimeout(() => {
    state.suppressNextMapClick = false;
  }, 120);
}

function beginRoutePointInteraction() {
  state.routePointInteractionActive = true;
  suppressMapClickShort();
}

function endRoutePointInteraction() {
  suppressMapClickShort();
  setTimeout(() => {
    state.routePointInteractionActive = false;
  }, 120);
}

function clearRouteMultiSelection() {
  state.selectedRoutePointIds.clear();
  state.groupDragContext = null;
}

function clearRouteSelectionIfDeleted(idsToDelete) {
  if (
    state.selected &&
    state.selected.type === "route" &&
    idsToDelete.has(state.selected.ref.id)
  ) {
    state.selected = null;
  }

  idsToDelete.forEach(id => {
    state.selectedRoutePointIds.delete(id);
  });
}

// =========================
// SELECTION BOX
// =========================

function getSelectionBounds(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y)
  };
}

function showSelectionBox(start, end) {
  const bounds = getSelectionBounds(start, end);

  selectionBox.style.left = bounds.left + "px";
  selectionBox.style.top = bounds.top + "px";
  selectionBox.style.width = Math.max(1, bounds.right - bounds.left) + "px";
  selectionBox.style.height = Math.max(1, bounds.bottom - bounds.top) + "px";
  selectionBox.classList.remove("hidden");
}

function hideSelectionBox() {
  selectionBox.classList.add("hidden");
}

function beginBoxSelection(pointerEvent) {
  const rect = mapWrapElement.getBoundingClientRect();

  const start = {
    x: pointerEvent.clientX - rect.left,
    y: pointerEvent.clientY - rect.top
  };

  state.boxSelection.active = true;
  state.boxSelection.start = start;
  state.boxSelection.end = start;

  map.dragging.disable();
  document.body.style.userSelect = "none";
  document.body.style.webkitUserSelect = "none";

  showSelectionBox(start, start);
}

function updateBoxSelection(pointerEvent) {
  if (!state.boxSelection.active) return;

  const rect = mapWrapElement.getBoundingClientRect();

  const end = {
    x: pointerEvent.clientX - rect.left,
    y: pointerEvent.clientY - rect.top
  };

  state.boxSelection.end = end;
  showSelectionBox(state.boxSelection.start, end);
}

function finishBoxSelection() {
  if (!state.boxSelection.active) return;

  const start = state.boxSelection.start;
  const end = state.boxSelection.end;

  state.boxSelection.active = false;
  hideSelectionBox();

  map.dragging.enable();
  document.body.style.userSelect = "";
  document.body.style.webkitUserSelect = "";

  if (!start || !end) return;

  const bounds = getSelectionBounds(start, end);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;

  if (width < 6 || height < 6) {
    setStatus("Rahmen zu klein für Mehrfachauswahl.");
    state.boxSelection.start = null;
    state.boxSelection.end = null;
    return;
  }

  clearRouteMultiSelection();

  state.routePoints.forEach(point => {
    const p = map.latLngToContainerPoint([point.lat, point.lon]);

    const inside =
      p.x >= bounds.left &&
      p.x <= bounds.right &&
      p.y >= bounds.top &&
      p.y <= bounds.bottom;

    if (inside) {
      state.selectedRoutePointIds.add(point.id);
    }
  });

  applyRoutePointIcons();

  const count = state.selectedRoutePointIds.size;

  debug("Box-Auswahl abgeschlossen", {
    selectedCount: count,
    bounds
  });

  if (count > 0) {
    setStatus(`${count} Routenpunkte per Rahmen ausgewählt.`);
  } else {
    setStatus("Keine Routenpunkte im Rahmen gefunden.");
  }

  state.boxSelection.start = null;
  state.boxSelection.end = null;
}

function cancelBoxSelection() {
  state.boxSelection.active = false;
  state.boxSelection.start = null;
  state.boxSelection.end = null;

  map.dragging.enable();
  document.body.style.userSelect = "";
  document.body.style.webkitUserSelect = "";

  hideSelectionBox();
}

// =========================
// ROUTE GEOMETRY HELPERS
// =========================

function approxDistanceMeters(a, b) {
  const latFactor = 111320;
  const lonFactor = 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);

  const dx = (b.lon - a.lon) * lonFactor;
  const dy = (b.lat - a.lat) * latFactor;

  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistanceMeters(p, a, b) {
  const latFactor = 111320;
  const lonFactor = 111320 * Math.cos(((a.lat + b.lat + p.lat) / 3) * Math.PI / 180);

  const ax = a.lon * lonFactor;
  const ay = a.lat * latFactor;
  const bx = b.lon * lonFactor;
  const by = b.lat * latFactor;
  const px = p.lon * lonFactor;
  const py = p.lat * latFactor;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const abLen2 = abx * abx + aby * aby;
  if (abLen2 === 0) {
    const dx = px - ax;
    const dy = py - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  let t = (apx * abx + apy * aby) / abLen2;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * abx;
  const projY = ay + t * aby;

  const dx = px - projX;
  const dy = py - projY;

  return Math.sqrt(dx * dx + dy * dy);
}

function getPerpendicularDistance(point, lineStart, lineEnd) {
  const x = point.lon;
  const y = point.lat;

  const x1 = lineStart.lon;
  const y1 = lineStart.lat;

  const x2 = lineEnd.lon;
  const y2 = lineEnd.lat;

  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;

  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx;
  let yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = x - xx;
  const dy = y - yy;

  return Math.sqrt(dx * dx + dy * dy);
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let index = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = getPerpendicularDistance(points[i], start, end);

    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }

  if (maxDistance > tolerance) {
    const left = douglasPeucker(points.slice(0, index + 1), tolerance);
    const right = douglasPeucker(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }

  return [start, end];
}

function findClosestPointOnRoute(lat, lon) {
  if (!state.routePoints || state.routePoints.length < 2) {
    return null;
  }

  const clickPoint = map.latLngToContainerPoint([lat, lon]);

  let best = null;
  let bestDistance = Infinity;

  for (let i = 0; i < state.routePoints.length - 1; i++) {
    const a = state.routePoints[i];
    const b = state.routePoints[i + 1];

    const aPt = map.latLngToContainerPoint([a.lat, a.lon]);
    const bPt = map.latLngToContainerPoint([b.lat, b.lon]);

    const dx = bPt.x - aPt.x;
    const dy = bPt.y - aPt.y;
    const len2 = dx * dx + dy * dy;

    if (len2 === 0) continue;

    let t = ((clickPoint.x - aPt.x) * dx + (clickPoint.y - aPt.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const projX = aPt.x + t * dx;
    const projY = aPt.y + t * dy;

    const dist = Math.hypot(clickPoint.x - projX, clickPoint.y - projY);

    if (dist < bestDistance) {
      bestDistance = dist;
      const latlng = map.containerPointToLatLng([projX, projY]);

      best = {
        lat: latlng.lat,
        lon: latlng.lng,
        segmentIndex: i,
        distancePx: dist
      };
    }
  }

  return best;
}

function findClosestSegment(latlng) {
  if (state.routePoints.length < 2) return null;

  let closest = null;
  let minDist = Infinity;

  const p = map.latLngToContainerPoint(latlng);

  for (let i = 0; i < state.routePoints.length - 1; i++) {
    const a = map.latLngToContainerPoint([
      state.routePoints[i].lat,
      state.routePoints[i].lon
    ]);

    const b = map.latLngToContainerPoint([
      state.routePoints[i + 1].lat,
      state.routePoints[i + 1].lon
    ]);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;

    if (length2 === 0) continue;

    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
    t = Math.max(0, Math.min(1, t));

    const projX = a.x + t * dx;
    const projY = a.y + t * dy;

    const dist = Math.hypot(p.x - projX, p.y - projY);

    if (dist < minDist) {
      minDist = dist;
      closest = {
        index: i,
        latlng: map.containerPointToLatLng([projX, projY])
      };
    }
  }

  return closest;
}

// =========================
// RENDER / ICONS
// =========================

function applyRoutePointIcons() {
  state.routePoints.forEach(point => {
    if (
      state.selected &&
      state.selected.type === "route" &&
      state.selected.ref.id === point.id
    ) {
      point.marker.setIcon(ICONS.routeSelected);
      return;
    }

    if (state.selectedRoutePointIds.has(point.id)) {
      point.marker.setIcon(ICONS.routeMulti);
      return;
    }

    point.marker.setIcon(ICONS.route);
  });
}

function clearSelectionStyles() {
  state.stops.forEach(stop => {
    stop.marker.setIcon(ICONS.stop);
  });

  applyRoutePointIcons();
}

function updateStopMarkerTooltip(stop) {
  stop.marker.unbindTooltip();
  stop.marker.bindTooltip(stop.name, {
    permanent: false,
    direction: "top"
  });

  renderStopOrderList();
}

function refreshRouteLine() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  if (simplifiedPreviewLine) {
    map.removeLayer(simplifiedPreviewLine);
    simplifiedPreviewLine = null;
  }

  if (state.routePoints.length >= 2) {
    const originalCoords = state.routePoints.map(point => [point.lat, point.lon]);

    routeLine = L.polyline(originalCoords, {
      color: lineColorInput.value,
      weight: state.previewMode === "original" ? 5 : 3,
      opacity: state.previewMode === "original" ? 1 : 0.35
    }).addTo(map);
  }

  if (state.previewMode === "simplified" && state.simplifiedRoutePoints.length >= 2) {
    const simplifiedCoords = state.simplifiedRoutePoints.map(point => [point.lat, point.lon]);

    simplifiedPreviewLine = L.polyline(simplifiedCoords, {
      color: lineColorInput.value,
      weight: 6,
      opacity: 1
    }).addTo(map);
  }

  updatePreviewButtons();
}

function renderStopOrderList() {
  stopOrderList.innerHTML = "";

  if (!state.stops.length) {
    const empty = document.createElement("div");
    empty.textContent = "Noch keine Haltestellen in der Linie.";
    empty.style.color = "#666";
    empty.style.fontSize = "14px";
    stopOrderList.appendChild(empty);
    return;
  }

  state.stops.forEach((stop, index) => {
    const item = document.createElement("div");
    item.className = "stop-order-item";

    if (state.selected && state.selected.type === "stop" && state.selected.ref.id === stop.id) {
      item.classList.add("active");
    }

    const main = document.createElement("div");
    main.className = "stop-order-main";

    const idx = document.createElement("div");
    idx.className = "stop-order-index";
    idx.textContent = `Position ${index + 1}`;

    const name = document.createElement("div");
    name.className = "stop-order-name";
    name.textContent = stop.name;

    main.appendChild(idx);
    main.appendChild(name);

    main.addEventListener("click", function () {
      selectStop(stop);
      map.setView([stop.lat, stop.lon], 17);
    });

    const actions = document.createElement("div");
    actions.className = "stop-order-actions";

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      moveStopUp(index);
    });

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.disabled = index === state.stops.length - 1;
    downBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      moveStopDown(index);
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);

    item.appendChild(main);
    item.appendChild(actions);

    stopOrderList.appendChild(item);
  });
}

// =========================
// SELECTION
// =========================

function clearSelection() {
  state.selected = null;
  clearSelectionStyles();
  stopEditor.classList.add("hidden");
  routeEditor.classList.add("hidden");
  noSelection.classList.remove("hidden");
  renderStopOrderList();
}

function selectStop(stop) {
  state.selected = {
    type: "stop",
    ref: stop
  };

  clearSelectionStyles();
  stop.marker.setIcon(ICONS.stopSelected);

  noSelection.classList.add("hidden");
  routeEditor.classList.add("hidden");
  stopEditor.classList.remove("hidden");

  stopNameInput.value = stop.name;
  stopMinuteInput.value = stop.minuteFromStart;
  stopNoteInput.value = stop.note;
  stopLatInput.value = stop.lat.toFixed(6);
  stopLonInput.value = stop.lon.toFixed(6);
  stopSourceInput.value = stop.sourceType === "catalog"
    ? "Katalog-Haltestelle"
    : "Freie Haltestelle";

  renderStopOrderList();
  setStatus(`Haltestelle ausgewählt: ${stop.name}`);
}

function selectRoutePoint(point) {
  state.selected = {
    type: "route",
    ref: point
  };

  clearSelectionStyles();
  point.marker.setIcon(ICONS.routeSelected);

  noSelection.classList.add("hidden");
  stopEditor.classList.add("hidden");
  routeEditor.classList.remove("hidden");

  routeLatInput.value = point.lat.toFixed(6);
  routeLonInput.value = point.lon.toFixed(6);

  renderStopOrderList();
  setStatus(`Routenpunkt ausgewählt: ${point.id}`);
}

function toggleRoutePointMultiSelection(point) {
  if (state.selectedRoutePointIds.has(point.id)) {
    state.selectedRoutePointIds.delete(point.id);
  } else {
    state.selectedRoutePointIds.add(point.id);
  }

  applyRoutePointIcons();

  const count = state.selectedRoutePointIds.size;
  setStatus(count > 0
    ? `${count} Routenpunkte in Mehrfachauswahl.`
    : "Mehrfachauswahl leer.");
}

// =========================
// STOPS
// =========================

function addStopToLine({ name, lat, lon, sourceType, catalogId = null }) {
  const stop = {
    id: "stop_" + stopIdCounter++,
    catalogId,
    name,
    lat,
    lon,
    minuteFromStart: 0,
    note: "",
    sourceType,
    marker: null
  };

  const marker = L.marker([lat, lon], {
    draggable: true,
    icon: ICONS.stop
  }).addTo(map);

  marker.bindTooltip(stop.name, {
    permanent: false,
    direction: "top"
  });

  marker.on("click", function () {
    selectStop(stop);
  });

  marker.on("dragend", function (e) {
    const newPos = e.target.getLatLng();
    stop.lat = newPos.lat;
    stop.lon = newPos.lng;

    if (state.selected && state.selected.type === "stop" && state.selected.ref.id === stop.id) {
      stopLatInput.value = stop.lat.toFixed(6);
      stopLonInput.value = stop.lon.toFixed(6);
    }

    if (state.routeMode === "auto") {
      rebuildAutoRouteFromStops();
    } else if (state.routeMode === "street") {
      setStatus("Haltestelle verschoben – bitte Straßenroute neu erzeugen.");
    }

    renderStopOrderList();
    setStatus(`Haltestelle verschoben: ${stop.name}`);
  });

  stop.marker = marker;
  state.stops.push(stop);

  updateStats();
  renderStopOrderList();
  selectStop(stop);
  maybeAutoBuildRoute();

  return stop;
}

function addCatalogStopToLine(catalogStop) {
  const existingStop = state.stops.find(
    stop => stop.sourceType === "catalog" && stop.catalogId === catalogStop.id
  );

  if (existingStop) {
    selectStop(existingStop);
    map.setView([existingStop.lat, existingStop.lon], 18);
    setStatus(`Haltestelle bereits in der Linie: ${catalogStop.name}`);
    debug("Haltestelle bereits vorhanden", catalogStop.name);
    return existingStop;
  }

  debug("Haltestelle hinzugefügt:", catalogStop.name);

  return addStopToLine({
    name: catalogStop.name,
    lat: catalogStop.lat,
    lon: catalogStop.lon,
    sourceType: "catalog",
    catalogId: catalogStop.id
  });
}

function createFreeStop(lat, lon) {
  debug("Freie Haltestelle erstellt", { lat, lon });

  addStopToLine({
    name: "Freie Haltestelle " + (state.stops.length + 1),
    lat,
    lon,
    sourceType: "free"
  });
}

function moveStopUp(index) {
  if (index <= 0) return;

  const tmp = state.stops[index - 1];
  state.stops[index - 1] = state.stops[index];
  state.stops[index] = tmp;

  rebuildCurrentRouteFromStops();
  renderStopOrderList();
  setStatus(`Haltestelle nach oben verschoben: ${state.stops[index - 1].name}`);
}

function moveStopDown(index) {
  if (index >= state.stops.length - 1) return;

  const tmp = state.stops[index + 1];
  state.stops[index + 1] = state.stops[index];
  state.stops[index] = tmp;

  rebuildCurrentRouteFromStops();
  renderStopOrderList();
  setStatus(`Haltestelle nach unten verschoben: ${state.stops[index + 1].name}`);
}

function deleteSelectedStop() {
  if (!state.selected || state.selected.type !== "stop") return;

  const stop = state.selected.ref;
  map.removeLayer(stop.marker);

  state.stops = state.stops.filter(item => item.id !== stop.id);

  clearSelection();
  updateStats();
  renderStopOrderList();

  rebuildCurrentRouteFromStops();
  setStatus("Haltestelle gelöscht.");
}

function snapSelectedStopToRoute() {
  if (!state.selected || state.selected.type !== "stop") {
    setStatus("Bitte zuerst eine Haltestelle auswählen.", "warn");
    return;
  }

  if (!state.routePoints || state.routePoints.length < 2) {
    setStatus("Es ist noch keine Route vorhanden.", "warn");
    return;
  }

  const stop = state.selected.ref;
  const snap = findClosestPointOnRoute(stop.lat, stop.lon);

  if (!snap) {
    setStatus("Kein passender Routenpunkt gefunden.", "warn");
    return;
  }

  stop.lat = snap.lat;
  stop.lon = snap.lon;
  stop.marker.setLatLng([stop.lat, stop.lon]);

  stopLatInput.value = stop.lat.toFixed(6);
  stopLonInput.value = stop.lon.toFixed(6);

  updateStopMarkerTooltip(stop);
  renderStopOrderList();

  debug("Haltestelle an Route gesnappt", {
    stopId: stop.id,
    stopName: stop.name,
    segmentIndex: snap.segmentIndex,
    lat: snap.lat,
    lon: snap.lon
  });

  setStatus(`Haltestelle an Route gesnappt: ${stop.name}`);
}

// =========================
// ROUTE POINTS
// =========================

function removeAllRoutePointMarkers() {
  state.routePoints.forEach(point => {
    map.removeLayer(point.marker);
  });

  state.routePoints = [];
  clearRouteMultiSelection();
}

function createRoutePointObject(lat, lon, silent = false) {
  const point = {
    id: "route_" + routePointIdCounter++,
    lat,
    lon,
    marker: null
  };

  const marker = L.marker([lat, lon], {
    draggable: true,
    icon: ICONS.route
  }).addTo(map);

  marker.on("mousedown", function (e) {
    if (e.originalEvent) {
      L.DomEvent.stopPropagation(e.originalEvent);
    }
    beginRoutePointInteraction();
  });

  marker.on("click", function (e) {
    if (e.originalEvent) {
      L.DomEvent.stopPropagation(e.originalEvent);
      L.DomEvent.preventDefault(e.originalEvent);
    }

    beginRoutePointInteraction();

    const ctrlPressed = e.originalEvent && (e.originalEvent.ctrlKey || e.originalEvent.metaKey);

    if (ctrlPressed) {
      toggleRoutePointMultiSelection(point);
      return;
    }

    selectRoutePoint(point);
  });

  marker.on("dragstart", function (e) {
    beginRoutePointInteraction();

    const draggedId = point.id;

    if (state.selectedRoutePointIds.has(draggedId) && state.selectedRoutePointIds.size > 1) {
      const startPos = e.target.getLatLng();
      const selectedPoints = state.routePoints.filter(p => state.selectedRoutePointIds.has(p.id));

      state.groupDragContext = {
        draggedId,
        startLat: startPos.lat,
        startLng: startPos.lng,
        points: selectedPoints.map(p => ({
          id: p.id,
          point: p,
          lat: p.lat,
          lon: p.lon
        }))
      };
    } else {
      state.groupDragContext = null;
    }
  });

  marker.on("drag", function (e) {
    if (!state.groupDragContext) return;
    if (state.groupDragContext.draggedId !== point.id) return;

    const currentPos = e.target.getLatLng();
    const deltaLat = currentPos.lat - state.groupDragContext.startLat;
    const deltaLng = currentPos.lng - state.groupDragContext.startLng;

    state.groupDragContext.points.forEach(entry => {
      if (entry.id === point.id) return;

      const newLat = entry.lat + deltaLat;
      const newLng = entry.lon + deltaLng;

      entry.point.lat = newLat;
      entry.point.lon = newLng;
      entry.point.marker.setLatLng([newLat, newLng]);
    });

    refreshRouteLine();
  });

  marker.on("dragend", function (e) {
    const newPos = e.target.getLatLng();
    point.lat = newPos.lat;
    point.lon = newPos.lng;

    if (state.groupDragContext && state.groupDragContext.draggedId === point.id) {
      const deltaLat = newPos.lat - state.groupDragContext.startLat;
      const deltaLng = newPos.lng - state.groupDragContext.startLng;

      state.groupDragContext.points.forEach(entry => {
        if (entry.id === point.id) return;

        entry.point.lat = entry.lat + deltaLat;
        entry.point.lon = entry.lon + deltaLng;
      });

      state.groupDragContext = null;

      if (
        state.selected &&
        state.selected.type === "route" &&
        state.selected.ref.id === point.id
      ) {
        routeLatInput.value = point.lat.toFixed(6);
        routeLonInput.value = point.lon.toFixed(6);
      }

      refreshRouteLine();
      endRoutePointInteraction();
      setStatus(`${state.selectedRoutePointIds.size} Routenpunkte gemeinsam verschoben.`);
      return;
    }

    if (state.selected && state.selected.type === "route" && state.selected.ref.id === point.id) {
      routeLatInput.value = point.lat.toFixed(6);
      routeLonInput.value = point.lon.toFixed(6);
    }

    refreshRouteLine();
    endRoutePointInteraction();

    if (!silent) {
      setStatus(`Routenpunkt verschoben: ${point.id}`);
    }
  });

  point.marker = marker;
  state.routePoints.push(point);
  return point;
}

function createManualRoutePoint(lat, lon) {
  switchToManualRouteMode();

  const point = createRoutePointObject(lat, lon, false);

  debug("Manueller Routenpunkt hinzugefügt", point.id, { lat, lon });

  refreshRouteLine();
  updateStats();
  selectRoutePoint(point);
  setStatus("Routenpunkt hinzugefügt.");
}

function insertRoutePointOnSegment(latlng) {
  if (state.routePoints.length < 2) {
    setStatus("Zum Einfügen auf die Linie werden mindestens 2 Routenpunkte benötigt.", "warn");
    return;
  }

  const seg = findClosestSegment(latlng);

  if (!seg) {
    warn("Kein Segment gefunden");
    setStatus("Kein passendes Liniensegment gefunden.", "warn");
    return;
  }

  createRoutePointObject(seg.latlng.lat, seg.latlng.lng, true);

  const createdPoint = state.routePoints.pop();
  state.routePoints.splice(seg.index + 1, 0, createdPoint);

  refreshRouteLine();
  updateStats();
  selectRoutePoint(createdPoint);

  debug("Routenpunkt auf Segment eingefügt", {
    index: seg.index,
    lat: seg.latlng.lat,
    lon: seg.latlng.lng
  });

  setStatus("Routenpunkt auf Route eingefügt");
}

function deleteSelectedRoutePoint() {
  // Erst Mehrfachauswahl löschen
  if (state.selectedRoutePointIds && state.selectedRoutePointIds.size > 0) {
    const idsToDelete = new Set(state.selectedRoutePointIds);

    state.routePoints.forEach(point => {
      if (idsToDelete.has(point.id)) {
        map.removeLayer(point.marker);
      }
    });

    state.routePoints = state.routePoints.filter(point => !idsToDelete.has(point.id));

    if (
      state.selected &&
      state.selected.type === "route" &&
      idsToDelete.has(state.selected.ref.id)
    ) {
      state.selected = null;
    }

    clearRouteMultiSelection();
    updateStats();
    clearSelectionStyles();
    refreshRouteLine();

    noSelection.classList.remove("hidden");
    routeEditor.classList.add("hidden");
    stopEditor.classList.add("hidden");

    debug("Mehrere Routenpunkte gelöscht", {
      count: idsToDelete.size
    });

    setStatus(`${idsToDelete.size} Routenpunkt(e) gelöscht.`);
    return;
  }

  // Sonst Einzelauswahl löschen
  if (!state.selected || state.selected.type !== "route") return;

  const point = state.selected.ref;
  map.removeLayer(point.marker);

  state.routePoints = state.routePoints.filter(item => item.id !== point.id);
  state.selectedRoutePointIds.delete(point.id);

  clearSelection();
  updateStats();
  applyRoutePointIcons();
  refreshRouteLine();

  debug("Einzelner Routenpunkt gelöscht", point.id);
  setStatus("Routenpunkt gelöscht.");
}

// =========================
// ROUTE BUILD / MODE
// =========================

function rebuildAutoRouteFromStops() {
  removeAllRoutePointMarkers();

  if (state.stops.length < 2) {
    refreshRouteLine();
    updateStats();
    return;
  }

  state.stops.forEach(stop => {
    createRoutePointObject(stop.lat, stop.lon, true);
  });

  refreshRouteLine();
  updateStats();
}

function rebuildCurrentRouteFromStops() {
  if (state.routeMode === "street") {
    setStatus("Haltestellen-Reihenfolge geändert – bitte Straßenroute neu erzeugen.");
    return;
  }

  rebuildAutoRouteFromStops();
}

function maybeAutoBuildRoute() {
  if (state.routeMode !== "auto") return;

  if (state.stops.length >= 2) {
    rebuildAutoRouteFromStops();
    setStatus("Automatische Grundroute aus Haltestellen erstellt.");
  }
}

function switchToManualRouteMode() {
  if (state.routeMode === "manual") {
    setMode("route", "Manueller Routenmodus aktiv – zusätzliche Punkte können gesetzt werden.");
    return;
  }

  state.routeMode = "manual";
  updateStats();
  setMode("route", "Manueller Routenmodus aktiv – zusätzliche Punkte können gesetzt werden.");
}

// =========================
// CLEANUP / SMOOTH / SIMPLIFY
// =========================

function cleanupRoutePoints(options = {}) {
  const minSpacingMeters = options.minSpacingMeters ?? 8;
  const straightenToleranceMeters = options.straightenToleranceMeters ?? 6;
  const keepEnds = options.keepEnds ?? true;

  if (state.routePoints.length < 3) {
    refreshRouteLine();
    updateStats();
    return 0;
  }

  const originalPoints = [...state.routePoints];
  const kept = [];
  let removedCount = 0;

  for (let i = 0; i < originalPoints.length; i++) {
    const point = originalPoints[i];
    const isFirst = i === 0;
    const isLast = i === originalPoints.length - 1;

    if (keepEnds && (isFirst || isLast)) {
      kept.push(point);
      continue;
    }

    const prev = kept[kept.length - 1];
    const next = originalPoints[i + 1];

    if (prev && approxDistanceMeters(prev, point) < minSpacingMeters) {
      map.removeLayer(point.marker);
      state.selectedRoutePointIds.delete(point.id);

      if (
        state.selected &&
        state.selected.type === "route" &&
        state.selected.ref.id === point.id
      ) {
        state.selected = null;
      }

      removedCount++;
      continue;
    }

    if (prev && next) {
      const deviation = pointToSegmentDistanceMeters(point, prev, next);

      if (deviation <= straightenToleranceMeters) {
        map.removeLayer(point.marker);
        state.selectedRoutePointIds.delete(point.id);

        if (
          state.selected &&
          state.selected.type === "route" &&
          state.selected.ref.id === point.id
        ) {
          state.selected = null;
        }

        removedCount++;
        continue;
      }
    }

    kept.push(point);
  }

  state.routePoints = kept;

  refreshRouteLine();
  updateStats();
  applyRoutePointIcons();

  if (!state.selected) {
    routeEditor.classList.add("hidden");
    noSelection.classList.remove("hidden");
  }

  return removedCount;
}

function autoCleanRouteAfterManualEdit() {
  const removed = cleanupRoutePoints({
    minSpacingMeters: 12,
    straightenToleranceMeters: 8,
    keepEnds: true
  });

  if (removed > 0) {
    setStatus(`Route automatisch begradigt (${removed} Punkt(e) entfernt).`);
  } else {
    refreshRouteLine();
    setStatus("Route aktualisiert.");
  }
}

function smoothRoute(options = {}) {
  const minSpacingMeters = options.minSpacingMeters ?? 4;
  const straightenToleranceMeters = options.straightenToleranceMeters ?? 2.5;
  const maxJoinDistanceMeters = options.maxJoinDistanceMeters ?? 20;
  const iterations = options.iterations ?? 1;
  const keepEnds = options.keepEnds ?? true;

  if (state.routePoints.length < 3) {
    setStatus("Zu wenige Routenpunkte zum Glätten.");
    return 0;
  }

  const previousMode = mode;
  const previousRouteMode = state.routeMode;

  let totalRemoved = 0;

  for (let round = 0; round < iterations; round++) {
    if (state.routePoints.length < 3) break;

    const original = [...state.routePoints];
    const kept = [];
    const idsToDelete = new Set();

    for (let i = 0; i < original.length; i++) {
      const point = original[i];
      const isFirst = i === 0;
      const isLast = i === original.length - 1;

      if (keepEnds && (isFirst || isLast)) {
        kept.push(point);
        continue;
      }

      const prev = kept[kept.length - 1];
      const next = original[i + 1];

      if (!prev || !next) {
        kept.push(point);
        continue;
      }

      const distPrevPoint = approxDistanceMeters(prev, point);
      const distPointNext = approxDistanceMeters(point, next);
      const distPrevNext = approxDistanceMeters(prev, next);
      const deviation = pointToSegmentDistanceMeters(point, prev, next);

      let removePoint = false;

      if (distPrevPoint < minSpacingMeters || distPointNext < minSpacingMeters) {
        removePoint = true;
      } else if (
        deviation <= straightenToleranceMeters &&
        distPrevNext <= maxJoinDistanceMeters
      ) {
        removePoint = true;
      }

      if (removePoint) {
        idsToDelete.add(point.id);
        continue;
      }

      kept.push(point);
    }

    if (!idsToDelete.size) {
      break;
    }

    original.forEach(point => {
      if (idsToDelete.has(point.id)) {
        map.removeLayer(point.marker);
      }
    });

    clearRouteSelectionIfDeleted(idsToDelete);
    state.routePoints = kept;
    totalRemoved += idsToDelete.size;
  }

  mode = previousMode;
  state.routeMode = previousRouteMode;

  refreshRouteLine();
  updateModeButtons();
  updateStats();
  applyRoutePointIcons();

  if (!state.selected || state.selected.type !== "route") {
    routeEditor.classList.add("hidden");
    noSelection.classList.remove("hidden");
  }

  return totalRemoved;
}

function smoothRouteWeak() {
  const removed = smoothRoute({
    minSpacingMeters: 3,
    straightenToleranceMeters: 1.8,
    maxJoinDistanceMeters: 12,
    iterations: 1,
    keepEnds: true
  });

  setStatus(
    removed > 0
      ? `Route weich geglättet (${removed} Punkt(e) entfernt).`
      : "Route weich geglättet – keine Punkte entfernt."
  );
}

function smoothRouteMedium() {
  const removed = smoothRoute({
    minSpacingMeters: 4,
    straightenToleranceMeters: 2.5,
    maxJoinDistanceMeters: 18,
    iterations: 1,
    keepEnds: true
  });

  setStatus(
    removed > 0
      ? `Route mittel geglättet (${removed} Punkt(e) entfernt).`
      : "Route mittel geglättet – keine Punkte entfernt."
  );
}

function smoothRouteStrong() {
  const removed = smoothRoute({
    minSpacingMeters: 6,
    straightenToleranceMeters: 4,
    maxJoinDistanceMeters: 26,
    iterations: 2,
    keepEnds: true
  });

  setStatus(
    removed > 0
      ? `Route stark geglättet (${removed} Punkt(e) entfernt).`
      : "Route stark geglättet – keine Punkte entfernt."
  );
}

function smoothRouteInteractive() {
  if (state.routePoints.length < 3) {
    setStatus("Zu wenige Routenpunkte zum Glätten.");
    return;
  }

  const input = prompt(
    "Route glätten:\n1 = weich\n2 = mittel\n3 = stark",
    "2"
  );

  if (input === null) {
    setStatus("Glätten abgebrochen.");
    return;
  }

  const value = String(input).trim();

  if (value === "1") {
    smoothRouteWeak();
    return;
  }

  if (value === "3") {
    smoothRouteStrong();
    return;
  }

  smoothRouteMedium();
}

function simplifyCurrentRoute() {
  if (state.routePoints.length < 3) {
    setStatus("Zu wenige Routenpunkte zum Vereinfachen.");
    return;
  }

  const originalCount = state.routePoints.length;

  const input = prompt(
    "Vereinfachung wählen:\n1 = leicht\n2 = mittel\n3 = stark",
    "1"
  );

  if (input === null) {
    setStatus("Vereinfachen abgebrochen.");
    return;
  }

  let tolerance = 0.00003;

  if (String(input).trim() === "2") {
    tolerance = 0.00006;
  } else if (String(input).trim() === "3") {
    tolerance = 0.0001;
  }

  const simplified = douglasPeucker(
    state.routePoints.map(point => ({
      lat: point.lat,
      lon: point.lon
    })),
    tolerance
  );

  state.simplifiedRoutePoints = simplified;
  state.previewMode = "simplified";

  refreshRouteLine();
  updateStats();

  setStatus(
    `Vereinfachte Vorschau erstellt: ${originalCount} → ${state.simplifiedRoutePoints.length} Punkte. Originalroute bleibt erhalten.`
  );
}

// =========================
// AUTOSAVE
// =========================

function buildAutosaveData() {
  return {
    lineName: lineNameInput.value.trim(),
    routeName: routeNameInput.value.trim(),
    directionName: directionNameInput.value.trim(),
    color: lineColorInput.value,
    routeMode: state.routeMode,
    previewMode: state.previewMode,
    stops: state.stops.map(stop => ({
      id: stop.id,
      catalogId: stop.catalogId,
      name: stop.name,
      lat: stop.lat,
      lon: stop.lon,
      minuteFromStart: stop.minuteFromStart,
      note: stop.note,
      sourceType: stop.sourceType
    })),
    routePoints: state.routePoints.map(point => ({
      id: point.id,
      lat: point.lat,
      lon: point.lon
    })),
    simplifiedRoutePoints: state.simplifiedRoutePoints.map(point => ({
      lat: point.lat,
      lon: point.lon
    })),
    savedAt: new Date().toISOString()
  };
}

function saveAutosave() {
  try {
    const data = buildAutosaveData();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));

    debug("Autosave gespeichert", {
      stops: data.stops.length,
      routePoints: data.routePoints.length
    });
  } catch (err) {
    error("Autosave fehlgeschlagen", err);
  }
}

function exportAutosaveFile() {
  const data = buildAutosaveData();
  const json = JSON.stringify(data, null, 2);

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "linie_autosave.json";

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);

  debug("Autosave-Datei exportiert");
}

function clearEditorData() {
  state.stops.forEach(stop => map.removeLayer(stop.marker));
  removeAllRoutePointMarkers();

  state.stops = [];
  state.routePoints = [];
  state.simplifiedRoutePoints = [];
  state.selected = null;
  state.routeMode = "auto";
  state.previewMode = "original";

  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  if (simplifiedPreviewLine) {
    map.removeLayer(simplifiedPreviewLine);
    simplifiedPreviewLine = null;
  }

  clearSelection();
  updateStats();
  renderStopOrderList();
  refreshRouteLine();
}

function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);

    if (!raw) {
      setStatus("Kein Autosave vorhanden.", "warn");
      return;
    }

    const data = JSON.parse(raw);
    clearEditorData();

    lineNameInput.value = data.lineName || "";
    routeNameInput.value = data.routeName || "";
    directionNameInput.value = data.directionName || "";
    lineColorInput.value = data.color || "#d32f2f";

    state.routeMode = data.routeMode || "auto";
    state.previewMode = data.previewMode || "original";

    let maxStopNum = 0;
    let maxRouteNum = 0;

    (data.stops || []).forEach(stopData => {
      const stop = addStopToLine({
        name: stopData.name,
        lat: stopData.lat,
        lon: stopData.lon,
        sourceType: stopData.sourceType || "free",
        catalogId: stopData.catalogId || null
      });

      stop.id = stopData.id;
      stop.minuteFromStart = Number(stopData.minuteFromStart || 0);
      stop.note = stopData.note || "";
      updateStopMarkerTooltip(stop);

      const n = Number(String(stop.id).replace("stop_", ""));
      if (!Number.isNaN(n)) maxStopNum = Math.max(maxStopNum, n);
    });

    removeAllRoutePointMarkers();

    (data.routePoints || []).forEach(pointData => {
      const point = createRoutePointObject(pointData.lat, pointData.lon, true);
      point.id = pointData.id;

      const n = Number(String(point.id).replace("route_", ""));
      if (!Number.isNaN(n)) maxRouteNum = Math.max(maxRouteNum, n);
    });

    state.simplifiedRoutePoints = (data.simplifiedRoutePoints || []).map(point => ({
      lat: point.lat,
      lon: point.lon
    }));

    stopIdCounter = Math.max(stopIdCounter, maxStopNum + 1);
    routePointIdCounter = Math.max(routePointIdCounter, maxRouteNum + 1);

    refreshRouteLine();
    updateModeButtons();
    updatePreviewButtons();
    updateStats();
    renderStopOrderList();
    clearSelection();

    debug("Autosave geladen", {
      stops: state.stops.length,
      routePoints: state.routePoints.length,
      savedAt: data.savedAt || null
    });

    setStatus("Autosave geladen.");
  } catch (err) {
    error("Autosave konnte nicht geladen werden", err);
    setStatus("Fehler beim Laden des Autosaves.", "error");
  }
}

function clearAutosave() {
  localStorage.removeItem(AUTOSAVE_KEY);
  debug("Autosave gelöscht");
  setStatus("Autosave gelöscht.");
}

function startAutosaveLoop() {
  setInterval(function () {
    saveAutosave();
  }, AUTOSAVE_INTERVAL_MS);
}

// =========================
// EXPORT / IMPORT
// =========================

function buildExportData() {
  return {
    id:
      "linie" +
      String(lineNameInput.value).trim().replace(/\s+/g, "_").toLowerCase() +
      "_a",
    lineName: lineNameInput.value.trim(),
    routeName: routeNameInput.value.trim(),
    directionName: directionNameInput.value.trim(),
    color: lineColorInput.value,
    routeMode: state.routeMode,
    stops: state.stops.map(stop => ({
      id: stop.id,
      catalogId: stop.catalogId,
      sourceType: stop.sourceType,
      name: stop.name,
      lat: Number(stop.lat.toFixed(6)),
      lon: Number(stop.lon.toFixed(6)),
      minuteFromStart: Number(stop.minuteFromStart),
      note: stop.note
    })),
    routePoints: state.routePoints.map(point => ([
      Number(point.lat.toFixed(6)),
      Number(point.lon.toFixed(6))
    ])),
    routePointsSimplified: state.simplifiedRoutePoints.map(point => ([
      Number(point.lat.toFixed(6)),
      Number(point.lon.toFixed(6))
    ]))
  };
}

function exportJson() {
  const data = buildExportData();

  debug("JSON Export gestartet", {
    lineId: data.id,
    stops: data.stops.length,
    routePoints: data.routePoints.length,
    simplifiedRoutePoints: data.routePointsSimplified.length
  });

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = (data.id || "linie_export") + ".json";

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
  setStatus("JSON exportiert.");
}

function loadLineFromData(data) {
  clearEditorData();

  lineNameInput.value = data.lineName || "";
  routeNameInput.value = data.routeName || "";
  directionNameInput.value = data.directionName || "";
  lineColorInput.value = data.color || "#d32f2f";

  state.routeMode = data.routeMode || "auto";
  state.previewMode = "original";

  let maxStopNum = 0;
  let maxRouteNum = 0;

  (data.stops || []).forEach(stopData => {
    const stop = addStopToLine({
      name: stopData.name,
      lat: stopData.lat,
      lon: stopData.lon,
      sourceType: stopData.sourceType || "free",
      catalogId: stopData.catalogId || null
    });

    stop.id = stopData.id || stop.id;
    stop.minuteFromStart = Number(stopData.minuteFromStart || 0);
    stop.note = stopData.note || "";
    updateStopMarkerTooltip(stop);

    const n = Number(String(stop.id).replace("stop_", ""));
    if (!Number.isNaN(n)) maxStopNum = Math.max(maxStopNum, n);
  });

  removeAllRoutePointMarkers();

  (data.routePoints || []).forEach(pointData => {
    let lat;
    let lon;
    let pointId = null;

    if (Array.isArray(pointData)) {
      lat = pointData[0];
      lon = pointData[1];
    } else {
      lat = pointData.lat;
      lon = pointData.lon;
      pointId = pointData.id || null;
    }

    const point = createRoutePointObject(lat, lon, true);

    if (pointId) {
      point.id = pointId;
    }

    const n = Number(String(point.id).replace("route_", ""));
    if (!Number.isNaN(n)) maxRouteNum = Math.max(maxRouteNum, n);
  });

  state.simplifiedRoutePoints = (data.routePointsSimplified || []).map(point => {
    if (Array.isArray(point)) {
      return { lat: point[0], lon: point[1] };
    }

    return {
      lat: point.lat,
      lon: point.lon
    };
  });

  stopIdCounter = Math.max(stopIdCounter, maxStopNum + 1);
  routePointIdCounter = Math.max(routePointIdCounter, maxRouteNum + 1);

  refreshRouteLine();
  updateModeButtons();
  updatePreviewButtons();
  updateStats();
  renderStopOrderList();
  clearSelection();

  debug("Linie geladen", {
    lineName: data.lineName || "",
    stops: state.stops.length,
    routePoints: state.routePoints.length
  });

  setStatus("Linie geladen.");
}

function loadLineFromFile(file) {
  if (!file) {
    setStatus("Keine Datei ausgewählt.", "warn");
    return;
  }

  const reader = new FileReader();

  reader.onload = function (event) {
    try {
      const data = JSON.parse(event.target.result);
      loadLineFromData(data);
    } catch (err) {
      error("Linie konnte nicht geladen werden", err);
      setStatus("Fehler beim Laden der Linien-Datei.", "error");
    }
  };

  reader.onerror = function () {
    error("Datei konnte nicht gelesen werden");
    setStatus("Datei konnte nicht gelesen werden.", "error");
  };

  reader.readAsText(file, "utf-8");
}

// =========================
// SERVER API
// =========================

async function saveLineToServer() {
  try {
    const data = buildExportData();

    const response = await fetch(API_SAVE_LINE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Speichern auf Server fehlgeschlagen");
    }

    debug("Linie auf Server gespeichert", result);
    setStatus("Linie auf Server gespeichert.");
  } catch (err) {
    error("Fehler beim Server-Speichern", err);
    setStatus("Fehler beim Speichern auf Server.", "error");
  }
}

async function fetchLineListFromServer() {
  try {
    const response = await fetch(API_LIST_LINES_URL);
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Linienliste konnte nicht geladen werden");
    }

    debug("Linienliste geladen", result.lines);
    return result.lines || [];
  } catch (err) {
    error("Fehler beim Laden der Linienliste", err);
    setStatus("Fehler beim Laden der Linienliste.", "error");
    return [];
  }
}

async function loadLineFromServer(lineId = null) {
  try {
    if (!lineId) {
      setStatus("Keine Linien-ID übergeben.", "warn");
      return;
    }

    const loadRes = await fetch(
      `${API_LOAD_LINE_URL}?line=${encodeURIComponent(lineId)}`
    );

    const loadResult = await loadRes.json();

    if (!loadResult.ok) {
      setStatus("Linie konnte nicht geladen werden", "error");
      return;
    }

    loadLineFromData(loadResult.line);

    debug("Linie vom Server geladen", lineId);
    setStatus(`Linie geladen: ${lineId}`);
  } catch (err) {
    error("Fehler beim Laden vom Server", err);
    setStatus("Fehler beim Laden vom Server.", "error");
  }
}

// =========================
// LINE BROWSER
// =========================

function closeLineBrowser() {
  lineBrowserModal.classList.add("hidden");
}

function renderLineBrowser(lines) {
  lineBrowserBody.innerHTML = "";

  if (!lines || !lines.length) {
    const empty = document.createElement("div");
    empty.className = "line-browser-empty";
    empty.textContent = "Keine gespeicherten Linien gefunden.";
    lineBrowserBody.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "line-browser-list";

  lines.forEach(line => {
    const item = document.createElement("div");
    item.className = "line-browser-item";

    const title = document.createElement("div");
    title.className = "line-browser-title";
    title.textContent =
      `${line.lineName || "?"} | ${line.routeName || "ohne Route"} – ${line.directionName || "ohne Richtung"}`;

    const meta = document.createElement("div");
    meta.className = "line-browser-meta";
    meta.innerHTML =
      `ID: ${line.id || "-"}<br>` +
      `Datei: ${line.file || "-"}<br>` +
      `Gespeichert: ${line.savedAt || "-"}`;

    item.appendChild(title);
    item.appendChild(meta);

    item.addEventListener("click", async function () {
      closeLineBrowser();
      await loadLineFromServer(line.id);
    });

    list.appendChild(item);
  });

  lineBrowserBody.appendChild(list);
}

async function openLineBrowser() {
  const lines = await fetchLineListFromServer();

  if (!lines.length) {
    lineBrowserBody.innerHTML = '<div class="line-browser-empty">Keine gespeicherten Linien auf dem Server gefunden.</div>';
    lineBrowserModal.classList.remove("hidden");
    setStatus("Keine gespeicherten Linien gefunden.", "warn");
    return;
  }

  renderLineBrowser(lines);
  lineBrowserModal.classList.remove("hidden");
  setStatus("Linien-Browser geöffnet.");
}

// =========================
// SEARCH / CATALOG
// =========================

function createCatalogMarkers() {
  stopCatalog.forEach(catalogStop => {
    const marker = L.marker([catalogStop.lat, catalogStop.lon], {
      icon: ICONS.catalog
    });

    const currentZoom = map.getZoom();
    const shouldShow = currentZoom >= CATALOG_MIN_ZOOM;

    if (shouldShow) {
      if (catalogCluster) {
        catalogCluster.addLayer(marker);
      } else {
        marker.addTo(map);
      }
    }

    marker.bindPopup(
      "<b>" + catalogStop.name + "</b><br>" +
      "ID: " + catalogStop.id + "<br>" +
      "Typ: " + (catalogStop.type || "unbekannt") + "<br>" +
      "<small>Klick im Modus 'Haltestelle aus Karte', um sie zur Linie hinzuzufügen.</small>"
    );

    marker.on("click", function () {
      if (mode !== "catalogStop") {
        setStatus("Zum Übernehmen bitte den Modus 'Haltestelle aus Karte' aktivieren.");
        return;
      }

      addCatalogStopToLine(catalogStop);
    });

    state.catalogMarkers.push(marker);
    state.catalogMarkerMap.set(catalogStop.id, marker);
  });
}

function updateCatalogMarkerVisibility() {
  const currentZoom = map.getZoom();
  const shouldShow = currentZoom >= CATALOG_MIN_ZOOM;

  state.catalogMarkers.forEach(marker => {
    const isOnMap = map.hasLayer(marker);

    if (shouldShow && !isOnMap) {
      if (catalogCluster) {
        catalogCluster.addLayer(marker);
      } else {
        marker.addTo(map);
      }
    }

    if (!shouldShow && isOnMap) {
      if (catalogCluster) {
        catalogCluster.removeLayer(marker);
      } else {
        map.removeLayer(marker);
      }
    }
  });

  if (shouldShow) {
    debug("Katalog-Haltestellen sichtbar", {
      zoom: currentZoom,
      count: state.catalogMarkers.length
    });
  } else {
    debug("Katalog-Haltestellen ausgeblendet", {
      zoom: currentZoom,
      minZoom: CATALOG_MIN_ZOOM
    });
  }
}

function clearSearchResults() {
  searchResults.innerHTML = "";
  searchResults.classList.add("hidden");
}

function highlightCatalogMarker(catalogStop) {
  if (state.highlightedCatalogMarker) {
    state.highlightedCatalogMarker.setIcon(ICONS.catalog);
  }

  const marker = state.catalogMarkerMap.get(catalogStop.id);
  if (!marker) return;

  marker.setIcon(ICONS.catalogHighlight);
  state.highlightedCatalogMarker = marker;

  setTimeout(() => {
    if (state.highlightedCatalogMarker === marker) {
      marker.setIcon(ICONS.catalog);
      state.highlightedCatalogMarker = null;
    }
  }, 4000);
}

function jumpToCatalogStop(catalogStop) {
  map.setView([catalogStop.lat, catalogStop.lon], 18);
  highlightCatalogMarker(catalogStop);

  const marker = state.catalogMarkerMap.get(catalogStop.id);
  if (marker) {
    marker.openPopup();
  }
}

function renderSearchResults(results) {
  searchResults.innerHTML = "";

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "search-result-item";
    empty.textContent = "Keine Treffer.";
    searchResults.appendChild(empty);
    searchResults.classList.remove("hidden");
    return;
  }

  results.forEach(stop => {
    const item = document.createElement("div");
    item.className = "search-result-item";

    const title = document.createElement("div");
    title.className = "search-result-title";
    title.textContent = stop.name;

    const meta = document.createElement("div");
    meta.className = "search-result-meta";
    meta.textContent =
      `Typ: ${stop.type || "unbekannt"} | ${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`;

    item.appendChild(title);
    item.appendChild(meta);

    item.addEventListener("click", function () {
      jumpToCatalogStop(stop);

      if (mode === "catalogStop") {
        const addedStop = addCatalogStopToLine(stop);
        if (addedStop) {
          selectStop(addedStop);
        }
        setStatus(`Turbo: Haltestelle direkt übernommen: ${stop.name}`);
      } else {
        setStatus(`Karte zu Haltestelle gesprungen: ${stop.name}`);
      }

      stopSearchInput.value = stop.name;
      clearSearchResults();
    });

    searchResults.appendChild(item);
  });

  searchResults.classList.remove("hidden");
}

function performSearch(query) {
  const q = query.trim().toLowerCase();

  if (!q) {
    clearSearchResults();
    return;
  }

  const results = stopCatalog
    .filter(stop => stop.name && stop.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;

      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.localeCompare(b.name, "de");
    })
    .slice(0, 20);

  renderSearchResults(results);
}

// =========================
// HELP MODAL
// =========================

function openHelpModal() {
  helpModalBody.textContent = `LINIENEDITOR – KURZHILFE (ELI15)

1) Haltestelle aus Karte
Klick auf eine vorhandene Katalog-Haltestelle.
Sie wird direkt zur Linie hinzugefügt.

2) Freie Haltestelle
Klick auf die Karte.
Erstellt eine eigene Haltestelle, wenn im Katalog nichts Passendes da ist.

3) Route zeichnen
Klick auf die Karte.
Setzt manuelle Routenpunkte.

4) Straßenroute erzeugen
Berechnet die Route automatisch über Straßen zwischen den Haltestellen.

5) Teilstrecke neu berechnen
Zuerst 2 Routenpunkte auswählen.
Dann nur diesen Abschnitt neu berechnen.

6) Route glätten
Macht die Linie ruhiger und sauberer.

7) Route vereinfachen
Erstellt eine sparsamere Zusatzroute für Vorschau oder spätere App.

8) Original anzeigen
Zeigt die echte Route mit allen Punkten.

9) Vereinfachte anzeigen
Zeigt die reduzierte Vorschau-Route.

10) Auswählen
Damit bearbeitest du vorhandene Punkte statt neue zu setzen.

11) STRG + Klick
Mehrere Routenpunkte einzeln auswählen.

12) SHIFT + Ziehen
Rahmenauswahl für viele Punkte gleichzeitig.

13) ALT + Klick auf Linie
Fügt einen neuen Routenpunkt direkt auf der bestehenden Linie ein.

14) Punkte löschen
Markierte Routenpunkte löschen.

15) JSON exportieren
Speichert die Linie als Datei für die spätere Lehrfahrer-App.

16) Debug
Zeigt interne Meldungen direkt im Editor.`;

  helpModal.classList.remove("hidden");
}

function closeHelpModal() {
  helpModal.classList.add("hidden");
}

// =========================
// OSRM ROUTING
// =========================

async function fetchStreetSegment(fromStop, toStop) {
  const coords = `${fromStop.lon},${fromStop.lat};${toStop.lon},${toStop.lat}`;
  const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OSRM Fehler ${response.status}`);
  }

  const data = await response.json();

  if (!data.routes || !data.routes.length) {
    throw new Error("Keine Route von OSRM gefunden.");
  }

  return data.routes[0].geometry.coordinates;
}

async function rerouteSelectedSegment() {
  if (state.selectedRoutePointIds.size !== 2) {
    setStatus("Bitte genau zwei Routenpunkte auswählen.");
    return;
  }

  const ids = Array.from(state.selectedRoutePointIds);

  const indexA = state.routePoints.findIndex(p => p.id === ids[0]);
  const indexB = state.routePoints.findIndex(p => p.id === ids[1]);

  if (indexA === -1 || indexB === -1) {
    setStatus("Routenpunkte nicht gefunden.");
    return;
  }

  const startIndex = Math.min(indexA, indexB);
  const endIndex = Math.max(indexA, indexB);

  const startPoint = state.routePoints[startIndex];
  const endPoint = state.routePoints[endIndex];

  try {
    setStatus("Teilstrecke wird neu berechnet...");
    debug("Teilstrecke wird neu berechnet", {
      startIndex,
      endIndex,
      selectedPoints: Array.from(state.selectedRoutePointIds)
    });

    const segment = await fetchStreetSegment(
      { lat: startPoint.lat, lon: startPoint.lon },
      { lat: endPoint.lat, lon: endPoint.lon }
    );

    const newPoints = segment.map(coord => ({
      lat: coord[1],
      lon: coord[0]
    }));

    const removed = state.routePoints.splice(startIndex + 1, endIndex - startIndex - 1);
    removed.forEach(p => map.removeLayer(p.marker));

    let insertIndex = startIndex + 1;

    newPoints.slice(1, -1).forEach(coord => {
      createRoutePointObject(coord.lat, coord.lon, true);
      const createdPoint = state.routePoints.pop();
      state.routePoints.splice(insertIndex, 0, createdPoint);
      insertIndex++;
    });

    refreshRouteLine();
    clearRouteMultiSelection();
    applyRoutePointIcons();

    debug("Teilstrecke erfolgreich neu berechnet", {
      startIndex,
      endIndex,
      totalRoutePoints: state.routePoints.length
    });

    setStatus("Teilstrecke erfolgreich neu berechnet.");
  } catch (err) {
    error("Fehler beim Teilrouting", err);
    setStatus("Fehler beim Teilrouting.", "error");
  }
}

async function buildStreetRouteFromStops() {
  if (state.stops.length < 2) {
    setStatus("Für Straßenrouting werden mindestens 2 Haltestellen benötigt.");
    return;
  }

  try {
    buildStreetRouteBtn.disabled = true;
    setStatus("Straßenroute wird berechnet ...");

    removeAllRoutePointMarkers();

    const allCoords = [];

    for (let i = 0; i < state.stops.length - 1; i++) {
      const fromStop = state.stops[i];
      const toStop = state.stops[i + 1];

      setStatus(`Straßenroute berechne Teilstück ${i + 1}/${state.stops.length - 1}: ${fromStop.name} → ${toStop.name}`);

      const segment = await fetchStreetSegment(fromStop, toStop);

      segment.forEach((coord, idx) => {
        if (i > 0 && idx === 0) return;
        allCoords.push(coord);
      });
    }

    allCoords.forEach(coord => {
      const lon = coord[0];
      const lat = coord[1];
      createRoutePointObject(lat, lon, true);
    });

    state.routeMode = "street";
    state.simplifiedRoutePoints = [];
    state.previewMode = "original";

    debug("Straßenroute berechnet", {
      stops: state.stops.length,
      routePoints: state.routePoints.length
    });

    refreshRouteLine();
    updateStats();
    setStatus("Straßenroute erfolgreich erzeugt.");
  } catch (err) {
    error("Fehler beim Straßenrouting", err);
    setStatus(`Fehler beim Straßenrouting: ${err.message}`, "error");
  } finally {
    buildStreetRouteBtn.disabled = false;
  }
}

// =========================
// EVENTS
// =========================

exportAutosaveBtn.addEventListener("click", function () {
  exportAutosaveFile();
});

helpBtn.addEventListener("click", function () {
  openHelpModal();
});

helpCloseBtn.addEventListener("click", function () {
  closeHelpModal();
});

helpModal.addEventListener("click", function (e) {
  if (e.target === helpModal) {
    closeHelpModal();
  }
});

lineBrowserCloseBtn.addEventListener("click", function () {
  closeLineBrowser();
});

lineBrowserModal.addEventListener("click", function (e) {
  if (e.target === lineBrowserModal) {
    closeLineBrowser();
  }
});

debugToggleBtn.addEventListener("click", function () {
  toggleDebugPanel();
});

debugClearBtn.addEventListener("click", function () {
  clearDebugPanel();
});

modeCatalogStopBtn.addEventListener("click", function () {
  setMode("catalogStop", "Modus: Haltestelle aus Karte");
});

modeFreeStopBtn.addEventListener("click", function () {
  setMode("freeStop", "Modus: Freie Haltestelle");
});

modeRouteBtn.addEventListener("click", function () {
  switchToManualRouteMode();
});

buildStreetRouteBtn.addEventListener("click", async function () {
  await buildStreetRouteFromStops();
});

rerouteSegmentBtn.addEventListener("click", async function () {
  await rerouteSelectedSegment();
});

snapStopToRouteBtn.addEventListener("click", function () {
  snapSelectedStopToRoute();
});

smoothRouteBtn.addEventListener("click", function () {
  smoothRouteInteractive();
});

simplifyRouteBtn.addEventListener("click", function () {
  simplifyCurrentRoute();
});

showOriginalRouteBtn.addEventListener("click", function () {
  state.previewMode = "original";
  refreshRouteLine();
  setStatus("Originalroute angezeigt.");
});

showSimplifiedRouteBtn.addEventListener("click", function () {
  if (!state.simplifiedRoutePoints.length) {
    setStatus("Noch keine vereinfachte Route vorhanden.");
    return;
  }

  state.previewMode = "simplified";
  refreshRouteLine();
  setStatus("Vereinfachte Route angezeigt.");
});

modeSelectBtn.addEventListener("click", function () {
  setMode("select", "Modus: Auswählen – STRG+Klick oder SHIFT+Ziehen für Rahmenauswahl");
});

clearBtn.addEventListener("click", function () {
  const ok = confirm("Wirklich alle Linien-Daten löschen?");
  if (!ok) return;

  clearEditorData();
  setStatus("Alle Linien-Daten gelöscht.");
});

saveLineBtn.addEventListener("click", function () {
  saveLineToServer();
});

loadLineBtn.addEventListener("click", function () {
  openLineBrowser();
});

exportBtn.addEventListener("click", function () {
  exportJson();
});

loadAutosaveBtn.addEventListener("click", function () {
  loadAutosave();
});

clearAutosaveBtn.addEventListener("click", function () {
  const ok = confirm("Wirklich den gespeicherten Autosave löschen?");
  if (!ok) return;

  clearAutosave();
});

saveStopBtn.addEventListener("click", function () {
  if (!state.selected || state.selected.type !== "stop") return;

  const stop = state.selected.ref;
  stop.name = stopNameInput.value.trim() || stop.name;
  stop.minuteFromStart = Number(stopMinuteInput.value || 0);
  stop.note = stopNoteInput.value.trim();

  updateStopMarkerTooltip(stop);

  if (state.routeMode === "auto") {
    rebuildAutoRouteFromStops();
  } else if (state.routeMode === "street") {
    setStatus("Haltestelle gespeichert – bitte Straßenroute neu erzeugen.");
  } else {
    setStatus("Haltestelle gespeichert.");
  }
});

deleteStopBtn.addEventListener("click", function () {
  deleteSelectedStop();
});

deleteRoutePointBtn.addEventListener("click", function () {
  deleteSelectedRoutePoint();
});

lineColorInput.addEventListener("input", function () {
  refreshRouteLine();
});

stopSearchInput.addEventListener("input", function () {
  performSearch(stopSearchInput.value);
});

stopSearchInput.addEventListener("focus", function () {
  performSearch(stopSearchInput.value);
});

document.addEventListener("click", function (e) {
  const searchBox = document.querySelector(".search-group");
  if (searchBox && !searchBox.contains(e.target)) {
    clearSearchResults();
  }
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    if (state.boxSelection.active) {
      cancelBoxSelection();
      setStatus("Box-Auswahl abgebrochen.");
      return;
    }

    clearRouteMultiSelection();
    applyRoutePointIcons();
    setStatus("Mehrfachauswahl der Routenpunkte gelöscht.");
    return;
  }

  if (e.key === "Delete") {
    deleteSelectedRoutePoint();
    return;
  }

  if (e.key.toLowerCase() === "g") {
    smoothRouteInteractive();
  }
});

mapWrapElement.addEventListener("pointerdown", function (e) {
  if (mode !== "select") return;
  if (!e.shiftKey) return;
  if (e.button !== 0) return;

  beginBoxSelection(e);
  e.preventDefault();
});

document.addEventListener("pointermove", function (e) {
  if (!state.boxSelection.active) return;
  updateBoxSelection(e);
});

document.addEventListener("pointerup", function () {
  if (!state.boxSelection.active) return;
  finishBoxSelection();
});

map.on("zoomend", function () {
  updateCatalogMarkerVisibility();
});

map.on("click", function (e) {
  if (e.originalEvent && e.originalEvent.altKey) {
    insertRoutePointOnSegment(e.latlng);
    return;
  }

  if (state.boxSelection.active) {
    return;
  }

  if (state.routePointInteractionActive || state.suppressNextMapClick) {
    return;
  }

  const lat = e.latlng.lat;
  const lon = e.latlng.lng;

  if (mode === "freeStop") {
    createFreeStop(lat, lon);
    return;
  }

  if (mode === "route") {
    createManualRoutePoint(lat, lon);
    return;
  }

  if (mode === "select") {
    clearSelection();
    setStatus("Auswahl aufgehoben.");
  }
});

// =========================
// GPX EXPORT (Maps.me / Offline)
// Datei: editor.js
// =========================

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeFilename(value) {
  return String(value || "linie")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_");
}

function getGpxTrackPoints() {
  if (state.simplifiedRoutePoints && state.simplifiedRoutePoints.length > 1) {
    return state.simplifiedRoutePoints
      .filter(p => typeof p.lat === "number" && typeof p.lon === "number")
      .map(p => ({ lat: p.lat, lon: p.lon }));
  }

  if (state.routePoints && state.routePoints.length > 1) {
    return state.routePoints
      .filter(p => typeof p.lat === "number" && typeof p.lon === "number")
      .map(p => ({ lat: p.lat, lon: p.lon }));
  }

  if (state.stops && state.stops.length > 1) {
    return state.stops
      .filter(p => typeof p.lat === "number" && typeof p.lon === "number")
      .map(p => ({ lat: p.lat, lon: p.lon }));
  }

  return [];
}

function getGpxWaypoints() {
  if (!state.stops || !state.stops.length) return [];

  return state.stops
    .filter(stop => typeof stop.lat === "number" && typeof stop.lon === "number")
    .map((stop, index) => {
      const stopName = stop.name || `Haltestelle ${index + 1}`;
      const minutes =
        stop.minutesFromStart !== undefined &&
        stop.minutesFromStart !== null &&
        stop.minutesFromStart !== ""
          ? ` (${stop.minutesFromStart} min)`
          : "";

      return {
        lat: stop.lat,
        lon: stop.lon,
        name: stopName,
        desc: `Stopp ${index + 1}${minutes}`
      };
    });
}

function buildGpxString() {
  const lineName = document.getElementById("lineName")?.value?.trim() || "Linie";
  const direction = document.getElementById("lineDirection")?.value?.trim() || "";
  const color = document.getElementById("lineColor")?.value?.trim() || "#d32f2f";

  const routeName = direction ? `${lineName} - ${direction}` : lineName;

  const trackPoints = getGpxTrackPoints();
  const waypoints = getGpxWaypoints();

  if (trackPoints.length < 2) {
    throw new Error("Für den GPX-Export werden mindestens 2 Routenpunkte benötigt.");
  }

  const waypointXml = waypoints.map(wpt => `
  <wpt lat="${wpt.lat}" lon="${wpt.lon}">
    <name>${escapeXml(wpt.name)}</name>
    <desc>${escapeXml(wpt.desc)}</desc>
  </wpt>`).join("");

  const trackXml = trackPoints.map(pt => `
      <trkpt lat="${pt.lat}" lon="${pt.lon}"></trkpt>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lehrfahrer Linieneditor" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(routeName)}</name>
    <desc>${escapeXml(`Export aus dem Lehrfahrer Linieneditor | Farbe: ${color}`)}</desc>
  </metadata>${waypointXml}
  <trk>
    <name>${escapeXml(routeName)}</name>
    <desc>${escapeXml("Route für Maps.me / Offline-Nutzung")}</desc>
    <trkseg>${trackXml}
    </trkseg>
  </trk>
</gpx>`;
}

function exportLineAsGpx() {
  try {
    const gpx = buildGpxString();

    const lineName = document.getElementById("lineName")?.value?.trim() || "Linie";
    const direction = document.getElementById("lineDirection")?.value?.trim() || "";
    const fileBase = direction ? `${lineName}_${direction}` : lineName;
    const fileName = `${sanitizeFilename(fileBase)}.gpx`;

    const blob = new Blob([gpx], { type: "application/gpx+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);

    if (typeof setStatus === "function") {
      setStatus(`GPX exportiert: ${fileName}`);
    }
  } catch (error) {
    console.error("GPX-Export fehlgeschlagen:", error);

    if (typeof setStatus === "function") {
      setStatus(error.message || "GPX-Export fehlgeschlagen.");
    } else {
      alert(error.message || "GPX-Export fehlgeschlagen.");
    }
  }
}

// =========================
// START
// =========================

initDebugPanel();

debug("Initialisiere Katalogmarker ...");
createCatalogMarkers();
updateCatalogMarkerVisibility();

debug("Aktualisiere UI-Status ...");
updateModeButtons();
updatePreviewButtons();
updateStats();
renderStopOrderList();

startAutosaveLoop();

debug("Editor bereit.");
setStatus("Editor bereit.");
// =========================
// API / EXPORT / IMPORT
// =========================
// Dieses Modul enthält Funktionen für:
// - Datentransformation (Export/Import)
// - Dateinamen-Generierung
// - Kartendaten (Bounds, View)
// - Server-Kommunikation (Speichern, Laden)

// Ermittelt den Anzeige-Typ einer Haltestelle für die UI
// Gibt "free", "catalog" oder "unknown" zurück
function getStopDisplayType(stop) {
  if (!stop) return "unknown";

  const directType = String(stop.transitType || stop.type || "").toLowerCase().trim();
  if (["bus", "tram", "bus_tram", "mixed"].includes(directType)) {
    return directType;
  }

  if (stop.sourceType === "free") {
    return "free";
  }

  const catalogEntry = stopCatalog.find(entry => entry.id === stop.catalogId);

  if (!catalogEntry || !catalogEntry.type) {
    return stop.sourceType === "catalog" ? "catalog" : "unknown";
  }

  return String(catalogEntry.type).toLowerCase().trim();
}

// Berechnet die Minuten zwischen zwei aufeinanderfolgenden Haltestellen
// Wird für die Fahrplandarstellung benötigt
function getStopSegmentMinutes(index) {
  if (index <= 0 || index >= state.stops.length) {
    return 0;
  }

  const prevMinute = Number(state.stops[index - 1].minuteFromStart || 0);
  const currentMinute = Number(state.stops[index].minuteFromStart || 0);

  return Math.max(0, currentMinute - prevMinute);
}

// Berechnet die geografischen Grenzen (Bounding Box) der aktuellen Linie
// Enthält min/max Lat/Lon Werte für alle Stops und Routenpunkte
function getMapBoundsData() {
  const points = [];

  state.stops.forEach(stop => {
    points.push({ lat: stop.lat, lon: stop.lon });
  });

  state.routePoints.forEach(point => {
    points.push({ lat: point.lat, lon: point.lon });
  });

  if (!points.length) {
    return null;
  }

  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLon = points[0].lon;
  let maxLon = points[0].lon;

  points.forEach(point => {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  });

  return {
    minLat: Number(minLat.toFixed(6)),
    minLon: Number(minLon.toFixed(6)),
    maxLat: Number(maxLat.toFixed(6)),
    maxLon: Number(maxLon.toFixed(6))
  };
}

// Erfasst die aktuelle Kartenansicht (Zentrum und Zoom-Level)
// Wird beim Export gespeichert, um die Ansicht später wiederherzustellen
function getMapViewData() {
  const center = map.getCenter();

  return {
    centerLat: Number(center.lat.toFixed(6)),
    centerLon: Number(center.lng.toFixed(6)),
    zoom: map.getZoom()
  };
}

// Ermittelt die Fahrtrichtung aus dem Richtungsfeld
// Gibt "hin", "rueck" oder "a" (Standard) zurück
function getDirectionId() {
  const raw = String(directionNameInput.value || "").trim().toLowerCase();

  if (!raw) return "a";

  if (
    raw.includes("hin") ||
    raw.includes("hinfahrt") ||
    raw.includes("stadteinwärts") ||
    raw.includes("einwärts")
  ) {
    return "hin";
  }

  if (
    raw.includes("rück") ||
    raw.includes("rueck") ||
    raw.includes("rückfahrt") ||
    raw.includes("stadtauswärts") ||
    raw.includes("auswärts")
  ) {
    return "rueck";
  }

  return "a";
}

// Erstellt den Basis-Dateinamen aus Linien-, Routen- und Richtungsname
// Wird für Dateinamen beim Speichern verwendet
function buildLineFileBase() {
  const lineSuffix = String(lineNameInput.value || "").trim();
  const routeSuffix = String(routeNameInput.value || "").trim();
  const directionName = String(directionNameInput.value || "").trim();

  const linePart  = lineSuffix  ? "Linie_"  + lineSuffix  : "Linie";
  const routePart = routeSuffix ? "Route_"  + routeSuffix : "";

  const raw = [linePart, routePart, directionName].filter(Boolean).join("_");
  return sanitizeFilename(raw || "Linie");
}

// Erzeugt den Ordnernamen für diese Linie (nur aus dem Linienfeld)
function buildLineFolder() {
  const lineSuffix = String(lineNameInput.value || "").trim();
  return sanitizeFilename(lineSuffix ? "Linie_" + lineSuffix : "Linie");
}

// Erstellt das vollständige Export-Datenset für JSON-Speicherung
// Enthält alle Daten im kompatiblen Format für PHP und App
function buildExportData() {
  const lineSuffix     = String(lineNameInput.value || "").trim();
  const routeSuffix    = String(routeNameInput.value || "").trim();
  const directionName  = String(directionNameInput.value || "").trim();

  // Vollständige Anzeigenamen (werden so gespeichert und angezeigt)
  const lineName  = lineSuffix  ? "Linie "  + lineSuffix  : "";
  const routeName = routeSuffix ? "Route " + routeSuffix : "";

  const directionId = getDirectionId();
  const lineId =
    "linie_" +
    String(lineSuffix || "unbekannt")
      .replace(/\s+/g, "_")
      .toLowerCase() +
    "_" +
    directionId;

  const fileBase = buildLineFileBase();
  const lineFolder = buildLineFolder();

  const startStop = state.stops.length ? state.stops[0] : null;
  const endStop = state.stops.length ? state.stops[state.stops.length - 1] : null;

  const hasFreeStops = state.stops.some(stop => stop.sourceType === "free");
  const bounds = getMapBoundsData();
  const mapView = getMapViewData();

const stops = state.stops.map((stop, index) => ({
  id: stop.id,
  catalogId: stop.catalogId || null,
  groupId: stop.groupId || stop.catalogId || null,

  sourceType: stop.sourceType,
  type: getStopDisplayType(stop),

  platformCode: stop.platformCode || null,
  directionHint: stop.directionHint || null,
  side: stop.side || null,
  oppositeStopId: stop.oppositeStopId || null,

  name: stop.name,
  lat: Number(stop.lat.toFixed(6)),
  lon: Number(stop.lon.toFixed(6)),

  order: index + 1,

  minuteFromStart: Number(stop.minuteFromStart || 0),
  minuteMode: stop.minuteMode || "auto",
  segmentMinutes: getStopSegmentMinutes(index),

  arrivalMinute: Number(stop.minuteFromStart || 0),
  departureMinute: Number(stop.minuteFromStart || 0),

  note: stop.note || "",

  isTimingPoint: index === 0 || index === state.stops.length - 1
}));

  const routeOriginal = state.routePoints.map(point => ({
    lat: Number(point.lat.toFixed(6)),
    lon: Number(point.lon.toFixed(6)),
    sourceType: point.sourceType || "manual"
  }));

  const routeSimplified = state.simplifiedRoutePoints.length
    ? state.simplifiedRoutePoints.map(point => ({
        lat: Number(point.lat.toFixed(6)),
        lon: Number(point.lon.toFixed(6))
      }))
    : null;

  return {
    city: citySelect?.value || "cottbus",
    fileBase,
    lineFolder,

    // =====================================
    // ALT-KOMPATIBEL für bestehendes PHP
    // =====================================
    id: lineId,
    lineName,
    routeName,
    directionName,
    color: lineColorInput.value,
    routeMode: state.routeMode,
    stops,
    routePoints: routeOriginal.map(point => [point.lat, point.lon]),
    routePointsSimplified: routeSimplified
      ? routeSimplified.map(point => [point.lat, point.lon])
      : [],

    // =====================================
    // NEUES APP-FORMAT
    // =====================================
    meta: {
      formatVersion: "1.2",
      exportedAt: new Date().toISOString(),
      source: "Lehrfahrer Linien-Editor"
    },

    line: {
      id: lineId,
      lineName,
      routeName,
      directionId,
      directionName,
      startStopName: startStop ? startStop.name : "",
      endStopName: endStop ? endStop.name : "",
      color: lineColorInput.value,
      routeMode: state.routeMode
    },

    stats: {
      routeLengthMeters: Math.round(getTotalRouteLengthMeters()),
      estimatedDriveMinutes: getEstimatedDriveMinutes(),
      stopCount: state.stops.length,
      routePointCount: state.routePoints.length,
      hasFreeStops
    },

    mapView,
    bounds,

    route: {
      original: routeOriginal,
      simplified: routeSimplified
    },

    schedule: {
      timeMode: "relative",
      startTime: null
    },

    app: {
      version: "1.0",
      hasTimingPoints: state.stops.length > 0
    }
  };
}

// Exportiert die aktuelle Linie als JSON-Datei zum Download
// Der Benutzer kann die Datei lokal speichern
function exportJson() {
  const data = buildExportData();

  debug("JSON Export gestartet", {
    lineId: data.line.id,
    stops: data.stops.length,
    routePoints: data.route.original.length,
    simplifiedRoutePoints: data.route.simplified ? data.route.simplified.length : 0
  });

  const json = JSON.stringify(data, null, 2);

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = (data.line.id || "linie_export") + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
  setStatus("JSON exportiert.");
}

// Speichert die Linie auf dem Server (PHP API)
// Zeigt zuerst einen Bestätigungs-Dialog, dann wird gespeichert
async function saveLineToServer() {
  const data = buildExportData();
  const city = data.city || citySelect?.value || "cottbus";
  const fileBase = data.fileBase || buildLineFileBase();
  const lineFolder = data.lineFolder || buildLineFolder();

  // ---------- Bestätigungs-Dialog anzeigen ----------
  const confirmed = await showSaveConfirmDialog({ data, city, fileBase, lineFolder });
  if (!confirmed) return;

  // ---------- Tatsächlich speichern ----------
  await _doSaveLineToServer(data, city, fileBase, lineFolder);
}

// Zeigt den Speichern-Dialog und wartet auf Bestätigung (Promise<boolean>)
function showSaveConfirmDialog({ data, city, fileBase, lineFolder }) {
  return new Promise(resolve => {
    const modal   = document.getElementById("saveConfirmModal");
    const okBtn   = document.getElementById("saveConfirmOkBtn");
    const cancelBtn = document.getElementById("saveConfirmCancelBtn");

    document.getElementById("saveConfirmCity").textContent = city.charAt(0).toUpperCase() + city.slice(1);
    document.getElementById("saveConfirmFile").textContent = (lineFolder ? lineFolder + "/" : "") + fileBase + ".json / .gpx";
    document.getElementById("saveConfirmStops").textContent = (data.stops?.length ?? 0) + " Haltestellen";

    const km = data.stats?.routeLengthMeters
      ? (data.stats.routeLengthMeters / 1000).toFixed(2) + " km"
      : "–";
    document.getElementById("saveConfirmLength").textContent = km;

    modal.classList.remove("hidden");
    okBtn.focus();

    function cleanup(result) {
      modal.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onOverlay);
      resolve(result);
    }
    function onOk()      { cleanup(true); }
    function onCancel()  { cleanup(false); }
    function onOverlay(e){ if (e.target === modal) cleanup(false); }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onOverlay);
  });
}

// Führt den eigentlichen Speicher-Vorgang durch (intern)
async function _doSaveLineToServer(data, city, fileBase, lineFolder) {
  try {
    setStatus("Speichern …");

    // ---------- JSON speichern ----------
    const response = await fetch(API_SAVE_LINE_URL, {
      method: "POST",
      headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "JSON-Speichern auf Server fehlgeschlagen");
    }

    // Vom Server tatsächlich verwendeten fileBase übernehmen (kann abweichen bei Konfliktvermeidung)
    const actualFileBase = result.fileBase || fileBase;

    // ---------- GPX erzeugen + speichern ----------
    const gpx = buildGpxString();
    let gpxSaved = false;
    try {
      const gpxResult = await saveGpxToServer(`${actualFileBase}.gpx`, gpx, city, lineFolder);
      gpxSaved = !!(gpxResult && gpxResult.ok !== false);
    } catch (gpxErr) {
      warn("GPX konnte nicht gespeichert werden: " + gpxErr.message);
    }

    debug("Linie + GPX auf Server gespeichert", { json: result, gpxSaved, city, fileBase: actualFileBase, lineFolder });

    if (typeof showSaveToast === "function") {
      showSaveToast({
        fileBase: actualFileBase,
        city,
        stopCount: state.stops.length,
        routePointCount: state.routePoints.length,
        gpxSaved,
        savedAt: result.savedAt || new Date().toISOString()
      });
    }
    setStatus(`Gespeichert: ${lineFolder}/${actualFileBase}.json${gpxSaved ? " + .gpx" : ""} (${city})`);
  } catch (err) {
    error("Fehler beim Server-Speichern", err);
    setStatus(err.message || "Fehler beim Speichern auf Server.", "error");
  }
}

// Lädt die Liste aller gespeicherten Linien vom Server
// Wird für den Linien-Browser verwendet
async function fetchLineListFromServer() {
  try {
    const city = String(citySelect?.value || "").trim();
    const params = new URLSearchParams();
    if (city) {
      params.set("city", city);
    }
    params.set("_ts", String(Date.now()));

    const response = await fetch(
      `${API_LIST_LINES_URL}?${params.toString()}`,
      { cache: "no-store" }
    );
    const rawText = await response.text();
    let result;
    try {
      result = JSON.parse(rawText);
    } catch (parseErr) {
      throw new Error("Ungültiges JSON vom Server: " + rawText.substring(0, 200));
    }

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Linienliste konnte nicht geladen werden");
    }

    debug("Linienliste geladen", {
      city,
      count: (result.lines || []).length,
      lines: result.lines || []
    });

    return result.lines || [];
  } catch (err) {
    error("Fehler beim Laden der Linienliste", err);
    setStatus("Fehler beim Laden der Linienliste.", "error");
    return [];
  }
}

// Lädt eine spezifische Linie vom Server anhand der ID
// Parst die JSON-Daten und füllt den Editor mit den geladenen Werten
async function loadLineFromServer(lineId = null, lineFolder = null) {
  try {
    if (!lineId) {
      setStatus("Keine Linien-ID übergeben.", "warn");
      return;
    }

    const city = citySelect?.value || "cottbus";

    let normalizedLineId = lineId;

    if (typeof lineId === "object" && lineId !== null) {
      normalizedLineId =
        lineId.id ||
        (lineId.file ? String(lineId.file).replace(/\.json$/i, "") : "") ||
        "";
    }

    normalizedLineId = String(normalizedLineId || "").replace(/\.json$/i, "").trim();

    if (!normalizedLineId) {
      setStatus("Ungültige Linien-ID.", "error");
      return;
    }

    const loadRes = await fetch(
      `${API_LOAD_LINE_URL}?city=${encodeURIComponent(city)}&line=${encodeURIComponent(normalizedLineId)}&lineFolder=${encodeURIComponent(lineFolder || "")}`,
      { cache: "no-store" }
    );

    const rawText = await loadRes.text();

    let loadResult;
    try {
      loadResult = JSON.parse(rawText);
    } catch (err) {
      throw new Error("Server liefert kein gültiges JSON zurück: " + rawText);
    }

    if (!loadRes.ok || !loadResult.ok) {
      throw new Error(loadResult.error || "Linie konnte nicht geladen werden");
    }

    const lineData = loadResult.line || loadResult.data || null;

    if (!lineData || typeof lineData !== "object") {
      throw new Error("Server-Antwort enthält keine gültigen Liniendaten.");
    }

    loadLineFromData(lineData);

    debug("Linie vom Server geladen", {
      city,
      lineId: normalizedLineId
    });

    setStatus(`Linie geladen: ${normalizedLineId} (${city})`);
  } catch (err) {
    error("Fehler beim Laden vom Server", err);
    setStatus(err.message || "Fehler beim Laden vom Server.", "error");
  }
}

// Löscht eine Linie vom Server anhand der ID
async function deleteLineFromServer(lineId = null, skipConfirm = false, lineFolder = null) {
  try {
    if (!lineId) {
      setStatus("Keine Linien-ID zum Löschen übergeben.", "warn");
      return false;
    }

    const city = citySelect?.value || "cottbus";

    let normalizedLineId = lineId;

    if (typeof lineId === "object" && lineId !== null) {
      normalizedLineId =
        lineId.id ||
        (lineId.file ? String(lineId.file).replace(/\.json$/i, "") : "") ||
        "";
    }

    normalizedLineId = String(normalizedLineId || "").replace(/\.json$/i, "").trim();

    if (!normalizedLineId) {
      setStatus("Ungültige Linien-ID zum Löschen.", "error");
      return false;
    }

    if (!skipConfirm) {
      const ok = confirm(
        `Linie wirklich löschen?\n\nOrt: ${city}\nLinie: ${normalizedLineId}\n\nJSON und GPX werden gelöscht.`
      );
      if (!ok) {
        return false;
      }
    }

    const response = await fetch(`${API_BASE}/delete_line.php`, {
      method: "POST",
      headers: withApiAuthHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        city,
        line: normalizedLineId,
        lineFolder: lineFolder || ""
      })
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Linie konnte nicht gelöscht werden.");
    }

    debug("Linie vom Server gelöscht", result);
    setStatus(`Linie gelöscht: ${normalizedLineId} (${city})`);

    return true;
  } catch (err) {
    error("Fehler beim Löschen vom Server", err);
    setStatus(err.message || "Fehler beim Löschen vom Server.", "error");
    return false;
  }
}

// Benennt eine Linie auf dem Server um (lädt, aktualisiert Namen, speichert zurück)
async function renameLineOnServer(line, newLineName, newRouteName, newDirectionName) {
  try {
    const city = line.city || citySelect?.value || "cottbus";
    const fileBase = line.fileBase || line.id || "";
    const lineFolder = line.lineFolder || null;

    if (!fileBase) {
      setStatus("Keine Linien-ID zum Umbenennen.", "error");
      return false;
    }

    const loadRes = await fetch(
      `${API_LOAD_LINE_URL}?city=${encodeURIComponent(city)}&line=${encodeURIComponent(fileBase)}&lineFolder=${encodeURIComponent(lineFolder || "")}`,
      { cache: "no-store" }
    );
    const loadResult = await loadRes.json();

    if (!loadRes.ok || !loadResult.ok) {
      throw new Error(loadResult.error || "Linie konnte nicht geladen werden");
    }

    const lineData = loadResult.line || loadResult.data;
    if (!lineData || typeof lineData !== "object") {
      throw new Error("Keine gültigen Liniendaten erhalten");
    }

    lineData.lineName = newLineName;
    lineData.routeName = newRouteName;
    lineData.directionName = newDirectionName;

    const saveRes = await fetch(API_SAVE_LINE_URL, {
      method: "POST",
      headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(lineData)
    });
    const saveResult = await saveRes.json();

    if (!saveRes.ok || !saveResult.ok) {
      throw new Error(saveResult.error || "Umbenennen konnte nicht gespeichert werden");
    }

    setStatus(`Linie umbenannt: ${newLineName}`);
    return true;
  } catch (err) {
    error("Fehler beim Umbenennen", err);
    setStatus(err.message || "Fehler beim Umbenennen.", "error");
    return false;
  }
}

// Lädt Linien-Daten in den Editor (wird von loadLineFromServer und JSON-Import verwendet)
// Füllt alle Felder und setzt State-Werte
function loadLineFromData(data) {
    if (!data || typeof data !== "object") {
    error("loadLineFromData: ungültige Daten", data);
    setStatus("Linie konnte nicht geladen werden: ungültige Daten.", "error");
    return;
  }
  if (!historyRestoreRunning) {
    pushHistorySnapshot("Linie geladen");
  }

  clearEditorData();

  // Unterstützt sowohl neues Exportformat (1.2) als auch altes Format
  const lineBlock = data.line || data;
  const stopList = data.stops || [];
  const routeOriginal =
    data.route && Array.isArray(data.route.original)
      ? data.route.original
      : (data.routePoints || []);
  const routeSimplified =
    data.route && Array.isArray(data.route.simplified)
      ? data.route.simplified
      : (data.routePointsSimplified || []);

  lineNameInput.value      = String(lineBlock.lineName  || "").replace(/^Linie\s+/i,  "").trim();
  routeNameInput.value     = String(lineBlock.routeName  || "").replace(/^Route\s+/i,  "").trim();
  directionNameInput.value = lineBlock.directionName || "";
  lineColorInput.value = lineBlock.color || "#d32f2f";

  state.routeMode = lineBlock.routeMode || data.routeMode || "auto";
  state.previewMode = "original";

  let maxStopNum = 0;
  let maxRouteNum = 0;

  stopList.forEach(stopData => {
    const stop = addStopToLine({
      name: stopData.name,
      lat: stopData.lat,
      lon: stopData.lon,
      sourceType: stopData.sourceType || "free",
      catalogId: stopData.catalogId || null,
      transitType: stopData.transitType || stopData.type || null,
      directionHint: stopData.directionHint || stopData.direction || null
    });

    stop.id = stopData.id || stop.id;
    stop.groupId = stopData.groupId || stopData.catalogId || null;
    stop.platformCode = stopData.platformCode || null;
    stop.directionHint = stopData.directionHint || null;
    stop.side = stopData.side || null;
    stop.oppositeStopId = stopData.oppositeStopId || null;
    stop.minuteFromStart = Number(stopData.minuteFromStart || 0);
    stop.minuteMode = stopData.minuteMode || "auto";
    stop.note = stopData.note || "";
    updateStopMarkerTooltip(stop);

    const n = Number(String(stop.id).replace("stop_", ""));
    if (!Number.isNaN(n)) maxStopNum = Math.max(maxStopNum, n);
  });

  removeAllRoutePointMarkers();

  routeOriginal.forEach(pointData => {
    let lat;
    let lon;
    let pointId = null;
    let sourceType = "manual";

    if (Array.isArray(pointData)) {
      lat = pointData[0];
      lon = pointData[1];
    } else {
      lat = pointData.lat;
      lon = pointData.lon;
      pointId = pointData.id || null;
      sourceType = pointData.sourceType || "manual";
    }

    const point = createRoutePointObject(lat, lon, true, sourceType);

    if (pointId) {
      point.id = pointId;
    }

    const n = Number(String(point.id).replace("route_", ""));
    if (!Number.isNaN(n)) maxRouteNum = Math.max(maxRouteNum, n);
  });

  state.simplifiedRoutePoints = (routeSimplified || []).map(point => {
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
    lineName: lineBlock.lineName || "",
    stops: state.stops.length,
    routePoints: state.routePoints.length
  });

  setStatus("Linie geladen.");
}

// Lädt eine Linie aus einer lokalen JSON-Datei (File API)
// Wird vom Datei-Upload im Browser verwendet
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
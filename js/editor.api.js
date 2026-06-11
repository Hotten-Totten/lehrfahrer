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

  hafasPlannedDate: stop.hafasPlannedDate || null,
  hafasPlannedTime: stop.hafasPlannedTime || null,
  hafasRealtimeDate: stop.hafasRealtimeDate || null,
  hafasRealtimeTime: stop.hafasRealtimeTime || null,

  note: stop.note || "",
  isGhostPoint: !!stop.isGhostPoint,
  isGhost: !!stop.isGhostPoint,

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
      startTime: state.stops[0]?.hafasRealtimeTime || state.stops[0]?.hafasPlannedTime || null
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
  const SAVE_TARGET_STORAGE_KEY = "lehrfahrer_last_save_target";
  const initialData = buildExportData();
  const initialCity = initialData.city || citySelect?.value || "cottbus";

  // ---------- Bestätigungs-Dialog anzeigen ----------
  const target = await showSaveConfirmDialog({ data: initialData, city: initialCity });
  if (!target) return;

  if (citySelect && target.city) citySelect.value = target.city;
  if (lineNameInput) lineNameInput.value = target.lineSuffix;
  if (routeNameInput) routeNameInput.value = target.routeSuffix;
  if (directionNameInput) directionNameInput.value = target.directionName;

  try {
    localStorage.setItem(SAVE_TARGET_STORAGE_KEY, JSON.stringify(target));
  } catch (_) {
    // Ignorieren, wenn Storage nicht verfügbar ist.
  }

  const data = buildExportData();
  const city = data.city || citySelect?.value || "cottbus";
  const fileBase = data.fileBase || buildLineFileBase();
  const lineFolder = data.lineFolder || buildLineFolder();

  let forceOverwrite = false;
  const existingEntry = await findExistingLineEntry(city, lineFolder, fileBase);
  if (existingEntry) {
    const overwriteOk = confirm(
      `Diese Datei existiert bereits:\n${lineFolder}/${fileBase}.json\n\nWirklich überschreiben?`
    );
    if (!overwriteOk) {
      setStatus("Speichern abgebrochen (Überschreiben nicht bestätigt).", "warn");
      return;
    }
    forceOverwrite = true;
  }

  // ---------- Tatsächlich speichern ----------
  await _doSaveLineToServer(data, city, fileBase, lineFolder, forceOverwrite);
}

// Zeigt den Speichern-Dialog und wartet auf Bestätigung (Promise<object|null>)
function showSaveConfirmDialog({ data, city }) {
  const SAVE_TARGET_STORAGE_KEY = "lehrfahrer_last_save_target";
  return new Promise(resolve => {
    const modal   = document.getElementById("saveConfirmModal");
    const okBtn   = document.getElementById("saveConfirmOkBtn");
    const cancelBtn = document.getElementById("saveConfirmCancelBtn");
    const cityPicker = document.getElementById("saveConfirmCitySelect");
    const lineInput = document.getElementById("saveConfirmLineInput");
    const routeInput = document.getElementById("saveConfirmRouteInput");
    const directionInput = document.getElementById("saveConfirmDirectionInput");
    const fileInfo = document.getElementById("saveConfirmFile");

    let lastTarget = null;
    try {
      lastTarget = JSON.parse(localStorage.getItem(SAVE_TARGET_STORAGE_KEY) || "null");
    } catch (_) {
      lastTarget = null;
    }

    const initialLine = String(lastTarget?.lineSuffix ?? lineNameInput?.value ?? "").trim();
    const initialRoute = String(lastTarget?.routeSuffix ?? routeNameInput?.value ?? "").trim();
    const initialDirection = String(lastTarget?.directionName ?? directionNameInput?.value ?? "").trim();
    const initialTargetCity = String(lastTarget?.city || city || "").trim() || "cottbus";

    cityPicker.innerHTML = "";
    if (citySelect && citySelect.options) {
      Array.from(citySelect.options).forEach(opt => {
        const clone = document.createElement("option");
        clone.value = opt.value;
        clone.textContent = opt.textContent;
        cityPicker.appendChild(clone);
      });
    }
    cityPicker.value = initialTargetCity || cityPicker.value || "cottbus";

    lineInput.value = initialLine;
    routeInput.value = initialRoute;
    directionInput.value = initialDirection;

    function updateFilePreview() {
      const lineSuffix = String(lineInput.value || "").trim();
      const routeSuffix = String(routeInput.value || "").trim();
      const directionName = String(directionInput.value || "").trim();

      const linePart = lineSuffix ? "Linie_" + lineSuffix : "Linie";
      const routePart = routeSuffix ? "Route_" + routeSuffix : "";
      const rawBase = [linePart, routePart, directionName].filter(Boolean).join("_");

      const fileBase = sanitizeFilename(rawBase || "Linie");
      const lineFolder = sanitizeFilename(lineSuffix ? "Linie_" + lineSuffix : "Linie");

      fileInfo.textContent = (lineFolder ? lineFolder + "/" : "") + fileBase + ".json / .gpx / .pdf";
    }

    updateFilePreview();

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
      cityPicker.removeEventListener("change", updateFilePreview);
      lineInput.removeEventListener("input", updateFilePreview);
      routeInput.removeEventListener("input", updateFilePreview);
      directionInput.removeEventListener("input", updateFilePreview);
      resolve(result);
    }
    function onOk() {
      const lineSuffix = String(lineInput.value || "").trim();
      const routeSuffix = String(routeInput.value || "").trim();
      if (!lineSuffix || !routeSuffix) {
        const proceed = confirm(
          "Linie oder Route ist leer. Möchtest du trotzdem speichern?"
        );
        if (!proceed) {
          return;
        }
      }

      cleanup({
        city: String(cityPicker.value || "").trim() || "cottbus",
        lineSuffix,
        routeSuffix,
        directionName: String(directionInput.value || "").trim()
      });
    }
    function onCancel()  { cleanup(null); }
    function onOverlay(e){ if (e.target === modal) cleanup(null); }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onOverlay);
    cityPicker.addEventListener("change", updateFilePreview);
    lineInput.addEventListener("input", updateFilePreview);
    routeInput.addEventListener("input", updateFilePreview);
    directionInput.addEventListener("input", updateFilePreview);
  });
}

async function findExistingLineEntry(city, lineFolder, fileBase) {
  try {
    const params = new URLSearchParams();
    params.set("city", String(city || "").trim());
    params.set("_ts", String(Date.now()));

    const response = await fetch(
      `${API_LIST_LINES_URL}?${params.toString()}`,
      { cache: "no-store" }
    );
    const result = await response.json();

    if (!response.ok || !result?.ok || !Array.isArray(result.lines)) {
      return null;
    }

    const wantedFolder = String(lineFolder || "").trim().toLowerCase();
    const wantedBase = String(fileBase || "").trim().toLowerCase();

    return result.lines.find(entry => {
      const entryFolder = String(entry?.lineFolder || "").trim().toLowerCase();
      const entryBase = String(entry?.fileBase || "").trim().toLowerCase();
      return entryFolder === wantedFolder && entryBase === wantedBase;
    }) || null;
  } catch (err) {
    warn("Konnte bestehende Datei vor dem Speichern nicht prüfen: " + err.message);
    return null;
  }
}

// Führt den eigentlichen Speicher-Vorgang durch (intern)
async function _doSaveLineToServer(data, city, fileBase, lineFolder, forceOverwrite = false) {
  try {
    setStatus("Speichern …");

    const payload = {
      ...data,
      forceOverwrite: !!forceOverwrite
    };

    // ---------- JSON speichern ----------
    const response = await fetch(API_SAVE_LINE_URL, {
      method: "POST",
      headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
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
    const pdfSaved = !!result.pdfSaved;
    const pdfError = (result.pdfError || "").toString().trim();
    const pdfPath = (result.pdfPath || "").toString().trim();
    const pdfTriedPaths = Array.isArray(result.pdfTriedPaths) ? result.pdfTriedPaths : [];
    try {
      const gpxResult = await saveGpxToServer(`${actualFileBase}.gpx`, gpx, city, lineFolder);
      gpxSaved = !!(gpxResult && gpxResult.ok !== false);
    } catch (gpxErr) {
      warn("GPX konnte nicht gespeichert werden: " + gpxErr.message);
    }

    debug("Linie + GPX + PDF auf Server gespeichert", {
      json: result,
      gpxSaved,
      pdfSaved,
      pdfError,
      pdfPath,
      pdfTriedPaths,
      city,
      fileBase: actualFileBase,
      lineFolder
    });

    if (!pdfSaved) {
      warn("PDF konnte nicht gespeichert werden" + (pdfError ? ": " + pdfError : ""));
    }

    if (typeof showSaveToast === "function") {
      showSaveToast({
        fileBase: actualFileBase,
        city,
        stopCount: state.stops.length,
        routePointCount: state.routePoints.length,
        gpxSaved,
        pdfSaved,
        savedAt: result.savedAt || new Date().toISOString()
      });
    }
    setStatus(`Gespeichert: ${lineFolder}/${actualFileBase}.json${gpxSaved ? " + .gpx" : ""}${pdfSaved ? " + .pdf" : ""} (${city})${pdfSaved && pdfPath ? " - PDF: " + pdfPath : ""}${!pdfSaved && pdfError ? " - PDF-Fehler: " + pdfError : ""}`);
  } catch (err) {
    error("Fehler beim Server-Speichern", err);
    setStatus(err.message || "Fehler beim Speichern auf Server.", "error");
  }
}

let vbbImportAutoCloseTimer = null;
const VBB_ACCESS_ID_STORAGE_KEY = "lehrfahrer_vbb_access_id";

function getStoredVbbAccessId() {
  try {
    return String(localStorage.getItem(VBB_ACCESS_ID_STORAGE_KEY) || "").trim();
  } catch (_) {
    return "";
  }
}

function setStoredVbbAccessId(accessId) {
  const value = String(accessId || "").trim();
  if (!value) return false;
  try {
    localStorage.setItem(VBB_ACCESS_ID_STORAGE_KEY, value);
    return true;
  } catch (_) {
    return false;
  }
}

function clearStoredVbbAccessId() {
  try {
    localStorage.removeItem(VBB_ACCESS_ID_STORAGE_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

function setVbbAccessIdViaPrompt() {
  const current = getStoredVbbAccessId();
  const input = prompt(
    "VBB Access-ID eingeben (wird lokal im Browser gespeichert):",
    current || ""
  );
  if (input === null) return;

  const accessId = String(input || "").trim();
  if (!accessId) {
    setStatus("Keine VBB Access-ID eingegeben.", "warn");
    return;
  }

  if (!setStoredVbbAccessId(accessId)) {
    setStatus("VBB Access-ID konnte nicht gespeichert werden.", "error");
    return;
  }

  setStatus("VBB Access-ID lokal gespeichert.", "success");
}

function clearVbbAccessIdViaPrompt() {
  const current = getStoredVbbAccessId();
  if (!current) {
    setStatus("Keine VBB Access-ID gespeichert.", "warn");
    return;
  }

  if (!confirm("Gespeicherte VBB Access-ID lokal löschen?")) {
    return;
  }

  if (!clearStoredVbbAccessId()) {
    setStatus("VBB Access-ID konnte nicht gelöscht werden.", "error");
    return;
  }

  setStatus("VBB Access-ID lokal gelöscht.", "success");
}

function getVbbImportModalRefs() {
  return {
    modal: document.getElementById("vbbImportModal"),
    box: document.querySelector("#vbbImportModal .vbb-import-box"),
    title: document.getElementById("vbbImportTitle"),
    subtitle: document.getElementById("vbbImportSubtitle"),
    message: document.getElementById("vbbImportMessage"),
    timeline: document.getElementById("vbbImportTimeline"),
    spinner: document.getElementById("vbbImportSpinner"),
    closeBtn: document.getElementById("vbbImportCloseBtn"),
    picker: document.getElementById("vbbImportCandidatePicker"),
    pickerHint: document.getElementById("vbbImportCandidateHint"),
    pickerList: document.getElementById("vbbImportCandidateList"),
    pickerSelectBtn: document.getElementById("vbbImportCandidateSelectBtn"),
    pickerCancelBtn: document.getElementById("vbbImportCandidateCancelBtn"),
    searchOptions: document.getElementById("vbbImportSearchOptions"),
    searchDayToday: document.getElementById("vbbSearchDayToday"),
    searchDayTomorrow: document.getElementById("vbbSearchDayTomorrow"),
    searchAllDay: document.getElementById("vbbSearchAllDay"),
    searchTimeInput: document.getElementById("vbbSearchTimeInput"),
    searchStartBtn: document.getElementById("vbbSearchStartBtn"),
    searchCancelBtn: document.getElementById("vbbSearchCancelBtn")
  };
}

function hideVbbCandidatePicker() {
  const refs = getVbbImportModalRefs();
  if (refs.picker) refs.picker.classList.add("hidden");
  if (refs.pickerList) refs.pickerList.innerHTML = "";
  if (refs.pickerHint) refs.pickerHint.textContent = "Treffer auswählen";
  if (refs.pickerSelectBtn) refs.pickerSelectBtn.disabled = true;
}

function hideVbbSearchOptions() {
  const refs = getVbbImportModalRefs();
  if (refs.searchOptions) refs.searchOptions.classList.add("hidden");
}

function closeVbbImportProgressPopup() {
  const refs = getVbbImportModalRefs();
  if (!refs.modal) return;

  if (vbbImportAutoCloseTimer) {
    clearTimeout(vbbImportAutoCloseTimer);
    vbbImportAutoCloseTimer = null;
  }

  hideVbbCandidatePicker();
  refs.modal.classList.add("hidden");
}

function showVbbImportProgressPopup(lineQuery) {
  const refs = getVbbImportModalRefs();
  if (!refs.modal || !refs.box) return;

  if (vbbImportAutoCloseTimer) {
    clearTimeout(vbbImportAutoCloseTimer);
    vbbImportAutoCloseTimer = null;
  }

  refs.modal.classList.remove("hidden");
  refs.modal.setAttribute("aria-busy", "true");
  refs.box.classList.remove("vbb-import-state-success", "vbb-import-state-warn", "vbb-import-state-error");
  refs.box.classList.add("vbb-import-state-info");

  if (refs.title) refs.title.textContent = `VBB-Import Linie ${lineQuery}`;
  if (refs.subtitle) refs.subtitle.textContent = "Import wird vorbereitet …";
  if (refs.message) refs.message.textContent = "Startet …";
  if (refs.timeline) refs.timeline.innerHTML = "";
  if (refs.spinner) refs.spinner.classList.remove("hidden");
  hideVbbCandidatePicker();
  hideVbbSearchOptions();

  if (refs.closeBtn) {
    refs.closeBtn.disabled = true;
    refs.closeBtn.onclick = closeVbbImportProgressPopup;
  }
}

function updateVbbImportProgressPopup(stepText, options = {}) {
  const {
    level = "info",
    busy = true,
    subtitle = "",
    allowClose = false,
    autoCloseMs = 0
  } = options;

  const refs = getVbbImportModalRefs();
  if (!refs.modal || !refs.box) return;

  refs.modal.classList.remove("hidden");
  refs.modal.setAttribute("aria-busy", busy ? "true" : "false");

  refs.box.classList.remove("vbb-import-state-info", "vbb-import-state-success", "vbb-import-state-warn", "vbb-import-state-error");
  refs.box.classList.add(`vbb-import-state-${level}`);

  if (refs.subtitle && subtitle) {
    refs.subtitle.textContent = subtitle;
  }
  if (refs.message) {
    refs.message.textContent = stepText;
  }

  if (refs.spinner) {
    refs.spinner.classList.toggle("hidden", !busy);
  }

  if (refs.closeBtn) {
    refs.closeBtn.disabled = !allowClose;
  }

  if (refs.timeline) {
    const line = document.createElement("div");
    const now = new Date();
    const stamp = now.toLocaleTimeString("de-DE", { hour12: false });
    line.className = `vbb-import-line vbb-line-${level}`;
    line.textContent = `[${stamp}] ${stepText}`;
    refs.timeline.appendChild(line);
    refs.timeline.scrollTop = refs.timeline.scrollHeight;
  }

  if (vbbImportAutoCloseTimer) {
    clearTimeout(vbbImportAutoCloseTimer);
    vbbImportAutoCloseTimer = null;
  }
  if (autoCloseMs > 0) {
    vbbImportAutoCloseTimer = setTimeout(() => {
      closeVbbImportProgressPopup();
    }, autoCloseMs);
  }
}

function formatVbbCandidateMeta(entry) {
  const product = String(entry?.product || "").trim();
  const startStop = String(entry?.startStop || entry?.origin || "").trim();
  const destination = String(entry?.destination || entry?.direction || "").trim();
  const time = String(entry?.time || "").trim();
  const routeLabel = (startStop && destination) ? `${startStop} -> ${destination}` : (destination || startStop);
  const parts = [routeLabel, product, time].filter(Boolean);
  return parts.join(" | ");
}

function chooseVbbSearchOptionsInPopup() {
  const refs = getVbbImportModalRefs();
  if (!refs.searchOptions || !refs.searchStartBtn || !refs.searchCancelBtn || !refs.closeBtn) {
    return Promise.resolve({ searchDate: null, searchTime: null, allDay: true });
  }

  refs.searchOptions.classList.remove("hidden");
  if (refs.searchDayToday) refs.searchDayToday.checked = true;
  if (refs.searchDayTomorrow) refs.searchDayTomorrow.checked = false;
  if (refs.searchAllDay) refs.searchAllDay.checked = true;
  if (refs.searchTimeInput) {
    refs.searchTimeInput.disabled = true;
    refs.searchTimeInput.value = refs.searchTimeInput.value || "08:00";
  }

  const updateTimeEnabled = () => {
    if (!refs.searchTimeInput || !refs.searchAllDay) return;
    refs.searchTimeInput.disabled = !!refs.searchAllDay.checked;
  };

  if (refs.searchAllDay) {
    refs.searchAllDay.addEventListener("change", updateTimeEnabled);
  }

  return new Promise((resolve) => {
    const prevCloseHandler = refs.closeBtn.onclick;

    const cleanup = () => {
      if (refs.searchAllDay) {
        refs.searchAllDay.removeEventListener("change", updateTimeEnabled);
      }
      refs.searchStartBtn.removeEventListener("click", onStart);
      refs.searchCancelBtn.removeEventListener("click", onCancel);
      refs.closeBtn.onclick = prevCloseHandler;
    };

    const finish = (value) => {
      cleanup();
      hideVbbSearchOptions();
      resolve(value);
    };

    const onStart = () => {
      const allDay = !!refs.searchAllDay?.checked;
      const dayOffset = refs.searchDayTomorrow?.checked ? 1 : 0;
      const dateObj = new Date();
      dateObj.setDate(dateObj.getDate() + dayOffset);
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
      const dd = String(dateObj.getDate()).padStart(2, "0");
      const searchDate = `${yyyy}-${mm}-${dd}`;

      let searchTime = null;
      if (!allDay) {
        const raw = String(refs.searchTimeInput?.value || "").trim();
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(raw)) {
          setStatus("Ungültige Uhrzeit. Bitte HH:MM verwenden.", "warn");
          return;
        }
        searchTime = raw;
      }

      finish({ searchDate, searchTime, allDay });
    };

    const onCancel = () => finish(null);

    refs.searchStartBtn.addEventListener("click", onStart);
    refs.searchCancelBtn.addEventListener("click", onCancel);
    refs.closeBtn.onclick = () => {
      finish(null);
      closeVbbImportProgressPopup();
    };
  });
}

function chooseVbbCandidateInPopup(candidates) {
  const refs = getVbbImportModalRefs();
  if (!refs.picker || !refs.pickerList || !refs.pickerSelectBtn || !refs.pickerCancelBtn || !refs.closeBtn) {
    return Promise.resolve(candidates?.[0] || null);
  }

  refs.picker.classList.remove("hidden");
  refs.pickerList.innerHTML = "";
  refs.pickerSelectBtn.disabled = true;
  if (refs.pickerHint) {
    refs.pickerHint.textContent = `${candidates.length} Treffer gefunden. Bitte Fahrt auswählen.`;
  }

  let selectedId = "";
  const groupName = `vbb-candidate-${Date.now()}`;

  candidates.forEach((entry, idx) => {
    const row = document.createElement("label");
    row.className = "vbb-candidate-row";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = groupName;
    radio.value = String(entry.id || "");

    if (idx === 0) {
      radio.checked = true;
      selectedId = radio.value;
      refs.pickerSelectBtn.disabled = !selectedId;
    }

    const textWrap = document.createElement("div");
    const main = document.createElement("div");
    main.className = "vbb-candidate-main";
    main.textContent = `${idx + 1}. ${String(entry.name || "Linie")}`;

    const meta = document.createElement("div");
    meta.className = "vbb-candidate-meta";
    meta.textContent = formatVbbCandidateMeta(entry);

    textWrap.appendChild(main);
    textWrap.appendChild(meta);

    radio.addEventListener("change", () => {
      if (radio.checked) {
        selectedId = radio.value;
        refs.pickerSelectBtn.disabled = !selectedId;
      }
    });

    row.appendChild(radio);
    row.appendChild(textWrap);
    refs.pickerList.appendChild(row);
  });

  return new Promise((resolve) => {
    const prevCloseHandler = refs.closeBtn.onclick;

    const cleanup = () => {
      refs.pickerSelectBtn.removeEventListener("click", onSelect);
      refs.pickerCancelBtn.removeEventListener("click", onCancel);
      refs.closeBtn.onclick = prevCloseHandler;
    };

    const finish = (value) => {
      cleanup();
      hideVbbCandidatePicker();
      resolve(value);
    };

    const onSelect = () => {
      const chosen = candidates.find(item => String(item.id || "") === selectedId) || null;
      finish(chosen);
    };

    const onCancel = () => finish(null);

    refs.pickerSelectBtn.addEventListener("click", onSelect);
    refs.pickerCancelBtn.addEventListener("click", onCancel);
    refs.closeBtn.onclick = () => {
      finish(null);
      closeVbbImportProgressPopup();
    };
  });
}

async function importLineFromVbbPrompt() {
  try {
    const lineQueryRaw = prompt("Welche VBB-Linie soll importiert werden?\nBeispiel: 10");
    if (lineQueryRaw === null) {
      return;
    }

    const lineQuery = String(lineQueryRaw || "").trim();
    if (!lineQuery) {
      setStatus("VBB-Import abgebrochen: keine Linie eingegeben.", "warn");
      return;
    }

    showVbbImportProgressPopup(lineQuery);
    updateVbbImportProgressPopup("Bitte Suchoptionen wählen …", {
      level: "info",
      busy: false,
      subtitle: "VBB-Suche"
    });

    const options = await chooseVbbSearchOptionsInPopup();
    if (!options) {
      updateVbbImportProgressPopup("VBB-Import abgebrochen.", {
        level: "warn",
        busy: false,
        allowClose: true,
        subtitle: "Abgebrochen",
        autoCloseMs: 4500
      });
      setStatus("VBB-Import abgebrochen.", "warn");
      return;
    }

    const searchDate = String(options.searchDate || "").trim();
    const searchTime = options.searchTime ? String(options.searchTime).trim() : "";
    const allDay = !!options.allDay;
    const dateLabel = searchDate ? searchDate : "heute";
    const modeLabel = allDay ? `ganztägig (${dateLabel})` : `ab ${searchTime} (${dateLabel})`;

    updateVbbImportProgressPopup(`Suche läuft für Linie ${lineQuery} ${modeLabel} …`, {
      level: "info",
      busy: true,
      subtitle: "VBB-Suche"
    });
    setStatus(`VBB-Suche läuft für Linie ${lineQuery} ${modeLabel} …`);

    const city = String(citySelect?.value || "cottbus").trim() || "cottbus";
    const headers = withApiAuthHeaders({ "Content-Type": "application/json" });

    let accessIdOverride = getStoredVbbAccessId();

    async function postVbb(action, extra = {}) {
      const payload = {
        action,
        lineQuery,
        city,
        ...extra
      };
      if (accessIdOverride) {
        payload.accessId = accessIdOverride;
      }
      if (searchDate) {
        payload.searchDate = searchDate;
      }
      payload.allDay = !!allDay;
      if (!allDay && searchTime) {
        payload.searchTime = searchTime;
      }

      const response = await fetch(API_VBB_IMPORT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      return { response, result };
    }

    let { response: searchRes, result: searchResult } = await postVbb("search");
    const searchErrorText = String(searchResult?.error || "").toLowerCase();
    const missingAccessId = searchErrorText.includes("access-id fehlt") || searchErrorText.includes("access id fehlt");

    if ((!searchRes.ok || !searchResult.ok) && missingAccessId) {
      updateVbbImportProgressPopup("Access-ID wird benötigt. Bitte Eingabe bestätigen …", {
        level: "warn",
        busy: false,
        subtitle: "Zugangsdaten"
      });
      const enteredAccessId = prompt(
        "VBB Access-ID fehlt auf dem Server.\nBitte hier eingeben (wird optional lokal im Browser gespeichert):"
      );
      if (enteredAccessId === null) {
        updateVbbImportProgressPopup("VBB-Import abgebrochen (keine Access-ID eingegeben).", {
          level: "warn",
          busy: false,
          allowClose: true,
          subtitle: "Abgebrochen",
          autoCloseMs: 5000
        });
        setStatus("VBB-Import abgebrochen (keine Access-ID eingegeben).", "warn");
        return;
      }

      accessIdOverride = String(enteredAccessId || "").trim();
      if (!accessIdOverride) {
        updateVbbImportProgressPopup("VBB-Import abgebrochen (leere Access-ID).", {
          level: "warn",
          busy: false,
          allowClose: true,
          subtitle: "Abgebrochen",
          autoCloseMs: 5000
        });
        setStatus("VBB-Import abgebrochen (leere Access-ID).", "warn");
        return;
      }

      setStoredVbbAccessId(accessIdOverride);

      updateVbbImportProgressPopup("Access-ID gespeichert. Suche wird erneut gestartet …", {
        level: "info",
        busy: true,
        subtitle: "VBB-Suche"
      });
      ({ response: searchRes, result: searchResult } = await postVbb("search"));
    }

    if (!searchRes.ok || !searchResult.ok) {
      throw new Error(searchResult.error || "VBB-Liniensuche fehlgeschlagen");
    }

    const candidates = Array.isArray(searchResult.candidates) ? searchResult.candidates : [];
    if (!candidates.length) {
      updateVbbImportProgressPopup(`Keine VBB-Linie gefunden für: ${lineQuery}`, {
        level: "warn",
        busy: false,
        allowClose: true,
        subtitle: "Keine Treffer",
        autoCloseMs: 6500
      });
      setStatus(`Keine VBB-Linie gefunden für: ${lineQuery}`, "warn");
      return;
    }

    const serverSearchTime = String(searchResult?.searchTime || "").trim();
    const serverSearchDate = String(searchResult?.searchDate || "").trim();
    const serverAllDay = !!searchResult?.allDay;
    const serverLabel = serverAllDay
      ? `${serverSearchDate || "heute"}, ganztägig`
      : (serverSearchTime ? `${serverSearchDate || "heute"} ab ${serverSearchTime}` : "");
    updateVbbImportProgressPopup(
      `${candidates.length} Treffer gefunden${serverLabel ? ` (${serverLabel})` : ""}. Auswahl im Popup …`,
      {
      level: "info",
      busy: false,
      subtitle: "Trefferliste"
    });

    const selected = await chooseVbbCandidateInPopup(candidates);
    if (!selected) {
      updateVbbImportProgressPopup("VBB-Import abgebrochen.", {
        level: "warn",
        busy: false,
        allowClose: true,
        subtitle: "Abgebrochen",
        autoCloseMs: 5000
      });
      setStatus("VBB-Import abgebrochen.", "warn");
      return;
    }

    updateVbbImportProgressPopup(`Fahrt ${selected.name} wird geladen …`, {
      level: "info",
      busy: true,
      subtitle: "Import läuft"
    });

    const { response: importRes, result: importResult } = await postVbb("import", {
      lineId: selected.id
    });
    if (!importRes.ok || !importResult.ok) {
      throw new Error(importResult.error || "VBB-Import fehlgeschlagen");
    }

    if (!importResult.line || typeof importResult.line !== "object") {
      throw new Error("VBB-Import lieferte keine gültigen Liniendaten.");
    }

    loadLineFromData(importResult.line);
    updateVbbImportProgressPopup(`Import abgeschlossen: ${selected.name} (${importResult.stopCount || 0} Stops)`, {
      level: "success",
      busy: false,
      allowClose: true,
      subtitle: "Daten geladen"
    });

    // Nach dem VBB-Import automatisch Straßenroute erzeugen, damit keine grobe Luftlinie bleibt.
    if (typeof buildStreetRouteFromStops === "function") {
      updateVbbImportProgressPopup("Straßenroute wird automatisch berechnet …", {
        level: "info",
        busy: true,
        allowClose: false,
        subtitle: "Nachbearbeitung"
      });

      try {
        await buildStreetRouteFromStops();
      } catch (routeErr) {
        warn("Automatisches Straßenrouting nach VBB-Import fehlgeschlagen: " + routeErr.message);
      }

      const routePointCount = Array.isArray(state.routePoints) ? state.routePoints.length : 0;
      const hasStreetRoute = state.routeMode === "street" && routePointCount > Math.max(2, state.stops.length);

      if (hasStreetRoute) {
        updateVbbImportProgressPopup(`Import + Straßenroute fertig (${state.stops.length} Stops, ${routePointCount} Routenpunkte)`, {
          level: "success",
          busy: false,
          allowClose: true,
          subtitle: "Fertig",
          autoCloseMs: 5500
        });
        setStatus(`VBB-Import + Straßenroute fertig: ${selected.name} (${state.stops.length} Stops, ${routePointCount} Punkte)`);
      } else {
        updateVbbImportProgressPopup("Import fertig, aber Straßenroute konnte nicht vollständig erzeugt werden. Du kannst sie über 'Route zeichnen' neu berechnen.", {
          level: "warn",
          busy: false,
          allowClose: true,
          subtitle: "Teilweise fertig",
          autoCloseMs: 7000
        });
        setStatus(`VBB-Import fertig: ${selected.name} (${importResult.stopCount || 0} Stops). Straßenroute bitte ggf. manuell erzeugen.`, "warn");
      }
    } else {
      updateVbbImportProgressPopup(`Import abgeschlossen: ${selected.name} (${importResult.stopCount || 0} Stops)`, {
        level: "success",
        busy: false,
        allowClose: true,
        subtitle: "Fertig",
        autoCloseMs: 4500
      });
      setStatus(`VBB-Import fertig: ${selected.name} (${importResult.stopCount || 0} Stops)`);
    }
  } catch (err) {
    error("VBB-Import fehlgeschlagen", err);
    updateVbbImportProgressPopup(err.message || "VBB-Import fehlgeschlagen.", {
      level: "error",
      busy: false,
      allowClose: true,
      subtitle: "Fehler"
    });
    setStatus(err.message || "VBB-Import fehlgeschlagen.", "error");
  }
}

// Lädt die Liste aller gespeicherten Linien vom Server
// Wird für den Linien-Browser verwendet
async function fetchLineListFromServer(cityFilter = null) {
  try {
    const city = cityFilter === null
      ? String(citySelect?.value || "").trim()
      : String(cityFilter || "").trim();
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
async function loadLineFromServer(lineId = null, lineFolder = null, cityOverride = null) {
  try {
    if (!lineId) {
      setStatus("Keine Linien-ID übergeben.", "warn");
      return;
    }

    const city = String(cityOverride || citySelect?.value || "cottbus").trim() || "cottbus";

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
async function deleteLineFromServer(lineId = null, skipConfirm = false, lineFolder = null, cityOverride = null) {
  try {
    if (!lineId) {
      setStatus("Keine Linien-ID zum Löschen übergeben.", "warn");
      return false;
    }

    const city = String(cityOverride || citySelect?.value || "cottbus").trim() || "cottbus";

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
        `Linie wirklich löschen?\n\nOrt: ${city}\nLinie: ${normalizedLineId}\n\nJSON, GPX und PDF werden gelöscht.`
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
      directionHint: stopData.directionHint || stopData.direction || null,
      isGhostPoint: !!(
        stopData.isGhostPoint ||
        stopData.isGhost ||
        stopData.sourceType === "ghost" ||
        (
          (stopData.sourceType || "free") === "free" &&
          /^Freie Haltestelle\s+\d+$/i.test(String(stopData.name || ""))
        )
      )
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
    stop.hafasPlannedDate = stopData.hafasPlannedDate || null;
    stop.hafasPlannedTime = stopData.hafasPlannedTime || null;
    stop.hafasRealtimeDate = stopData.hafasRealtimeDate || null;
    stop.hafasRealtimeTime = stopData.hafasRealtimeTime || null;
    stop.isGhostPoint = !!(
      stopData.isGhostPoint ||
      stopData.isGhost ||
      stopData.sourceType === "ghost" ||
      (
        (stopData.sourceType || "free") === "free" &&
        /^Freie Haltestelle\s+\d+$/i.test(String(stopData.name || ""))
      )
    );
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
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
  const adapter = window.EditorMapAdapter;
  const center = adapter && typeof adapter.getEditorCenter === "function"
    ? adapter.getEditorCenter()
    : map.getCenter();
  const zoom = adapter && typeof adapter.getEditorZoom === "function"
    ? adapter.getEditorZoom()
    : map.getZoom();

  return {
    centerLat: Number(center.lat.toFixed(6)),
    centerLon: Number((center.lon ?? center.lng).toFixed(6)),
    zoom
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
  const routeSuffix = String(routeNameInput.value || "").trim();
  const directionName = String(directionNameInput.value || "").trim();
  const variantName = String(variantNameInput?.value || "").trim();

  const routePart = routeSuffix ? "Route_"  + routeSuffix : "";
  const variantPart = variantName || directionName;

  const raw = [routePart, variantPart].filter(Boolean).join("_");
  return sanitizeFilename(raw || "Route");
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
  const description    = getLineDescription();
  const { validFrom, validUntil } = getLineValidity();
  const variantName    = getVariantName(routeSuffix ? "Route " + routeSuffix : "", directionName);
  const variantCategory = getVariantCategory();
  const categoryFolder = sanitizeFilename(variantCategory || "Standard") || "Standard";

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
  isDetourReplacement: !!stop.isDetourReplacement,
  detourId: stop.detourId || null,
  detourRole: stop.detourRole || null,
  detourOriginalStopIds: Array.isArray(stop.detourOriginalStopIds) ? [...stop.detourOriginalStopIds] : [],
  detourOriginalStopNames: Array.isArray(stop.detourOriginalStopNames) ? [...stop.detourOriginalStopNames] : [],

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
    categoryFolder,

    // =====================================
    // ALT-KOMPATIBEL für bestehendes PHP
    // =====================================
    id: lineId,
    lineName,
    routeName,
    directionName,
    description,
    validFrom,
    validUntil,
    variantName,
    variantCategory,
    categoryFolder,
    color: lineColorInput.value,
    routeMode: state.routeMode,
    placementMode: normalizeEditorPlacementMode(state.placementMode, state.routeMode),
    routingMode: normalizeEditorRoutingMode(state.routingMode),
    preserveManualChains: !!state.preserveManualChains,
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
      description,
      validFrom,
      validUntil,
      variantName,
      variantCategory,
      categoryFolder,
      startStopName: startStop ? startStop.name : "",
      endStopName: endStop ? endStop.name : "",
      color: lineColorInput.value,
      routeMode: state.routeMode,
      placementMode: normalizeEditorPlacementMode(state.placementMode, state.routeMode),
      routingMode: normalizeEditorRoutingMode(state.routingMode),
      preserveManualChains: !!state.preserveManualChains
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
  setVariantName(target.variantName, target.routeSuffix ? "Route " + target.routeSuffix : "", target.directionName);
  setVariantCategory(target.variantCategory);
  if (directionNameInput) directionNameInput.value = target.directionName;
  setLineDescription(target.description);
  setLineValidity(target.validFrom, target.validUntil);

  try {
    localStorage.setItem(SAVE_TARGET_STORAGE_KEY, JSON.stringify(target));
  } catch (_) {
    // Ignorieren, wenn Storage nicht verfügbar ist.
  }

  const data = buildExportData();
  const city = data.city || citySelect?.value || "cottbus";
  const fileBase = data.fileBase || buildLineFileBase();
  const lineFolder = data.lineFolder || buildLineFolder();
  const categoryFolder = data.categoryFolder || sanitizeFilename(data.variantCategory || "Standard") || "Standard";

  let forceOverwrite = false;
  const existingEntry = await findExistingLineEntry(city, lineFolder, categoryFolder, fileBase);
  if (existingEntry) {
    const overwriteOk = confirm(
      `Diese Datei existiert bereits:\n${lineFolder}/${categoryFolder}/${fileBase}.json\n\nWirklich überschreiben?`
    );
    if (!overwriteOk) {
      setStatus("Speichern abgebrochen (Überschreiben nicht bestätigt).", "warn");
      return;
    }
    forceOverwrite = true;
  }

  // ---------- Tatsächlich speichern ----------
  await _doSaveLineToServer(data, city, fileBase, lineFolder, categoryFolder, forceOverwrite);
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
    const variantInput = document.getElementById("saveConfirmVariantInput");
    const variantCategorySelect = document.getElementById("saveConfirmVariantCategorySelect");
    const directionInput = document.getElementById("saveConfirmDirectionInput");
    const descriptionInput = document.getElementById("saveConfirmDescriptionInput");
    const validFromDialogInput = document.getElementById("saveConfirmValidFromInput");
    const validUntilDialogInput = document.getElementById("saveConfirmValidUntilInput");
    const fileInfo = document.getElementById("saveConfirmFile");

    let lastTarget = null;
    try {
      lastTarget = JSON.parse(localStorage.getItem(SAVE_TARGET_STORAGE_KEY) || "null");
    } catch (_) {
      lastTarget = null;
    }

    const initialLine = String(lineNameInput?.value ?? lastTarget?.lineSuffix ?? "").trim();
    const initialRoute = String(routeNameInput?.value ?? lastTarget?.routeSuffix ?? "").trim();
    const initialDirection = String(directionNameInput?.value ?? lastTarget?.directionName ?? "").trim();
    const initialVariantName = String(getVariantName(initialRoute ? "Route " + initialRoute : "", initialDirection) || data.variantName || data.line?.variantName || lastTarget?.variantName || "").trim();
    const initialVariantCategory = normalizeVariantCategory(getVariantCategory() || data.variantCategory || data.line?.variantCategory || lastTarget?.variantCategory);
    const initialDescription = String(getLineDescription() || data.description || data.line?.description || lastTarget?.description || "").trim();
    const currentValidity = getLineValidity();
    const initialValidFrom = String(currentValidity.validFrom || data.validFrom || data.line?.validFrom || lastTarget?.validFrom || "").trim();
    const initialValidUntil = String(currentValidity.validUntil || data.validUntil || data.line?.validUntil || lastTarget?.validUntil || "").trim();
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
    if (variantInput) variantInput.value = initialVariantName;
    if (variantCategorySelect) {
      variantCategorySelect.value = initialVariantCategory;
      if (variantCategorySelect.value !== initialVariantCategory) {
        const option = document.createElement("option");
        option.value = initialVariantCategory;
        option.textContent = initialVariantCategory;
        variantCategorySelect.appendChild(option);
        variantCategorySelect.value = initialVariantCategory;
      }
    }
    directionInput.value = initialDirection;
    if (descriptionInput) descriptionInput.value = initialDescription;
    if (validFromDialogInput) validFromDialogInput.value = initialValidFrom;
    if (validUntilDialogInput) validUntilDialogInput.value = initialValidUntil;

    function updateFilePreview() {
      const lineSuffix = String(lineInput.value || "").trim();
      const routeSuffix = String(routeInput.value || "").trim();
      const directionName = String(directionInput.value || "").trim();
      const variantName = String(variantInput?.value || "").trim();
      const variantCategory = normalizeVariantCategory(variantCategorySelect?.value || "Standard");

      const routePart = routeSuffix ? "Route_" + routeSuffix : "";
      const rawBase = [routePart, variantName || directionName].filter(Boolean).join("_");

      const fileBase = sanitizeFilename(rawBase || "Route");
      const lineFolder = sanitizeFilename(lineSuffix ? "Linie_" + lineSuffix : "Linie");
      const categoryFolder = sanitizeFilename(variantCategory || "Standard") || "Standard";

      fileInfo.textContent = (lineFolder ? lineFolder + "/" : "") + categoryFolder + "/" + fileBase + ".json / .gpx / .pdf";
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
      if (variantInput) variantInput.removeEventListener("input", updateFilePreview);
      if (variantCategorySelect) variantCategorySelect.removeEventListener("change", updateFilePreview);
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
        variantName: String(variantInput?.value || "").trim() || buildVariantNameFallback(routeSuffix ? "Route " + routeSuffix : "", String(directionInput.value || "").trim()),
        variantCategory: normalizeVariantCategory(variantCategorySelect?.value || "Standard"),
        directionName: String(directionInput.value || "").trim(),
        description: String(descriptionInput?.value || "").trim(),
        validFrom: String(validFromDialogInput?.value || "").trim(),
        validUntil: String(validUntilDialogInput?.value || "").trim()
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
    if (variantInput) variantInput.addEventListener("input", updateFilePreview);
    if (variantCategorySelect) variantCategorySelect.addEventListener("change", updateFilePreview);
    directionInput.addEventListener("input", updateFilePreview);
  });
}

async function findExistingLineEntry(city, lineFolder, categoryFolder, fileBase) {
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
    const wantedCategory = String(categoryFolder || "").trim().toLowerCase();
    const wantedBase = String(fileBase || "").trim().toLowerCase();

    return result.lines.find(entry => {
      const entryFolder = String(entry?.lineFolder || "").trim().toLowerCase();
      const entryCategory = String(entry?.categoryFolder || "").trim().toLowerCase();
      const entryBase = String(entry?.fileBase || "").trim().toLowerCase();
      return entryFolder === wantedFolder && entryCategory === wantedCategory && entryBase === wantedBase;
    }) || null;
  } catch (err) {
    warn("Konnte bestehende Datei vor dem Speichern nicht prüfen: " + err.message);
    return null;
  }
}

// Führt den eigentlichen Speicher-Vorgang durch (intern)
async function _doSaveLineToServer(data, city, fileBase, lineFolder, categoryFolder, forceOverwrite = false) {
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
      const gpxResult = await saveGpxToServer(`${actualFileBase}.gpx`, gpx, city, lineFolder, categoryFolder);
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
      lineFolder,
      categoryFolder
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
    setStatus(`Gespeichert: ${lineFolder}/${categoryFolder}/${actualFileBase}.json${gpxSaved ? " + .gpx" : ""}${pdfSaved ? " + .pdf" : ""} (${city})${pdfSaved && pdfPath ? " - PDF: " + pdfPath : ""}${!pdfSaved && pdfError ? " - PDF-Fehler: " + pdfError : ""}`);
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
    searchModeVariants: document.getElementById("vbbSearchModeVariants"),
    searchAllDay: document.getElementById("vbbSearchAllDay"),
    searchTimeFromInput: document.getElementById("vbbSearchTimeFromInput"),
    searchTimeToInput: document.getElementById("vbbSearchTimeToInput"),
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
  hideVbbSearchOptions();
  refs.modal.classList.add("hidden");
}

function showVbbImportProgressPopup(lineQuery, title = "") {
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

  if (refs.title) refs.title.textContent = title || `VBB-Import Linie ${lineQuery}`;
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
  const customMeta = String(entry?.meta || "").trim();
  if (customMeta) return customMeta;

  const product = String(entry?.product || "").trim();
  const startStop = String(entry?.startStop || entry?.origin || "").trim();
  const destination = String(entry?.destination || entry?.direction || "").trim();
  const stopCount = Number(entry?.stopCount || 0);
  const variantKey = String(entry?.variantKey || "").trim();
  const routeLabel = `${startStop || "Start ?"} -> ${destination || "Ziel ?"}`;
  const variantLabel = variantKey ? `Variante ${variantKey.slice(0, 6)}` : "";
  const parts = [routeLabel, stopCount > 0 ? `${stopCount} Stops` : "", variantLabel, product].filter(Boolean);
  return parts.join(" | ");
}

function chooseVbbSearchOptionsInPopup() {
  const refs = getVbbImportModalRefs();
  if (!refs.searchOptions || !refs.searchStartBtn || !refs.searchCancelBtn || !refs.closeBtn) {
    return Promise.resolve({ searchDate: null, searchTimeFrom: null, searchTimeTo: null, allDay: true, searchMode: "variants" });
  }

  refs.searchOptions.classList.remove("hidden");
  if (refs.searchDayToday) refs.searchDayToday.checked = true;
  if (refs.searchDayTomorrow) refs.searchDayTomorrow.checked = false;
  if (refs.searchModeVariants) refs.searchModeVariants.checked = true;
  if (refs.searchAllDay) refs.searchAllDay.checked = true;
  if (refs.searchTimeFromInput) {
    refs.searchTimeFromInput.disabled = true;
    refs.searchTimeFromInput.value = refs.searchTimeFromInput.value || "07:00";
  }
  if (refs.searchTimeToInput) {
    refs.searchTimeToInput.disabled = true;
    refs.searchTimeToInput.value = refs.searchTimeToInput.value || "10:00";
  }

  const updateTimeEnabled = () => {
    if (!refs.searchAllDay) return;
    const variantsMode = !!refs.searchModeVariants?.checked;
    if (refs.searchAllDay) refs.searchAllDay.disabled = variantsMode;
    const disabled = !!refs.searchAllDay.checked;
    if (refs.searchTimeFromInput) refs.searchTimeFromInput.disabled = variantsMode || disabled;
    if (refs.searchTimeToInput) refs.searchTimeToInput.disabled = variantsMode || disabled;
  };

  if (refs.searchAllDay) {
    refs.searchAllDay.addEventListener("change", updateTimeEnabled);
  }
  if (refs.searchModeVariants) {
    refs.searchModeVariants.addEventListener("change", updateTimeEnabled);
  }
  updateTimeEnabled();

  return new Promise((resolve) => {
    const prevCloseHandler = refs.closeBtn.onclick;

    const cleanup = () => {
      if (refs.searchAllDay) {
        refs.searchAllDay.removeEventListener("change", updateTimeEnabled);
      }
      if (refs.searchModeVariants) {
        refs.searchModeVariants.removeEventListener("change", updateTimeEnabled);
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
      const variantsMode = !!refs.searchModeVariants?.checked;
      const allDay = variantsMode ? true : !!refs.searchAllDay?.checked;
      const dayOffset = refs.searchDayTomorrow?.checked ? 1 : 0;
      const dateObj = new Date();
      dateObj.setDate(dateObj.getDate() + dayOffset);
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
      const dd = String(dateObj.getDate()).padStart(2, "0");
      const searchDate = `${yyyy}-${mm}-${dd}`;

      let searchTimeFrom = null;
      let searchTimeTo = null;
      if (!allDay) {
        const fromRaw = String(refs.searchTimeFromInput?.value || "").trim();
        const toRaw = String(refs.searchTimeToInput?.value || "").trim();
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(fromRaw) || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(toRaw)) {
          setStatus("Ungültige Uhrzeit. Bitte HH:MM für Von und Bis verwenden.", "warn");
          return;
        }
        searchTimeFrom = fromRaw;
        searchTimeTo = toRaw;
      }

      finish({ searchDate, searchTimeFrom, searchTimeTo, allDay, searchMode: variantsMode ? "variants" : "window" });
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

function chooseVbbCandidateInPopup(candidates, options = {}) {
  const refs = getVbbImportModalRefs();
  if (!refs.picker || !refs.pickerList || !refs.pickerSelectBtn || !refs.pickerCancelBtn || !refs.closeBtn) {
    return Promise.resolve(candidates?.[0] || null);
  }

  refs.picker.classList.remove("hidden");
  refs.pickerList.innerHTML = "";
  refs.pickerList.setAttribute("role", "listbox");
  refs.pickerSelectBtn.disabled = true;
  refs.pickerSelectBtn.textContent = options.selectText || "Fahrt importieren";
  refs.pickerCancelBtn.textContent = options.cancelText || "Abbrechen";
  if (refs.pickerHint) {
    refs.pickerHint.textContent = `${candidates.length} Treffer gefunden. Bitte Fahrt auswählen.`;
  }

  if (refs.pickerHint && options.hint) {
    refs.pickerHint.textContent = options.hint;
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

function chooseGtfsAgenciesInPopup(agencies, options = {}) {
  const isIndexSelection = options.mode === "index";
  const storageKey = isIndexSelection
    ? "lehrfahrer_gtfs_index_agency_filter"
    : "lehrfahrer_gtfs_import_agency_filter";
  let savedSelection = null;
  try {
    savedSelection = JSON.parse(localStorage.getItem(storageKey) || "null");
  } catch (_) {
    savedSelection = null;
  }
  const savedAgencyIds = new Set(
    Array.isArray(savedSelection?.agencyIds) ? savedSelection.agencyIds.map(String) : []
  );
  const refs = getVbbImportModalRefs();
  if (!refs.picker || !refs.pickerList || !refs.pickerSelectBtn || !refs.pickerCancelBtn || !refs.closeBtn) {
    return Promise.resolve(null);
  }

  refs.picker.classList.remove("hidden");
  refs.pickerList.innerHTML = "";
  refs.pickerList.setAttribute("role", "group");
  refs.pickerSelectBtn.textContent = isIndexSelection ? "Index starten" : "Weiter zur Linienauswahl";
  if (refs.pickerHint) {
    refs.pickerHint.textContent = isIndexSelection
      ? "Betreiber für den Turboindex auswählen."
      : "Betreiber auswählen und Linien optional eingrenzen.";
  }

  const controls = document.createElement("div");
  controls.className = "gtfs-agency-controls";

  const agencySearch = document.createElement("input");
  agencySearch.type = "search";
  agencySearch.placeholder = "Betreiberliste filtern";
  agencySearch.setAttribute("aria-label", "Betreiberliste filtern");
  agencySearch.value = String(savedSelection?.filter || "");

  const lineSearch = document.createElement("input");
  lineSearch.type = "search";
  lineSearch.placeholder = "Liniennummer oder Linienname (optional)";
  lineSearch.setAttribute("aria-label", "Linien innerhalb der ausgewählten Betreiber filtern");

  const buttonRow = document.createElement("div");
  buttonRow.className = "gtfs-agency-select-actions";
  const defaultBtn = document.createElement("button");
  defaultBtn.type = "button";
  defaultBtn.textContent = "VBB-Standard auswählen";
  const cottbusBtn = document.createElement("button");
  cottbusBtn.type = "button";
  cottbusBtn.textContent = "Cottbusverkehr auswählen";
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.textContent = isIndexSelection ? "Alle auswählen (Expertenmodus)" : "Alle auswählen";
  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.textContent = "Keine auswählen";
  buttonRow.append(defaultBtn);
  if (isIndexSelection) buttonRow.append(cottbusBtn);
  buttonRow.append(allBtn, noneBtn);
  controls.append(agencySearch);
  if (!isIndexSelection) controls.append(lineSearch);
  controls.append(buttonRow);
  refs.pickerList.appendChild(controls);

  const entries = agencies.map(agency => {
    const row = document.createElement("label");
    row.className = "vbb-candidate-row gtfs-agency-row";
    row.dataset.filterText = `${agency.name || ""} ${agency.id || ""}`.toLocaleLowerCase("de-DE");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(agency.id || "");
    checkbox.checked = savedAgencyIds.size
      ? savedAgencyIds.has(String(agency.id || ""))
      : /cottbusverkehr/i.test(String(agency.name || ""));

    const textWrap = document.createElement("div");
    const main = document.createElement("div");
    main.className = "vbb-candidate-main";
    main.textContent = String(agency.name || agency.id || "Betreiber");
    const meta = document.createElement("div");
    meta.className = "vbb-candidate-meta";
    meta.textContent = `${Number(agency.routeCount || 0)} Linien | agency_id ${agency.id}`;
    textWrap.append(main, meta);
    row.append(checkbox, textWrap);
    refs.pickerList.appendChild(row);
    return { agency, row, checkbox };
  });

  const updateSelectionState = () => {
    const selectedCount = entries.filter(entry => entry.checkbox.checked).length;
    refs.pickerSelectBtn.disabled = selectedCount < 1;
    if (refs.pickerHint) {
      refs.pickerHint.textContent = `${selectedCount} von ${entries.length} Betreibern ausgewählt.`;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        agencyIds: entries.filter(entry => entry.checkbox.checked).map(entry => String(entry.agency.id)),
        filter: agencySearch.value.trim()
      }));
    } catch (_) {
      // Import bleibt auch ohne lokalen Speicher nutzbar.
    }
  };
  const setChecked = predicate => {
    entries.forEach(entry => {
      entry.checkbox.checked = !!predicate(entry.agency);
    });
    updateSelectionState();
  };
  const filterRows = () => {
    const query = agencySearch.value.trim().toLocaleLowerCase("de-DE");
    entries.forEach(entry => entry.row.classList.toggle("hidden", !!query && !entry.row.dataset.filterText.includes(query)));
  };

  entries.forEach(entry => entry.checkbox.addEventListener("change", updateSelectionState));
  agencySearch.addEventListener("input", () => {
    filterRows();
    updateSelectionState();
  });
  defaultBtn.addEventListener("click", () => setChecked(agency => agency.isDefault));
  cottbusBtn.addEventListener("click", () => setChecked(agency => /cottbusverkehr/i.test(String(agency.name || ""))));
  allBtn.addEventListener("click", () => setChecked(() => true));
  noneBtn.addEventListener("click", () => setChecked(() => false));
  if (!entries.some(entry => entry.checkbox.checked)) {
    setChecked(agency => agency.isDefault);
  } else {
    updateSelectionState();
  }
  filterRows();

  return new Promise(resolve => {
    const previousCloseHandler = refs.closeBtn.onclick;
    const finish = value => {
      refs.pickerSelectBtn.removeEventListener("click", onSelect);
      refs.pickerCancelBtn.removeEventListener("click", onCancel);
      refs.closeBtn.onclick = previousCloseHandler;
      hideVbbCandidatePicker();
      resolve(value);
    };
    const onSelect = () => finish({
      agencyIds: entries.filter(entry => entry.checkbox.checked).map(entry => String(entry.agency.id)),
      search: lineSearch.value.trim()
    });
    const onCancel = () => finish(null);
    refs.pickerSelectBtn.addEventListener("click", onSelect);
    refs.pickerCancelBtn.addEventListener("click", onCancel);
    refs.closeBtn.onclick = () => {
      finish(null);
      closeVbbImportProgressPopup();
    };
  });
}

async function postGtfsImport(fields) {
  const body = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) body.append(key, value);
  });

  const response = await fetch(API_GTFS_IMPORT_URL, {
    method: "POST",
    headers: withApiAuthHeaders({}),
    body
  });
  const result = await response.json().catch(() => ({
    ok: false,
    error: `GTFS-Serverantwort ist ungueltig (HTTP ${response.status}).`
  }));
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `GTFS-Import fehlgeschlagen (HTTP ${response.status}).`);
  }
  return result;
}

async function runGtfsImport(loadSource, initialMessage) {
  showVbbImportProgressPopup("", "GTFS-ZIP-Import");
  try {
      updateVbbImportProgressPopup(initialMessage, {
        level: "info",
        busy: true,
        subtitle: "Datei lesen"
      });
      const upload = await loadSource();
      const agencies = Array.isArray(upload.agencies) ? upload.agencies : [];
      if (!agencies.length) throw new Error("Die GTFS-Datei enthält keine auswählbaren Betreiber.");

      updateVbbImportProgressPopup(`${agencies.length} Betreiber gefunden.`, {
        level: "info",
        busy: false,
        subtitle: "Betreiber auswählen"
      });
      const agencySelection = await chooseGtfsAgenciesInPopup(agencies);
      if (!agencySelection) {
        setStatus("GTFS-Import abgebrochen.", "warn");
        return;
      }

      updateVbbImportProgressPopup("Linien der ausgewählten Betreiber werden geladen ...", {
        level: "info",
        busy: true,
        subtitle: "Linien filtern"
      });
      const routeResult = await postGtfsImport({
        action: "routes",
        token: upload.token,
        agencyIds: JSON.stringify(agencySelection.agencyIds),
        search: agencySelection.search
      });
      const routes = (Array.isArray(routeResult.routes) ? routeResult.routes : []).map(route => ({
        ...route,
        meta: [
          route.agencyName || (route.agencyId ? `Agency ${route.agencyId}` : "Betreiber unbekannt"),
          route.routeType ? `route_type ${route.routeType}` : "",
          route.id ? `route_id ${route.id}` : ""
        ]
          .filter(Boolean)
          .join(" | ")
      }));
      if (!routes.length) {
        throw new Error("Der GTFS-Filter liefert keine Linien. Bitte einen anderen Suchtext verwenden.");
      }

      while (true) {
        updateVbbImportProgressPopup(`${routes.length} Linien gefunden.`, {
          level: "info",
          busy: false,
          subtitle: "Linie auswählen"
        });
        const route = await chooseVbbCandidateInPopup(routes, {
          hint: `${routes.length} Linien gefunden. Bitte Linie auswählen.`,
          selectText: "Linie auswählen",
          cancelText: "Import beenden"
        });
        if (!route) {
          setStatus("GTFS-Import beendet.");
          return;
        }

        updateVbbImportProgressPopup(`Varianten für ${route.name} werden geladen ...`, {
          level: "info",
          busy: true,
          subtitle: "Varianten laden"
        });
        const variantResult = await postGtfsImport({
          action: "variants",
          token: upload.token,
          routeId: route.id
        });
        const variants = (Array.isArray(variantResult.variants) ? variantResult.variants : []).map(variant => {
          const direction = String(variant.directionId ?? "").trim();
          const signature = String(variant.variantKey || "").slice(0, 8);
          const routeLabel = [variant.routeShortName, variant.routeLongName].filter(Boolean).join(" - ");
          const viaStops = Array.isArray(variant.viaStops) ? variant.viaStops.filter(Boolean).slice(0, 4) : [];
          return {
            ...variant,
            meta: [
              routeLabel,
              variant.agencyName || "Betreiber unbekannt",
              variant.routeTypeLabel || (variant.routeType ? `route_type ${variant.routeType}` : ""),
              direction ? `Richtung ${direction}` : "Richtung unbekannt",
              variant.headsign ? `Ziel ${variant.headsign}` : "",
              `${Number(variant.stopCount || 0)} Stops`,
              [variant.startStop, variant.destination].filter(Boolean).join(" -> "),
              viaStops.length ? `via ${viaStops.join(" / ")}` : "",
              signature ? `Variante ${signature}` : ""
            ].filter(Boolean).join(" | ")
          };
        });
        if (!variants.length) throw new Error(`Für ${route.name} wurden keine nutzbaren Varianten gefunden.`);

        const cacheText = variantResult.fromTurboIndex
          ? " Varianten aus Turboindex geladen."
          : (variantResult.fromCache ? " Varianten aus Zwischenspeicher geladen." : "");
        if (variantResult.fromCache) {
          updateVbbImportProgressPopup(
            variantResult.fromTurboIndex
              ? `Varianten aus Turboindex geladen: ${route.name}.`
              : `Varianten aus Zwischenspeicher geladen: ${route.name}.`, {
            level: "success",
            busy: false,
            subtitle: "Varianten-Cache"
          });
        }

        let lastImportedName = "";
        while (true) {
          const variant = await chooseVbbCandidateInPopup(variants, {
            hint: lastImportedName
              ? `${lastImportedName} importiert. Weitere Variante wählen oder zur Linienauswahl zurückkehren.`
              : `${variants.length} Varianten gefunden.${cacheText} Bitte Haltestellenfolge auswählen.`,
            selectText: lastImportedName ? "Weitere Variante importieren" : "Variante importieren",
            cancelText: "Zur Linienauswahl zurück"
          });
          if (!variant) {
            const refs = getVbbImportModalRefs();
            if (refs.modal?.classList.contains("hidden")) return;
            break;
          }

          updateVbbImportProgressPopup(`Haltestellenfolge ${variant.name} wird importiert ...`, {
            level: "info",
            busy: true,
            subtitle: "Linie erzeugen"
          });
          const imported = await postGtfsImport({
            action: "import",
            token: upload.token,
            routeId: route.id,
            variantId: variant.id
          });
          if (!imported.line || typeof imported.line !== "object") {
            throw new Error("GTFS-Import lieferte keine gültigen Liniendaten.");
          }

          loadLineFromData(imported.line);
          const warningCount = Number(imported.warningCount || 0);
          const warningText = warningCount > 0
            ? ` ${warningCount} Stops ohne Koordinaten wurden übersprungen.`
            : "";
          lastImportedName = String(variant.name || "Variante");
          updateVbbImportProgressPopup(`GTFS-Haltestellenfolge importiert (${imported.stopCount || 0} Stops).${warningText}`, {
            level: warningCount > 0 ? "warn" : "success",
            busy: false,
            allowClose: true,
            subtitle: "Weitere Variante möglich"
          });
          setStatus(
            `GTFS-Haltestellenfolge importiert (${imported.stopCount || 0} Stops).${warningText} Route wurde nicht berechnet.`,
            warningCount > 0 ? "warn" : "success"
          );
        }
      }
    } catch (err) {
      error("GTFS-Import fehlgeschlagen", err);
      updateVbbImportProgressPopup(err.message || "GTFS-Import fehlgeschlagen.", {
        level: "error",
        busy: false,
        allowClose: true,
        subtitle: "Fehler"
      });
      setStatus(err.message || "GTFS-Import fehlgeschlagen.", "error");
  }
}

function importGtfsZipPrompt() {
  const input = document.getElementById("gtfsZipInput");
  if (!input) {
    setStatus("GTFS-Dateiauswahl ist nicht verfuegbar.", "error");
    return;
  }

  input.value = "";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await runGtfsImport(
        () => postGtfsImport({ action: "upload", feed: file }),
        `GTFS-ZIP wird geladen: ${file.name}`
      );
    } finally {
      input.value = "";
    }
  };
  input.click();
}

function importGtfsFromServer() {
  return runGtfsImport(
    () => postGtfsImport({ action: "server" }),
    "GTFS-ZIP wird direkt vom Server geladen ..."
  );
}

async function rebuildGtfsServerIndex() {
  showVbbImportProgressPopup("", "GTFS-Turboindex");
  try {
    updateVbbImportProgressPopup("Betreiberliste wird aus dem Server-GTFS geladen ...", {
      level: "info",
      busy: true,
      subtitle: "Betreiber laden"
    });
    const agencyResult = await postGtfsImport({ action: "indexAgencies" });
    const agencies = Array.isArray(agencyResult.agencies) ? agencyResult.agencies : [];
    if (!agencies.length) throw new Error("Die GTFS-Datei enthält keine auswählbaren Betreiber.");
    updateVbbImportProgressPopup(`${agencies.length} Betreiber gefunden.`, {
      level: "info",
      busy: false,
      subtitle: "Betreiber auswählen"
    });
    const selection = await chooseGtfsAgenciesInPopup(agencies, { mode: "index" });
    if (!selection) {
      closeVbbImportProgressPopup();
      setStatus("GTFS-Indexaufbau abgebrochen.", "warn");
      return;
    }
    const selectedAgencyIds = selection.agencyIds.map(String).sort();
    if (selectedAgencyIds.length === agencies.length
      && !confirm("Wirklich alle Betreiber indexieren? Dies ist der langsame deutschlandweite Expertenmodus.")) {
      closeVbbImportProgressPopup();
      setStatus("GTFS-Indexaufbau abgebrochen.", "warn");
      return;
    }

    const status = await postGtfsImport({ action: "indexStatus" });
    let restart = false;
    const existingAgencyIds = Array.isArray(status.job?.agencyIds) ? status.job.agencyIds.map(String).sort() : [];
    const sameSelection = JSON.stringify(existingAgencyIds) === JSON.stringify(selectedAgencyIds);
    if (status.job && (Number(status.job.version || 0) !== 3 || !sameSelection)) {
      alert("Der vorhandene GTFS-Indexjob passt nicht zur aktuellen Betreiber-Auswahl oder verwendet ein altes Schema und wird neu gestartet.");
      restart = true;
    } else if (status.active) {
      const resume = confirm("Ein GTFS-Indexjob ist bereits vorhanden. Mit OK fortsetzen; Abbrechen bietet einen sauberen Neustart an.");
      if (!resume) {
        if (!confirm("Vorhandenen Zwischenstand verwerfen und GTFS-Index neu starten?")) {
          closeVbbImportProgressPopup();
          return;
        }
        restart = true;
      }
    } else if (!confirm(`GTFS-Turboindex für ${selectedAgencyIds.length} ausgewählte Betreiber neu erstellen?`)) {
      closeVbbImportProgressPopup();
      return;
    } else {
      restart = true;
    }

    let result = await postGtfsImport({
      action: "indexStart",
      restart: restart ? "1" : "0",
      agencyIds: JSON.stringify(selectedAgencyIds)
    });
    let job = result.job || {};
    const renderProgress = currentJob => {
      const sqlite = currentJob.sqliteDiagnostics || currentJob.sqliteAfterPrepare || null;
      const details = [
        currentJob.step || currentJob.phase || "Indexierung",
        `${Number(currentJob.rowsRead || 0)} Zeilen gelesen`,
        `${Number(currentJob.stopTimeRows || 0)} stop_times-Zeilen`,
        `${Number(currentJob.routeRows || 0)} relevante Linien`,
        `${Number(currentJob.tripRows || 0)} relevante Trips`,
        `${Number(currentJob.variantsFound || 0)} Varianten`,
        currentJob.fileProgress !== undefined ? `${currentJob.fileProgress}% aktuelle Datei` : "",
        sqlite ? `SQLite ${(Number(sqlite.fileBytes || 0) / 1048576).toFixed(1)} MB` : "",
        sqlite ? `${Number(sqlite.pageCount || 0)} Seiten à ${Number(sqlite.pageSize || 0)} Byte` : "",
        sqlite ? `TEMP_STORE ${sqlite.tempStoreLabel || sqlite.tempStore}` : ""
      ].filter(Boolean).join(" | ");
      updateVbbImportProgressPopup(details, {
        level: currentJob.phase === "done" ? "success" : "info",
        busy: currentJob.phase !== "done",
        allowClose: currentJob.phase === "done",
        subtitle: currentJob.phase === "done" ? "Turboindex fertig" : `Indexphase: ${currentJob.phase || "start"}`
      });
    };

    renderProgress(job);
    while (job.phase !== "done") {
      result = await postGtfsImport({ action: "indexStep" });
      job = result.job || {};
      renderProgress(job);
      if (job.phase !== "done") await new Promise(resolve => setTimeout(resolve, 100));
    }

    updateVbbImportProgressPopup("GTFS-Turboindex wurde vollständig erstellt.", {
      level: "success",
      busy: false,
      allowClose: true,
      subtitle: "Turboindex fertig"
    });
    setStatus(`GTFS-Turboindex neu erstellt (${Number(job.variantsFound || 0)} Varianten).`, "success");
  } catch (err) {
    error("GTFS-Indexierung fehlgeschlagen", err);
    updateVbbImportProgressPopup(`${err.message || "GTFS-Indexierung fehlgeschlagen."} Der Job kann später fortgesetzt oder neu gestartet werden.`, {
      level: "error",
      busy: false,
      allowClose: true,
      subtitle: "Index unterbrochen"
    });
    setStatus(err.message || "GTFS-Indexierung fehlgeschlagen.", "error");
  }
}

async function analyzeGtfsServerIndex() {
  showVbbImportProgressPopup("", "GTFS-Indexanalyse");
  updateVbbImportProgressPopup("Turboindex wird schreibgeschützt ausgewertet ...", {
    level: "info",
    busy: true,
    subtitle: "SQLite analysieren"
  });
  try {
    const result = await postGtfsImport({ action: "indexAnalyze" });
    const summary = result.summary || {};
    const sqlite = result.sqlite || {};
    const topRoutes = Array.isArray(result.topRoutes) ? result.topRoutes : [];
    const agencies = Array.isArray(result.variantsByAgency) ? result.variantsByAgency : [];
    const objectSizes = Object.entries(sqlite.objectBytes || {})
      .slice(0, 8)
      .map(([name, bytes]) => `${name}: ${(Number(bytes) / 1048576).toFixed(1)} MB`)
      .join(", ");
    const lines = [
      `Quelle: ${result.databaseFile || result.source || "SQLite"}`,
      `${Number(summary.variantCount || 0)} Varianten auf ${Number(summary.routeCount || 0)} Linien`,
      `${Number(summary.uniqueStopSequences || 0)} feedweit eindeutige Stopfolgen`,
      `${Number(summary.duplicateVariantKeyGroups || 0)} doppelte Variantenschlüssel`,
      `Ø ${Number(summary.averageStopCount || 0).toFixed(1)} Stops; stops_json Ø ${(Number(summary.averageStopsJsonBytes || 0) / 1024).toFixed(1)} KB, gesamt ${(Number(summary.totalStopsJsonBytes || 0) / 1048576).toFixed(1)} MB`,
      `Datenbank ${(Number(sqlite.fileBytes || 0) / 1048576).toFixed(1)} MB`,
      objectSizes ? `Größte SQLite-Objekte: ${objectSizes}` : (sqlite.objectBytesError || "Tabellengrößen nicht verfügbar."),
      "",
      "Top-20 Linien:",
      ...topRoutes.map((route, index) => `${index + 1}. ${route.route_short_name || route.route_id} | ${route.agency_name || "Betreiber unbekannt"} | ${Number(route.variant_count || 0)} Varianten | ${Number(route.unique_stop_sequences || 0)} Stopfolgen`),
      "",
      "Betreiber:",
      ...agencies.slice(0, 20).map(agency => `${agency.agency_name}: ${Number(agency.variant_count || 0)} Varianten auf ${Number(agency.route_count || 0)} Linien`)
    ];
    updateVbbImportProgressPopup(lines.join("\n"), {
      level: "success",
      busy: false,
      allowClose: true,
      subtitle: "Analyse abgeschlossen"
    });
    debug("GTFS-Indexanalyse", result);
    setStatus(`GTFS-Index analysiert: ${Number(summary.variantCount || 0)} Varianten.`, "success");
  } catch (err) {
    error("GTFS-Indexanalyse fehlgeschlagen", err);
    updateVbbImportProgressPopup(err.message || "GTFS-Indexanalyse fehlgeschlagen.", {
      level: "error",
      busy: false,
      allowClose: true,
      subtitle: "Analyse fehlgeschlagen"
    });
    setStatus(err.message || "GTFS-Indexanalyse fehlgeschlagen.", "error");
  }
}

async function importLineFromVbbPrompt() {
  try {
    const lineQueryRaw = prompt("Für welche VBB-Linie sollen Haltestellenfolgen gesucht werden?\nBeispiel: 10");
    if (lineQueryRaw === null) {
      return;
    }

    const lineQuery = String(lineQueryRaw || "").trim();
    if (!lineQuery) {
      setStatus("VBB-Import abgebrochen: keine Linie eingegeben.", "warn");
      return;
    }

    showVbbImportProgressPopup(lineQuery);
    const searchDate = "";
    const searchTimeFrom = "";
    const searchTimeTo = "";
    const allDay = true;
    const searchMode = "variants";
    const modeLabel = "als Haltestellenfolgen und Varianten";

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
      payload.searchMode = searchMode;
      payload.allDay = !!allDay;
      if (!allDay && searchTimeFrom) {
        payload.searchTimeFrom = searchTimeFrom;
      }
      if (!allDay && searchTimeTo) {
        payload.searchTimeTo = searchTimeTo;
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

    updateVbbImportProgressPopup(
      `${candidates.length} Haltestellenfolgen gefunden. Variante im Popup auswählen …`,
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

    updateVbbImportProgressPopup(`Variante ${selected.name} wird geladen …`, {
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
    updateVbbImportProgressPopup(`Haltestellenfolge importiert: ${selected.name} (${importResult.stopCount || 0} Stops)`, {
      level: "success",
      busy: false,
      allowClose: true,
      subtitle: "Fertig",
      autoCloseMs: 5000
    });
    setStatus(`VBB-Haltestellenfolge importiert: ${selected.name} (${importResult.stopCount || 0} Stops). Route kann jetzt erzeugt werden.`);
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
async function loadLineFromServer(lineId = null, lineFolder = null, cityOverride = null, categoryFolder = null) {
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
      `${API_LOAD_LINE_URL}?city=${encodeURIComponent(city)}&line=${encodeURIComponent(normalizedLineId)}&lineFolder=${encodeURIComponent(lineFolder || "")}&categoryFolder=${encodeURIComponent(categoryFolder || "")}`,
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
async function deleteLineFromServer(lineId = null, skipConfirm = false, lineFolder = null, cityOverride = null, categoryFolder = null) {
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
        lineFolder: lineFolder || "",
        categoryFolder: categoryFolder || ""
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
    const oldLineFolder = line.lineFolder || null;
    const oldCategoryFolder = line.categoryFolder || null;
    const categoryFolder = line.categoryFolder || sanitizeFilename(line.variantCategory || "Standard") || "Standard";
    const lineSuffix = String(newLineName || "").trim().replace(/^Linie[\s_-]*/i, "").trim();
    const normalizedLineName = lineSuffix ? "Linie " + lineSuffix : String(newLineName || "").trim();
    const newLineFolder = sanitizeFilename(lineSuffix ? "Linie_" + lineSuffix : "Linie");

    if (!fileBase) {
      setStatus("Keine Linien-ID zum Umbenennen.", "error");
      return false;
    }

    const loadRes = await fetch(
      `${API_LOAD_LINE_URL}?city=${encodeURIComponent(city)}&line=${encodeURIComponent(fileBase)}&lineFolder=${encodeURIComponent(oldLineFolder || "")}&categoryFolder=${encodeURIComponent(oldCategoryFolder || "")}`,
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

    const existingTarget = await findExistingLineEntry(city, newLineFolder, categoryFolder, fileBase);
    const sameTarget = String(oldLineFolder || "") === newLineFolder
      && String(oldCategoryFolder || "") === categoryFolder;
    if (existingTarget) {
      const overwriteOk = confirm(
        `Diese Datei existiert bereits:\n${newLineFolder}/${categoryFolder || "Standard"}/${fileBase}.json\n\nWirklich überschreiben?`
      );
      if (!overwriteOk) {
        setStatus("Umbenennen abgebrochen (Überschreiben nicht bestätigt).", "warn");
        return false;
      }
    }

    let existingGpx = null;
    if (line.hasGpx) {
      const gpxUrl = line.gpxPath
        ? String(line.gpxPath)
        : "linien/" + [city, oldLineFolder, categoryFolder, fileBase + ".gpx"]
          .filter(Boolean)
          .map(part => encodeURIComponent(part))
          .join("/");
      const gpxResponse = await fetch(gpxUrl, { cache: "no-store" });
      if (!gpxResponse.ok) {
        throw new Error("Vorhandene GPX-Datei konnte für den Ordnerwechsel nicht geladen werden.");
      }
      existingGpx = await gpxResponse.text();
    }

    lineData.city = city;
    lineData.fileBase = fileBase;
    lineData.lineFolder = newLineFolder;
    lineData.lineName = normalizedLineName;
    lineData.routeName = newRouteName;
    lineData.directionName = newDirectionName;
    lineData.categoryFolder = categoryFolder || lineData.categoryFolder || "";
    if (lineData.line && typeof lineData.line === "object") {
      lineData.line.lineName = normalizedLineName;
      lineData.line.routeName = newRouteName;
      lineData.line.directionName = newDirectionName;
      lineData.line.lineFolder = newLineFolder;
      lineData.line.categoryFolder = lineData.categoryFolder;
    }
    lineData.forceOverwrite = !!existingTarget;

    const saveRes = await fetch(API_SAVE_LINE_URL, {
      method: "POST",
      headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(lineData)
    });
    const saveResult = await saveRes.json();

    if (!saveRes.ok || !saveResult.ok) {
      throw new Error(saveResult.error || "Umbenennen konnte nicht gespeichert werden");
    }

    if (existingGpx !== null) {
      await saveGpxToServer(fileBase + ".gpx", existingGpx, city, newLineFolder, categoryFolder);
    }

    if (!sameTarget) {
      const deletedOld = await deleteLineFromServer(fileBase, true, oldLineFolder, city, oldCategoryFolder);
      if (!deletedOld) {
        throw new Error("Neuer Linienordner wurde gespeichert, der alte Pfad konnte aber nicht entfernt werden.");
      }
    }

    line.lineName = normalizedLineName;
    line.lineFolder = newLineFolder;
    line.categoryFolder = categoryFolder;
    line.routeName = newRouteName;
    line.directionName = newDirectionName;
    line.fileBase = saveResult.fileBase || fileBase;
    setStatus(`Linie umbenannt: ${normalizedLineName}`);
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
  setVariantName(
    lineBlock.variantName ?? data.variantName ?? "",
    lineBlock.routeName || data.routeName || "",
    lineBlock.directionName || data.directionName || ""
  );
  setVariantCategory(lineBlock.variantCategory ?? data.variantCategory ?? "Standard");
  setLineDescription(lineBlock.description ?? data.description ?? "");
  setLineValidity(lineBlock.validFrom ?? data.validFrom ?? "", lineBlock.validUntil ?? data.validUntil ?? "");
  lineColorInput.value = lineBlock.color || "#d32f2f";

  state.routeMode = lineBlock.routeMode || data.routeMode || "auto";
  state.placementMode = normalizeEditorPlacementMode(
    lineBlock.placementMode || data.placementMode,
    state.routeMode
  );
  state.routingMode = normalizeEditorRoutingMode(lineBlock.routingMode || data.routingMode);
  state.preserveManualChains = !!(
    lineBlock.preserveManualChains ?? data.preserveManualChains ?? true
  );
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
      ),
      isDetourReplacement: !!stopData.isDetourReplacement,
      detourId: stopData.detourId || null,
      detourRole: stopData.detourRole || null,
      detourOriginalStopIds: Array.isArray(stopData.detourOriginalStopIds) ? stopData.detourOriginalStopIds : [],
      detourOriginalStopNames: Array.isArray(stopData.detourOriginalStopNames) ? stopData.detourOriginalStopNames : []
    });

    stop.id = stopData.id || stop.id;
    stop.stopId = stopData.stopId || stopData.catalogId || null;
    const importedStopSequence = Number(stopData.stopSequence ?? stopData.order);
    stop.stopSequence = Number.isFinite(importedStopSequence) ? importedStopSequence : null;
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
    stop.isDetourReplacement = !!stopData.isDetourReplacement;
    stop.detourId = stopData.detourId || null;
    stop.detourRole = stopData.detourRole || null;
    stop.detourOriginalStopIds = Array.isArray(stopData.detourOriginalStopIds) ? [...stopData.detourOriginalStopIds] : [];
    stop.detourOriginalStopNames = Array.isArray(stopData.detourOriginalStopNames) ? [...stopData.detourOriginalStopNames] : [];
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
    variantName: lineBlock.variantName || data.variantName || "",
    variantCategory: lineBlock.variantCategory || data.variantCategory || "",
    description: lineBlock.description || data.description || "",
    validFrom: lineBlock.validFrom || data.validFrom || "",
    validUntil: lineBlock.validUntil || data.validUntil || "",
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
